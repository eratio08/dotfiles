import { Result, Schema } from 'effect'

export const HERDR_ENV_VALUE = '1'
export const HERDR_COMMAND = 'herdr'
export const TUICR_COMMAND = 'tuicr'
export const TUICR_COMPLETION_MARKER = '__PI_TUICR_COMPLETED__'

export const NonBlankStringSchema = Schema.Trim.check(Schema.isMinLength(1))

export const ReviewScopeTypeSchema = Schema.Literals(['working-tree', 'revisions'] as const)
export const WorkingTreeScopeSchema = Schema.Struct({
  type: Schema.Literal('working-tree'),
})
export const RevisionsScopeSchema = Schema.Struct({
  type: Schema.Literal('revisions'),
  revset: NonBlankStringSchema,
})
export const ReviewScopeSchema = Schema.Union([WorkingTreeScopeSchema, RevisionsScopeSchema])
export type ReviewScope = (typeof ReviewScopeSchema)['Type']

export const TuicrActionSchema = Schema.Literals(['open', 'comments', 'close'] as const)
export const OpenReviewInputSchema = Schema.Struct({
  action: Schema.Literal('open'),
  scope: ReviewScopeSchema,
})
export const CommentsInputSchema = Schema.Struct({
  action: Schema.Literal('comments'),
})
export const CloseInputSchema = Schema.Struct({
  action: Schema.Literal('close'),
})
export const TuicrToolInputSchema = Schema.Union([OpenReviewInputSchema, CommentsInputSchema, CloseInputSchema])
export type TuicrAction = (typeof TuicrActionSchema)['Type']
export type TuicrToolInput = (typeof TuicrToolInputSchema)['Type']

export const PaneStateSchema = Schema.Struct({
  paneId: NonBlankStringSchema,
  repo: NonBlankStringSchema,
  scope: ReviewScopeSchema,
  owned: Schema.Literal(true),
  sessionSlug: Schema.optionalKey(NonBlankStringSchema),
})
export type PaneState = (typeof PaneStateSchema)['Type']

export const SessionKindSchema = Schema.Literals(['local', 'pr'] as const)
export const SessionSummarySchema = Schema.Struct({
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
export type SessionSummary = (typeof SessionSummarySchema)['Type']
export const SessionListSchema = Schema.Array(SessionSummarySchema)

export const CommentSideSchema = Schema.NullOr(Schema.Literals(['old', 'new'] as const))
export const CommentLifecycleStateSchema = Schema.Literals(['local_draft', 'pushed_draft', 'submitted'] as const)
export const CommentDataSchema = Schema.Struct({
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
export type CommentData = (typeof CommentDataSchema)['Type']
export const CommentListSchema = Schema.Array(CommentDataSchema)

export const HerdrPaneSplitResponseSchema = Schema.Struct({
  result: Schema.Struct({
    pane: Schema.Struct({
      pane_id: NonBlankStringSchema,
    }),
  }),
})
export type HerdrPaneSplitResponse = (typeof HerdrPaneSplitResponseSchema)['Type']

export type SessionSelection =
  | { readonly _tag: 'found'; readonly session: SessionSummary }
  | { readonly _tag: 'none' }
  | { readonly _tag: 'ambiguous'; readonly sessions: readonly SessionSummary[] }

export type SessionComparison = {
  readonly added: readonly SessionSummary[]
  readonly removed: readonly SessionSummary[]
  readonly unchanged: readonly SessionSummary[]
}

export function hasHerdrEnvironment(value: unknown): boolean {
  return value === HERDR_ENV_VALUE
}

export function sameSession(left: SessionSummary, right: SessionSummary): boolean {
  return left.slug === right.slug
}

export function compareSessions(
  before: readonly SessionSummary[],
  after: readonly SessionSummary[],
): SessionComparison {
  return {
    added: after.filter((candidate) => !before.some((previous) => sameSession(previous, candidate))),
    removed: before.filter((previous) => !after.some((candidate) => sameSession(previous, candidate))),
    unchanged: after.filter((candidate) => before.some((previous) => sameSession(previous, candidate))),
  }
}

export function selectActiveSession(sessions: readonly SessionSummary[]): SessionSelection {
  const active = sessions.filter((session) => session.active)
  if (active.length === 1) {
    const session = active[0]
    if (session) return { _tag: 'found', session }
  }
  if (active.length > 1) return { _tag: 'ambiguous', sessions: active }
  return { _tag: 'none' }
}

export function selectNewSession(
  before: readonly SessionSummary[],
  after: readonly SessionSummary[],
): SessionSelection {
  const added = compareSessions(before, after).added
  if (added.length === 1) {
    const session = added[0]
    if (session) return { _tag: 'found', session }
  }
  if (added.length > 1) return { _tag: 'ambiguous', sessions: added }
  return { _tag: 'none' }
}

export function selectSessionSlug(
  before: readonly SessionSummary[],
  after: readonly SessionSummary[],
): SessionSelection {
  const newSession = selectNewSession(before, after)
  if (newSession._tag !== 'none') return newSession
  return selectActiveSession(after)
}

export function decodeSessionList(value: unknown): Result.Result<readonly SessionSummary[], Schema.SchemaError> {
  return Schema.decodeUnknownResult(SessionListSchema)(value)
}

export function decodeCommentList(value: unknown): Result.Result<readonly CommentData[], Schema.SchemaError> {
  return Schema.decodeUnknownResult(CommentListSchema)(value)
}

export function isUserComment(comment: CommentData, userAuthor = 'user'): boolean {
  const author = comment.author?.trim()
  return author === undefined || author === userAuthor.trim()
}

export function normalizeComments(comments: readonly CommentData[], userAuthor = 'user'): readonly CommentData[] {
  return comments.filter((comment) => isUserComment(comment, userAuthor))
}

export function decodeHerdrPaneId(value: unknown): string | null {
  const decoded = Schema.decodeUnknownResult(HerdrPaneSplitResponseSchema)(value)
  return Result.isSuccess(decoded) ? decoded.success.result.pane.pane_id : null
}

export function buildReviewScopeArgs(scope: unknown): readonly string[] {
  const decoded = Schema.decodeUnknownSync(ReviewScopeSchema)(scope)
  return decoded.type === 'working-tree' ? ['--working-tree'] : ['--revisions', decoded.revset]
}

export function buildTuicrArgs(scope: unknown): readonly string[] {
  return ['tui', ...buildReviewScopeArgs(scope)]
}

export function buildTuicrListArgs(repo: string): readonly string[] {
  return ['review', 'list', '--repo', repo]
}

export function buildTuicrCommentsArgs(repo: string, sessionSlug: string): readonly string[] {
  return ['review', 'comments', '--repo', repo, '--session', sessionSlug]
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function buildShellCommand(command: string, args: readonly string[] = []): string {
  return [command, ...args].map(shellQuote).join(' ')
}

export function buildTuicrCommand(scope: unknown): string {
  return buildShellCommand(TUICR_COMMAND, buildTuicrArgs(scope))
}

export function buildTuicrBlockingCommand(scope: unknown): string {
  const splitAt = Math.floor(TUICR_COMPLETION_MARKER.length / 2)
  return `${buildTuicrCommand(scope)}; ${buildShellCommand('printf', [
    '%s%s\\n',
    TUICR_COMPLETION_MARKER.slice(0, splitAt),
    TUICR_COMPLETION_MARKER.slice(splitAt),
  ])}`
}

export function buildHerdrPaneSplitArgs(repo: string): readonly string[] {
  return ['pane', 'split', '--current', '--direction', 'right', '--cwd', repo, '--no-focus']
}

export function buildHerdrPaneRunArgs(paneId: string, command: string): readonly string[] {
  return ['pane', 'run', paneId, command]
}

export function buildHerdrPaneWaitOutputArgs(paneId: string, match: string): readonly string[] {
  return ['pane', 'wait-output', paneId, '--match', match, '--source', 'recent-unwrapped']
}

export function buildHerdrPaneReadArgs(paneId: string, lines = 200): readonly string[] {
  return ['pane', 'read', paneId, '--source', 'recent-unwrapped', '--lines', String(lines)]
}

export function buildHerdrPaneCloseArgs(paneId: string): readonly string[] {
  return ['pane', 'close', paneId]
}
