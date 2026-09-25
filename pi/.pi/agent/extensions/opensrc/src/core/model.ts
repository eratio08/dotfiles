type SourceType = 'npm' | 'pypi' | 'crates' | 'repo'

type PackageSourceType = Exclude<SourceType, 'repo'>

interface Source {
  readonly type: SourceType
  readonly name: string
  readonly version: string
  readonly path: string
  readonly fetchedAt: string
}

interface SourceIndexRecord {
  readonly name: string
  readonly version: string
  readonly path: string
  readonly fetchedAt?: string
  readonly fetched_at?: string
  readonly registry?: PackageSourceType
  readonly type?: SourceType
}

interface SourceIndex {
  readonly packages?: readonly SourceIndexRecord[]
  readonly repos?: readonly SourceIndexRecord[]
}

interface FileEntry {
  readonly path: string
  readonly type: 'file' | 'directory'
  readonly size: number
  readonly modifiedAt?: string
}

interface TreeNode {
  readonly name: string
  readonly type: 'file' | 'directory'
  readonly children?: readonly TreeNode[]
}

interface SourcePosition {
  readonly line: number
  readonly column: number
  readonly offset: number
}

interface GrepResult {
  readonly source: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly text: string
}

interface AstGrepMatch {
  readonly source: string
  readonly file: string
  readonly text: string
  readonly start: SourcePosition
  readonly end: SourcePosition
  readonly line: number
  readonly column: number
  readonly metavars: Readonly<Record<string, string>>
}

interface ParsedSpec {
  readonly type: SourceType
  readonly name: string
  readonly version?: string
  readonly ref?: string
  readonly repository?: string
}

interface FetchedSource {
  readonly source: Source
  readonly alreadyExists: boolean
}

interface RemoveResult {
  readonly success: true
  readonly removed: readonly string[]
}

interface CleanOptions {
  readonly packages?: boolean
  readonly repos?: boolean
  readonly npm?: boolean
  readonly pypi?: boolean
  readonly crates?: boolean
}

interface TreeOptions {
  readonly depth?: number
  readonly pattern?: string
}

interface GrepOptions {
  readonly sources?: readonly string[]
  readonly include?: string
  readonly maxResults?: number
}

interface AstGrepOptions {
  readonly glob?: string
  readonly lang?: string | readonly string[]
  readonly limit?: number
}

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

interface OpensrcFailureFields {
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

interface SourceDiff {
  readonly added: readonly Source[]
  readonly removed: readonly Source[]
  readonly unchanged: readonly Source[]
}

interface PiExecutionResult {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
  readonly killed: boolean
}

interface PiExecutionRequest {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly environment: Readonly<Record<string, string | undefined>>
}

interface SourceFile {
  readonly path: string
  readonly content: string
}

interface RawAstMatch {
  readonly source?: string
  readonly file: string
  readonly text: string
  readonly start: SourcePosition
  readonly end: SourcePosition
  readonly metavars?: Readonly<Record<string, string>>
}

interface CliCommandPlan {
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
