import type { OpensrcProgram } from './model.ts'

const OPENSRC_CODE_TYPES = `
interface OpensrcApi {
  list(): readonly Source[]
  has(name: string, version?: string): boolean
  get(name: string): Source | undefined
  files(sourceName: string, glob?: string): Promise<readonly FileEntry[]>
  tree(sourceName: string, options?: { depth?: number; pattern?: string }): Promise<TreeNode>
  grep(pattern: string, options?: { sources?: readonly string[]; include?: string; maxResults?: number }): Promise<readonly GrepResult[]>
  astGrep(sourceName: string, pattern: string, options?: { glob?: string; lang?: string | readonly string[]; limit?: number }): Promise<readonly AstGrepMatch[]>
  read(sourceName: string, filePath: string): Promise<string>
  readMany(sourceName: string, paths: readonly string[]): Promise<Readonly<Record<string, string>>>
  resolve(spec: string): ParsedSpec
  fetch(specs: string | readonly string[]): Promise<readonly FetchedSource[]>
  remove(names: readonly string[]): Promise<RemoveResult>
  clean(options?: CleanOptions): Promise<RemoveResult>
  help(): string
}
type Source = { type: 'npm' | 'pypi' | 'crates' | 'repo'; name: string; version: string; path: string; fetchedAt: string }
type FileEntry = { path: string; type: 'file' | 'directory'; size: number; modifiedAt?: string }
type TreeNode = { name: string; type: 'file' | 'directory'; children?: readonly TreeNode[] }
type GrepResult = { source: string; file: string; line: number; column: number; text: string }
type AstGrepMatch = { source: string; file: string; text: string; start: { line: number; column: number; offset: number }; end: { line: number; column: number; offset: number }; line: number; column: number; metavars: Readonly<Record<string, string>> }
type ParsedSpec = { type: 'npm' | 'pypi' | 'crates' | 'repo'; name: string; version?: string; ref?: string; repository?: string }
type FetchedSource = { source: Source; alreadyExists: boolean }
type RemoveResult = { success: true; removed: readonly string[] }
type CleanOptions = { packages?: boolean; repos?: boolean; npm?: boolean; pypi?: boolean; crates?: boolean }
type OpensrcProgram = (api: OpensrcApi) => unknown | Promise<unknown>
`

const OPENSRC_API_HELP = `# opensrc API reference

Write a TypeScript module that exports one default function.
The function receives an OpensrcApi object and can return a value or a promise.

${OPENSRC_CODE_TYPES}
Supported package specs include zod, npm:zod, zod@3.22.0, @scope/name, npm:@scope/name@1.0.0, pypi:requests, pip:requests==2.0.0, crates:serde, and cargo:serde@1.0.0.
Supported repository specs include owner/repo, owner/repo@ref, github:owner/repo, gitlab:owner/repo, bitbucket:owner/repo, and full GitHub, GitLab, or Bitbucket URLs.
Use source.name after fetch because the cache can normalize repository names.
Use one program to batch related reads and searches.
The API can fetch source code and mutate the shared local cache.

Example:
\`\`\`typescript
export default async (opensrc: OpensrcApi) => {
  const sources = opensrc.list()
  return sources.map((source) => ({ name: source.name, type: source.type, version: source.version }))
}
\`\`\`

Example:
\`\`\`typescript
export default async (opensrc: OpensrcApi) => {
  const [{ source }] = await opensrc.fetch(['zod'])
  return await opensrc.readMany(source.name, ['package.json', 'README.md'])
}
\`\`\`

Example:
\`\`\`typescript
export default async (opensrc: OpensrcApi) => {
  const results = await opensrc.grep('parse', { sources: ['zod'], include: '**/*.ts' })
  return results.slice(0, 10)
}
\`\`\`
`

const OPENSRC_PROMPT = `Use opensrc for batched package and repository source work.
Write export default async (api: OpensrcApi) => ... and await asynchronous API calls.
Available methods: list, has, get, fetch, files, tree, grep, astGrep, read, readMany, resolve, remove, clean.
After fetch, use the returned source.name for later calls.
Call api.help() for exact types, options, supported specs, and examples.
`

function isOpensrcProgram(value: unknown): value is OpensrcProgram {
  return typeof value === 'function'
}

export { isOpensrcProgram, OPENSRC_API_HELP, OPENSRC_CODE_TYPES, OPENSRC_PROMPT }
