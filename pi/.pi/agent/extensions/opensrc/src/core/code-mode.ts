const OPENSRC_CODE_TYPES = `
type Source = { readonly type: 'npm' | 'pypi' | 'crates' | 'repo'; readonly name: string; readonly version: string; readonly path: string; readonly fetchedAt: string }
type FileEntry = { readonly path: string; readonly type: 'file' | 'directory'; readonly size: number; readonly modifiedAt?: string }
type TreeNode = { readonly name: string; readonly type: 'file' | 'directory'; readonly children?: readonly TreeNode[] }
type TreeOptions = { readonly depth?: number; readonly pattern?: string }
type GrepResult = { readonly source: string; readonly file: string; readonly line: number; readonly column: number; readonly text: string }
type GrepOptions = { readonly sources?: readonly string[]; readonly include?: string; readonly maxResults?: number }
type AstGrepPosition = { readonly line: number; readonly column: number; readonly offset: number }
type AstGrepMatch = { readonly source: string; readonly file: string; readonly text: string; readonly start: AstGrepPosition; readonly end: AstGrepPosition; readonly line: number; readonly column: number; readonly metavars: Readonly<Record<string, string>> }
type AstGrepOptions = { readonly glob?: string; readonly lang?: string | readonly string[]; readonly limit?: number }
type ParsedSpec = { readonly type: 'npm' | 'pypi' | 'crates' | 'repo'; readonly name: string; readonly version?: string; readonly ref?: string; readonly repository?: string }
type FetchedSource = { readonly source: Source; readonly alreadyExists: boolean }
type RemoveResult = { readonly success: true; readonly removed: readonly string[] }
type CleanOptions = { readonly packages?: boolean; readonly repos?: boolean; readonly npm?: boolean; readonly pypi?: boolean; readonly crates?: boolean }
type OpensrcFailureTag = 'validation' | 'source-not-found' | 'cli' | 'filesystem' | 'parser' | 'cancellation' | 'timeout' | 'code-evaluation' | 'runtime'
type OpensrcFailure = { readonly _tag: OpensrcFailureTag; readonly operation: string; readonly message: string; readonly cause?: unknown }
type OpensrcHostError = { readonly type: 'code-mode-host-error'; readonly value: OpensrcFailure }
`

export { OPENSRC_CODE_TYPES }
