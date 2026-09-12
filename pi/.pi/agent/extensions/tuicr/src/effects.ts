import type { ExecResult, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, Ref, Schema } from 'effect'
import {
  buildHerdrPaneCloseArgs,
  buildHerdrPaneRunArgs,
  buildHerdrPaneSplitArgs,
  buildHerdrPaneWaitOutputArgs,
  buildTuicrBlockingCommand,
  buildTuicrCommentsArgs,
  buildTuicrListArgs,
  type CommentData,
  CommentListSchema,
  decodeHerdrPaneId,
  HERDR_COMMAND,
  hasHerdrEnvironment,
  normalizeComments,
  type PaneState,
  type ReviewScope,
  ReviewScopeSchema,
  SessionListSchema,
  type SessionSummary,
  selectNewSession,
  selectSessionSlug,
  TUICR_COMMAND,
  TUICR_COMPLETION_MARKER,
} from './core.ts'

export class TuicrError extends Schema.TaggedError<TuicrError>()('TuicrError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

export class TuicrProcessError extends Schema.TaggedError<TuicrProcessError>()('TuicrProcessError', {
  command: Schema.String,
  message: Schema.String,
  code: Schema.optionalKey(Schema.Number),
  stderr: Schema.optionalKey(Schema.String),
}) {}

export type TuicrOpenResult = {
  readonly pane: PaneState
  readonly session: SessionSummary
  readonly comments: readonly CommentData[]
}

export class Tuicr extends Context.Service<
  Tuicr,
  {
    readonly open: (repo: string, scope: ReviewScope) => Effect.Effect<TuicrOpenResult, TuicrError | TuicrProcessError>
    readonly comments: () => Effect.Effect<readonly CommentData[], TuicrError | TuicrProcessError>
    readonly close: () => Effect.Effect<void, TuicrError | TuicrProcessError>
    readonly shutdown: () => Effect.Effect<void, never>
  }
>()('tuicr/Tuicr') {}

export type TuicrLayerOptions = {
  readonly discoveryAttempts?: number
  readonly discoveryDelayMs?: number
}

function commandText(command: string, args: readonly string[]): string {
  return [command, ...args].join(' ')
}

function processFailure(command: string, args: readonly string[], cause: unknown): TuicrProcessError {
  return new TuicrProcessError({
    command: commandText(command, args),
    message: String(cause),
  })
}

function resultFailure(command: string, args: readonly string[], result: ExecResult): TuicrProcessError {
  return new TuicrProcessError({
    command: commandText(command, args),
    message: `process exited with code ${result.code}`,
    code: result.code,
    stderr: result.stderr,
  })
}

function stateFailure(operation: string, message: string): TuicrError {
  return new TuicrError({ operation, message })
}

export function TuicrLayer(pi: ExtensionAPI, options: TuicrLayerOptions = {}): Layer.Layer<Tuicr, never, never> {
  const discoveryAttempts = Math.max(1, Math.floor(options.discoveryAttempts ?? 20))
  const discoveryDelayMs = Math.max(0, options.discoveryDelayMs ?? 250)

  return Layer.effect(
    Tuicr,
    Effect.gen(function* () {
      const paneRef = yield* Ref.make<PaneState | undefined>(undefined)

      const runProcess = Effect.fnUntraced(function* (
        command: string,
        args: readonly string[],
      ): Effect.fn.Return<ExecResult, TuicrProcessError> {
        const result = yield* Effect.tryPromise({
          try: (signal): Promise<ExecResult> => pi.exec(command, [...args], { signal }),
          catch: (cause) => processFailure(command, args, cause),
        })
        if (result.code !== 0) {
          return yield* resultFailure(command, args, result)
        }
        return result
      })

      const parseJson = Effect.fnUntraced(function* (
        command: string,
        args: readonly string[],
        stdout: string,
      ): Effect.fn.Return<unknown, TuicrProcessError> {
        return yield* Effect.try({
          try: () => JSON.parse(stdout) as unknown,
          catch: (cause) => processFailure(command, args, cause),
        })
      })

      const readSessions = Effect.fnUntraced(function* (
        repo: string,
      ): Effect.fn.Return<readonly SessionSummary[], TuicrProcessError> {
        const args = buildTuicrListArgs(repo)
        const result = yield* runProcess(TUICR_COMMAND, args)
        const value = yield* parseJson(TUICR_COMMAND, args, result.stdout)
        return yield* Schema.decodeUnknownEffect(SessionListSchema)(value).pipe(
          Effect.mapError((cause) => processFailure(TUICR_COMMAND, args, cause)),
        )
      })

      const readComments = Effect.fnUntraced(function* (
        repo: string,
        sessionSlug: string,
      ): Effect.fn.Return<readonly CommentData[], TuicrProcessError> {
        const args = buildTuicrCommentsArgs(repo, sessionSlug)
        const result = yield* runProcess(TUICR_COMMAND, args)
        const value = yield* parseJson(TUICR_COMMAND, args, result.stdout)
        return yield* Schema.decodeUnknownEffect(CommentListSchema)(value).pipe(
          Effect.mapError((cause) => processFailure(TUICR_COMMAND, args, cause)),
        )
      })

      const closeOwnedPane = Effect.fnUntraced(function* (): Effect.fn.Return<void, TuicrError | TuicrProcessError> {
        const pane = yield* Ref.get(paneRef)
        if (!pane) return
        if (!pane.owned) {
          return yield* stateFailure('close', 'refusing to close a pane not owned by tuicr')
        }
        yield* runProcess(HERDR_COMMAND, buildHerdrPaneCloseArgs(pane.paneId))
        yield* Ref.set(paneRef, undefined)
      })

      const discoverSession = Effect.fnUntraced(function* (
        repo: string,
        before: readonly SessionSummary[],
      ): Effect.fn.Return<SessionSummary, TuicrError | TuicrProcessError> {
        for (let attempt = 0; attempt < discoveryAttempts; attempt += 1) {
          const after = yield* readSessions(repo)
          const selection = selectNewSession(before, after)
          if (selection._tag === 'found') return selection.session
          if (selection._tag === 'ambiguous') {
            return yield* stateFailure('session-discovery', 'multiple new tuicr sessions were found')
          }

          if (before.every((session) => !session.active)) {
            const fallback = selectSessionSlug([], after)
            if (fallback._tag === 'found') return fallback.session
            if (fallback._tag === 'ambiguous') {
              return yield* stateFailure('session-discovery', 'multiple active tuicr sessions were found')
            }
          }

          if (attempt + 1 < discoveryAttempts) {
            yield* Effect.sleep(discoveryDelayMs)
          }
        }

        return yield* stateFailure('session-discovery', 'tuicr did not create a persisted review session')
      })

      const openAttempt = Effect.fnUntraced(function* (
        repo: string,
        scope: ReviewScope,
      ): Effect.fn.Return<TuicrOpenResult, TuicrError | TuicrProcessError> {
        if (!hasHerdrEnvironment(process.env.HERDR_ENV)) {
          return yield* stateFailure('open', 'HERDR_ENV=1 is required to open a tuicr pane')
        }

        const existing = yield* Ref.get(paneRef)
        if (existing) {
          return yield* stateFailure('open', 'a tuicr pane is already open')
        }

        const normalizedScope = yield* Effect.try({
          try: () => Schema.decodeUnknownSync(ReviewScopeSchema)(scope),
          catch: (cause) => stateFailure('open', String(cause)),
        })
        const before = yield* readSessions(repo)
        const splitArgs = buildHerdrPaneSplitArgs(repo)
        const splitResult = yield* runProcess(HERDR_COMMAND, splitArgs)
        const splitValue = yield* parseJson(HERDR_COMMAND, splitArgs, splitResult.stdout)
        const paneId = decodeHerdrPaneId(splitValue)
        if (!paneId) {
          return yield* stateFailure('open', 'Herdr pane split response did not contain a pane id')
        }

        const pane: PaneState = {
          paneId,
          repo,
          scope: normalizedScope,
          owned: true,
        }
        yield* Ref.set(paneRef, pane)
        const runArgs = buildHerdrPaneRunArgs(paneId, buildTuicrBlockingCommand(normalizedScope))
        yield* runProcess(HERDR_COMMAND, runArgs)
        const session = yield* discoverSession(repo, before)
        const activePane: PaneState = { ...pane, sessionSlug: session.slug }
        yield* Ref.set(paneRef, activePane)
        yield* runProcess(HERDR_COMMAND, buildHerdrPaneWaitOutputArgs(paneId, TUICR_COMPLETION_MARKER))
        const allComments = yield* readComments(repo, session.slug)
        return { pane: activePane, session, comments: normalizeComments(allComments) }
      })

      const open = Effect.fnUntraced(function* (
        repo: string,
        scope: ReviewScope,
      ): Effect.fn.Return<TuicrOpenResult, TuicrError | TuicrProcessError> {
        return yield* openAttempt(repo, scope).pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              yield* closeOwnedPane().pipe(Effect.catch(() => Effect.void))
              return yield* Effect.fail(error)
            }),
          ),
        )
      })

      const comments = Effect.fnUntraced(function* (): Effect.fn.Return<
        readonly CommentData[],
        TuicrError | TuicrProcessError
      > {
        const pane = yield* Ref.get(paneRef)
        if (!pane) {
          return yield* stateFailure('comments', 'no tuicr review is open')
        }
        if (!pane.sessionSlug) {
          return yield* stateFailure('comments', 'tuicr review session is not ready')
        }
        const allComments = yield* readComments(pane.repo, pane.sessionSlug)
        return normalizeComments(allComments)
      })

      const close = Effect.fnUntraced(function* (): Effect.fn.Return<void, TuicrError | TuicrProcessError> {
        if (!hasHerdrEnvironment(process.env.HERDR_ENV)) {
          return yield* stateFailure('close', 'HERDR_ENV=1 is required to close a tuicr pane')
        }
        yield* closeOwnedPane()
      })

      const shutdown = Effect.fnUntraced(function* (): Effect.fn.Return<void, never> {
        if (hasHerdrEnvironment(process.env.HERDR_ENV)) {
          yield* closeOwnedPane().pipe(Effect.catch(() => Effect.void))
        }
      })

      return Tuicr.of({ open, comments, close, shutdown })
    }),
  )
}
