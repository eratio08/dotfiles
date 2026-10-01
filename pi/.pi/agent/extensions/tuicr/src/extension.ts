import { randomUUID } from 'node:crypto'
import type { ExecResult, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, Ref, Result, Schema } from 'effect'

const HERDR_ENV_VALUE = '1'
const HERDR_COMMAND = 'herdr'
const TUICR_COMMAND = 'tuicr'
const TUICR_COMPLETION_MARKER = '__PI_TUICR_COMPLETED__'

const NonBlankStringSchema = Schema.Trim.check(Schema.isMinLength(1))

const ReviewScopeTypeSchema = Schema.Literals(['working-tree', 'revisions'] as const)
const WorkingTreeScopeSchema = Schema.Struct({
  type: Schema.Literal('working-tree'),
})
const RevisionsScopeSchema = Schema.Struct({
  type: Schema.Literal('revisions'),
  revset: NonBlankStringSchema,
})
const ReviewScopeSchema = Schema.Union([WorkingTreeScopeSchema, RevisionsScopeSchema])
type ReviewScope = (typeof ReviewScopeSchema)['Type']

const TuicrToolInputSchema = Schema.Struct({
  scope: ReviewScopeSchema,
})
type TuicrToolInput = (typeof TuicrToolInputSchema)['Type']

const PaneStateSchema = Schema.Struct({
  paneId: NonBlankStringSchema,
  repo: NonBlankStringSchema,
  scope: ReviewScopeSchema,
  owned: Schema.Literal(true),
  sessionSlug: Schema.optionalKey(NonBlankStringSchema),
})
type PaneState = (typeof PaneStateSchema)['Type']

const SessionKindSchema = Schema.Literals(['local', 'pr'] as const)
const SessionSummarySchema = Schema.Struct({
  slug: NonBlankStringSchema,
  kind: SessionKindSchema,
  path: Schema.String,
  updated_at: Schema.String,
  comment_count: Schema.Int,
  reviewed_count: Schema.Int,
  file_count: Schema.Int,
  anchor: Schema.String,
  active: Schema.Boolean,
})
type SessionSummary = (typeof SessionSummarySchema)['Type']
const SessionListSchema = Schema.Array(SessionSummarySchema)

const CommentSideSchema = Schema.NullOr(Schema.Literals(['old', 'new'] as const))
const CommentLifecycleStateSchema = Schema.Literals(['local_draft', 'pushed_draft', 'submitted'] as const)
const CommentDataSchema = Schema.Struct({
  id: NonBlankStringSchema,
  location: NonBlankStringSchema,
  path: Schema.NullOr(Schema.String),
  start_line: Schema.NullOr(Schema.Int),
  end_line: Schema.NullOr(Schema.Int),
  side: CommentSideSchema,
  comment_type: Schema.String,
  lifecycle_state: CommentLifecycleStateSchema,
  created_at: Schema.String,
  content: Schema.String,
  author: Schema.optionalKey(Schema.String),
})
type CommentData = (typeof CommentDataSchema)['Type']
const CommentListSchema = Schema.Array(CommentDataSchema)

const HerdrPaneSplitResponseSchema = Schema.Struct({
  result: Schema.Struct({
    pane: Schema.Struct({
      pane_id: NonBlankStringSchema,
    }),
  }),
})
type HerdrPaneSplitResponse = (typeof HerdrPaneSplitResponseSchema)['Type']

const HerdrPaneWaitOutputResponseSchema = Schema.Struct({
  result: Schema.Struct({
    matched_line: NonBlankStringSchema,
  }),
})
type HerdrPaneWaitOutputResponse = (typeof HerdrPaneWaitOutputResponseSchema)['Type']

type SessionSelection =
  | { readonly _tag: 'found'; readonly session: SessionSummary }
  | { readonly _tag: 'none' }
  | { readonly _tag: 'ambiguous'; readonly sessions: readonly SessionSummary[] }

type SessionComparison = {
  readonly added: readonly SessionSummary[]
  readonly removed: readonly SessionSummary[]
  readonly unchanged: readonly SessionSummary[]
}

function hasHerdrEnvironment(value: unknown): boolean {
  return value === HERDR_ENV_VALUE
}

function sameSession(left: SessionSummary, right: SessionSummary): boolean {
  return left.slug === right.slug
}

function compareSessions(before: readonly SessionSummary[], after: readonly SessionSummary[]): SessionComparison {
  return {
    added: after.filter((candidate) => !before.some((previous) => sameSession(previous, candidate))),
    removed: before.filter((previous) => !after.some((candidate) => sameSession(previous, candidate))),
    unchanged: after.filter((candidate) => before.some((previous) => sameSession(previous, candidate))),
  }
}

function selectActiveSession(sessions: readonly SessionSummary[]): SessionSelection {
  const active = sessions.filter((session) => session.active)
  if (active.length === 1) {
    const session = active[0]
    if (session) return { _tag: 'found', session }
  }
  if (active.length > 1) return { _tag: 'ambiguous', sessions: active }
  return { _tag: 'none' }
}

function selectNewSession(before: readonly SessionSummary[], after: readonly SessionSummary[]): SessionSelection {
  const added = compareSessions(before, after).added
  if (added.length === 1) {
    const session = added[0]
    if (session) return { _tag: 'found', session }
  }
  if (added.length > 1) return { _tag: 'ambiguous', sessions: added }
  return { _tag: 'none' }
}

function selectSessionSlug(before: readonly SessionSummary[], after: readonly SessionSummary[]): SessionSelection {
  const newSession = selectNewSession(before, after)
  if (newSession._tag !== 'none') return newSession

  const updated = after.filter((candidate) =>
    before.some(
      (previous) => sameSession(previous, candidate) && JSON.stringify(previous) !== JSON.stringify(candidate),
    ),
  )
  if (updated.length === 1) {
    const session = updated[0]
    if (session) return { _tag: 'found', session }
  }
  if (updated.length > 1) return { _tag: 'ambiguous', sessions: updated }
  return selectActiveSession(after)
}

function decodeSessionList(value: unknown): Result.Result<readonly SessionSummary[], Schema.SchemaError> {
  return Schema.decodeUnknownResult(SessionListSchema)(value)
}

function decodeCommentList(value: unknown): Result.Result<readonly CommentData[], Schema.SchemaError> {
  return Schema.decodeUnknownResult(CommentListSchema)(value)
}

function isUserComment(comment: CommentData, userAuthor = 'user'): boolean {
  const author = comment.author?.trim()
  return author === undefined || author === userAuthor.trim()
}

function normalizeComments(comments: readonly CommentData[], userAuthor = 'user'): readonly CommentData[] {
  return comments.filter((comment) => isUserComment(comment, userAuthor))
}

function decodeHerdrPaneId(value: unknown): string | null {
  const decoded = Schema.decodeUnknownResult(HerdrPaneSplitResponseSchema)(value)
  return Result.isSuccess(decoded) ? decoded.success.result.pane.pane_id : null
}

function buildReviewScopeArgs(scope: unknown): readonly string[] {
  const decoded = Schema.decodeUnknownSync(ReviewScopeSchema)(scope)
  return decoded.type === 'working-tree' ? ['--working-tree'] : ['--revisions', decoded.revset]
}

function buildTuicrArgs(scope: unknown, useStdout = false): readonly string[] {
  return ['tui', ...buildReviewScopeArgs(scope), ...(useStdout ? ['--stdout'] : [])]
}

function buildTuicrListArgs(repo: string): readonly string[] {
  return ['review', 'list', '--repo', repo]
}

function buildTuicrCommentsArgs(repo: string, sessionSlug: string): readonly string[] {
  return ['review', 'comments', '--repo', repo, '--session', sessionSlug]
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function buildShellCommand(command: string, args: readonly string[] = []): string {
  return [command, ...args].map(shellQuote).join(' ')
}

function buildTuicrCommand(scope: unknown, useStdout = false): string {
  return buildShellCommand(TUICR_COMMAND, buildTuicrArgs(scope, useStdout))
}

function buildTuicrBlockingCommand(
  scope: unknown,
  completionMarker = TUICR_COMPLETION_MARKER,
  useStdout = false,
): string {
  const splitAt = Math.floor(completionMarker.length / 2)
  const completionCommand = `${buildShellCommand('printf', [
    '\\n%s%s:%s\\n',
    completionMarker.slice(0, splitAt),
    completionMarker.slice(splitAt),
  ])} $?`
  return `bash -c ${shellQuote(`${buildTuicrCommand(scope, useStdout)}; ${completionCommand}`)}`
}

function buildHerdrPaneSplitArgs(repo: string, direction = 'right'): readonly string[] {
  return ['pane', 'split', '--current', '--direction', direction, '--cwd', repo, '--focus']
}

function buildHerdrPaneRunArgs(paneId: string, command: string): readonly string[] {
  return ['pane', 'run', paneId, command]
}

function buildHerdrPaneZoomArgs(paneId: string, zoomed: boolean): readonly string[] {
  return ['pane', 'zoom', zoomed ? '--on' : '--off', '--pane', paneId]
}

function buildHerdrPaneWaitOutputArgs(paneId: string, match: string): readonly string[] {
  return ['pane', 'wait-output', paneId, '--match', match, '--source', 'recent-unwrapped']
}

function buildHerdrPaneCloseArgs(paneId: string): readonly string[] {
  return ['pane', 'close', paneId]
}

export {
  buildHerdrPaneCloseArgs,
  buildHerdrPaneRunArgs,
  buildHerdrPaneSplitArgs,
  buildHerdrPaneWaitOutputArgs,
  buildHerdrPaneZoomArgs,
  buildReviewScopeArgs,
  buildShellCommand,
  buildTuicrArgs,
  buildTuicrBlockingCommand,
  buildTuicrCommand,
  buildTuicrCommentsArgs,
  buildTuicrListArgs,
  type CommentData,
  CommentDataSchema,
  CommentLifecycleStateSchema,
  CommentListSchema,
  CommentSideSchema,
  compareSessions,
  decodeCommentList,
  decodeHerdrPaneId,
  decodeSessionList,
  HERDR_COMMAND,
  HERDR_ENV_VALUE,
  type HerdrPaneSplitResponse,
  HerdrPaneSplitResponseSchema,
  type HerdrPaneWaitOutputResponse,
  HerdrPaneWaitOutputResponseSchema,
  hasHerdrEnvironment,
  isUserComment,
  NonBlankStringSchema,
  normalizeComments,
  type PaneState,
  PaneStateSchema,
  type ReviewScope,
  ReviewScopeSchema,
  ReviewScopeTypeSchema,
  RevisionsScopeSchema,
  type SessionComparison,
  SessionKindSchema,
  SessionListSchema,
  type SessionSelection,
  type SessionSummary,
  SessionSummarySchema,
  sameSession,
  selectActiveSession,
  selectNewSession,
  selectSessionSlug,
  shellQuote,
  TUICR_COMMAND,
  TUICR_COMPLETION_MARKER,
  type TuicrToolInput,
  TuicrToolInputSchema,
  WorkingTreeScopeSchema,
}

class TuicrError extends Schema.TaggedError<TuicrError>()('TuicrError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

class TuicrProcessError extends Schema.TaggedError<TuicrProcessError>()('TuicrProcessError', {
  command: Schema.String,
  message: Schema.String,
  code: Schema.optionalKey(Schema.Number),
  stderr: Schema.optionalKey(Schema.String),
}) {}

type TuicrOpenResult = {
  readonly pane: PaneState
  readonly session?: SessionSummary
  readonly comments: readonly CommentData[]
}

class Tuicr extends Context.Service<
  Tuicr,
  {
    readonly open: (repo: string, scope: ReviewScope) => Effect.Effect<TuicrOpenResult, TuicrError | TuicrProcessError>
    readonly shutdown: () => Effect.Effect<void, never>
  }
>()('tuicr/Tuicr') {}

type TuicrLayerOptions = {
  readonly discoveryAttempts?: number
  readonly discoveryDelayMs?: number
}

class TuicrPi extends Context.Service<TuicrPi, ExtensionAPI>()('tuicr/Pi') {}

class TuicrConfig extends Context.Service<TuicrConfig, TuicrLayerOptions>()('tuicr/TuicrConfig') {}

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

const TuicrLayer: Layer.Layer<Tuicr, never, TuicrPi | TuicrConfig> = Layer.effect(
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
        try: (signal: AbortSignal): Promise<ExecResult> => pi.exec(command, [...args], { signal }),
        catch: (cause: unknown) => processFailure(command, args, cause),
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
        catch: (cause: unknown) => processFailure(command, args, cause),
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
        catch: (cause: unknown) => stateFailure('open', String(cause)),
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

export {
  Tuicr,
  TuicrConfig,
  TuicrError,
  TuicrLayer,
  type TuicrLayerOptions,
  type TuicrOpenResult,
  TuicrPi,
  TuicrProcessError,
}
