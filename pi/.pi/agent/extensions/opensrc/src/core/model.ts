type SourceType = 'npm' | 'pypi' | 'crates' | 'repo'

type PackageSourceType = Exclude<SourceType, 'repo'>

type Source = {
  readonly type: SourceType
  readonly name: string
  readonly version: string
  readonly path: string
  readonly fetchedAt: string
}

type SourceIndexRecord = {
  readonly name: string
  readonly version: string
  readonly path: string
  readonly fetchedAt?: string
  readonly fetched_at?: string
  readonly registry?: PackageSourceType
  readonly type?: SourceType
}

type SourceIndex = { readonly packages?: readonly SourceIndexRecord[]; readonly repos?: readonly SourceIndexRecord[] }

type FileEntry = {
  readonly path: string
  readonly type: 'file' | 'directory'
  readonly size: number
  readonly modifiedAt?: string
}

type TreeNode = { readonly name: string; readonly type: 'file' | 'directory'; readonly children?: readonly TreeNode[] }

type SourcePosition = { readonly line: number; readonly column: number; readonly offset: number }

type GrepResult = {
  readonly source: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly text: string
}

type AstGrepMatch = {
  readonly source: string
  readonly file: string
  readonly text: string
  readonly start: SourcePosition
  readonly end: SourcePosition
  readonly line: number
  readonly column: number
  readonly metavars: Readonly<Record<string, string>>
}

type ParsedSpec = {
  readonly type: SourceType
  readonly name: string
  readonly version?: string
  readonly ref?: string
  readonly repository?: string
}

type FetchedSource = { readonly source: Source; readonly alreadyExists: boolean }

type RemoveResult = { readonly success: true; readonly removed: readonly string[] }

type CleanOptions = {
  readonly packages?: boolean
  readonly repos?: boolean
  readonly npm?: boolean
  readonly pypi?: boolean
  readonly crates?: boolean
}

type TreeOptions = { readonly depth?: number; readonly pattern?: string }

type GrepOptions = { readonly sources?: readonly string[]; readonly include?: string; readonly maxResults?: number }

type AstGrepOptions = { readonly glob?: string; readonly lang?: string | readonly string[]; readonly limit?: number }

type OpensrcFailureTag =
  | 'validation'
  | 'source-not-found'
  | 'cli'
  | 'filesystem'
  | 'parser'
  | 'cancellation'
  | 'timeout'
  | 'code-evaluation'
  | 'runtime'

type OpensrcFailureFields = {
  readonly _tag: OpensrcFailureTag
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
}

class OpensrcFailure extends Error {
  readonly _tag: OpensrcFailureTag
  readonly operation: string
  readonly cause?: unknown

  constructor(fields: OpensrcFailureFields) {
    super(fields.message)
    this.name = 'OpensrcFailure'
    this._tag = fields._tag
    this.operation = fields.operation
    if ('cause' in fields) this.cause = fields.cause
  }
}

function createOpensrcFailure(fields: OpensrcFailureFields): OpensrcFailure {
  return new OpensrcFailure(fields)
}

type SourceDiff = {
  readonly added: readonly Source[]
  readonly removed: readonly Source[]
  readonly unchanged: readonly Source[]
}

type PiExecutionResult = {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
  readonly killed: boolean
}

type PiExecutionRequest = {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly environment: Readonly<Record<string, string | undefined>>
}

type SourceFile = { readonly path: string; readonly content: string }

type RawAstMatch = {
  readonly source?: string
  readonly file: string
  readonly text: string
  readonly start: SourcePosition
  readonly end: SourcePosition
  readonly metavars?: Readonly<Record<string, string>>
}

type CliCommandPlan = {
  readonly operation: 'fetch' | 'list' | 'remove' | 'clean' | 'version'
  readonly args: readonly string[]
}

export {
  type AstGrepMatch,
  type AstGrepOptions,
  type CleanOptions,
  type CliCommandPlan,
  createOpensrcFailure,
  type FetchedSource,
  type FileEntry,
  type GrepOptions,
  type GrepResult,
  OpensrcFailure,
  type OpensrcFailureTag,
  type PackageSourceType,
  type ParsedSpec,
  type PiExecutionRequest,
  type PiExecutionResult,
  type RawAstMatch,
  type RemoveResult,
  type Source,
  type SourceDiff,
  type SourceFile,
  type SourceIndex,
  type SourceIndexRecord,
  type SourcePosition,
  type SourceType,
  type TreeNode,
  type TreeOptions,
}
