import { randomUUID } from 'node:crypto'
import type { ExecResult, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, Ref, Schema } from 'effect'
import {
  buildHerdrPaneCloseArgs,
  buildHerdrPaneRunArgs,
  buildHerdrPaneSplitArgs,
  buildHerdrPaneWaitOutputArgs,
  buildHerdrPaneZoomArgs,
  buildTuicrBlockingCommand,
  buildTuicrCommentsArgs,
  buildTuicrListArgs,
  type CommentData,
  CommentListSchema,
  decodeHerdrPaneId,
  HERDR_COMMAND,
  HerdrPaneWaitOutputResponseSchema,
  hasHerdrEnvironment,
  normalizeComments,
  type PaneState,
  type ReviewScope,
  ReviewScopeSchema,
  SessionListSchema,
  type SessionSummary,
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
  readonly session?: SessionSummary
  readonly comments: readonly CommentData[]
}

export class Tuicr extends Context.Service<
  Tuicr,
  {
    readonly open: (repo: string, scope: ReviewScope) => Effect.Effect<TuicrOpenResult, TuicrError | TuicrProcessError>
    readonly shutdown: () => Effect.Effect<void, never>
  }
>()('tuicr/Tuicr') {}

export type TuicrLayerOptions = {
  readonly discoveryAttempts?: number
  readonly discoveryDelayMs?: number
}

export class TuicrPi extends Context.Service<TuicrPi, ExtensionAPI>()('tuicr/Pi') {}

export class TuicrConfig extends Context.Service<TuicrConfig, TuicrLayerOptions>()('tuicr/TuicrConfig') {}

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

export const TuicrLayer: Layer.Layer<Tuicr, never, TuicrPi | TuicrConfig> = Layer.effect(
  Tuicr,
  Effect.gen(function* () {
    const pi = yield* TuicrPi
    const options = yield* TuicrConfig
    const discoveryAttempts = Math.max(1, Math.floor(options.discoveryAttempts ?? 1))
    const discoveryDelayMs = Math.max(0, options.discoveryDelayMs ?? 0)
    const herdrCommand = process.env.HERDR_BIN?.trim() || HERDR_COMMAND
    const paneDirection = process.env.TUICR_PANE_DIRECTION === 'down' ? 'down' : 'right'

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
      yield* runProcess(herdrCommand, buildHerdrPaneZoomArgs(pane.paneId, false)).pipe(Effect.catch(() => Effect.void))
      yield* runProcess(herdrCommand, buildHerdrPaneCloseArgs(pane.paneId))
      yield* Ref.set(paneRef, undefined)
    })

    const discoverSession = Effect.fnUntraced(function* (
      repo: string,
      before: readonly SessionSummary[],
    ): Effect.fn.Return<SessionSummary | undefined, TuicrError | TuicrProcessError> {
      for (let attempt = 0; attempt < discoveryAttempts; attempt += 1) {
        const after = yield* readSessions(repo)
        const selection = selectSessionSlug(before, after)
        if (selection._tag === 'found') return selection.session
        if (selection._tag === 'ambiguous') {
          return yield* stateFailure('session-discovery', 'multiple relevant tuicr sessions were found')
        }

        if (attempt + 1 < discoveryAttempts) {
          yield* Effect.sleep(discoveryDelayMs)
        }
      }

      return undefined
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
      const helpResult = yield* runProcess(TUICR_COMMAND, ['--help']).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      )
      const useStdout = helpResult !== undefined && `${helpResult.stdout}\n${helpResult.stderr}`.includes('--stdout')
      const before = yield* readSessions(repo)
      const splitArgs = buildHerdrPaneSplitArgs(repo, paneDirection)
      const splitResult = yield* runProcess(herdrCommand, splitArgs)
      const splitValue = yield* parseJson(herdrCommand, splitArgs, splitResult.stdout)
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
      yield* runProcess(herdrCommand, buildHerdrPaneZoomArgs(paneId, true))
      const completionMarker = `${TUICR_COMPLETION_MARKER}_${randomUUID()}`
      const runArgs = buildHerdrPaneRunArgs(
        paneId,
        buildTuicrBlockingCommand(normalizedScope, completionMarker, useStdout),
      )
      yield* runProcess(herdrCommand, runArgs)
      const waitArgs = buildHerdrPaneWaitOutputArgs(paneId, completionMarker)
      const waitResult = yield* runProcess(herdrCommand, waitArgs)
      const waitValue = yield* parseJson(herdrCommand, waitArgs, waitResult.stdout)
      const waitResponse = yield* Schema.decodeUnknownEffect(HerdrPaneWaitOutputResponseSchema)(waitValue).pipe(
        Effect.mapError((cause) => processFailure(herdrCommand, waitArgs, cause)),
      )
      const matchedLine = waitResponse.result.matched_line
      const statusText = matchedLine.slice(matchedLine.lastIndexOf(':') + 1)
      if (!matchedLine.includes(completionMarker) || !/^\d+$/.test(statusText)) {
        return yield* stateFailure('review', 'Herdr output did not contain a tuicr exit status')
      }
      const tuicrStatus = Number(statusText)
      if (tuicrStatus !== 0) {
        return yield* stateFailure('review', `tuicr exited with status ${tuicrStatus}`)
      }
      const session = yield* discoverSession(repo, before)
      const activePane: PaneState = session ? { ...pane, sessionSlug: session.slug } : pane
      yield* Ref.set(paneRef, activePane)
      const allComments = session ? yield* readComments(repo, session.slug) : []
      return { pane: activePane, session, comments: normalizeComments(allComments) }
    })

    const open = Effect.fnUntraced(function* (
      repo: string,
      scope: ReviewScope,
    ): Effect.fn.Return<TuicrOpenResult, TuicrError | TuicrProcessError> {
      return yield* Effect.ensuring(openAttempt(repo, scope), closeOwnedPane().pipe(Effect.catch(() => Effect.void)))
    })

    const shutdown = Effect.fnUntraced(function* (): Effect.fn.Return<void, never> {
      if (hasHerdrEnvironment(process.env.HERDR_ENV)) {
        yield* closeOwnedPane().pipe(Effect.catch(() => Effect.void))
      }
    })

    return Tuicr.of({ open, shutdown })
  }),
)
