import { Result, Schema } from 'effect'

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
