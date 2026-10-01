import type { JsonValue } from '@earendil-works/pi-ai'
import {
  type EffectToolDefinition,
  PiExtension,
  type PiPlugin,
  type PiRegistrationContext,
  PiToolContext,
  type PiToolContextTag,
  type PiToolResult,
} from '@eratio/pi-effect'
import { Effect } from 'effect'
import { type Static, Type } from 'typebox'
import {
  type AstGrepMatch,
  createOpensrcApi,
  createOpensrcServiceLayer,
  type FetchedSource,
  type FileEntry,
  type GrepResult,
  type OpensrcApiService,
  type OpensrcConfig,
  OpensrcContext,
  type OpensrcFailure,
  type OpensrcServices,
  type ParsedSpec,
  type RemoveResult,
  resolveOpensrcConfig,
  type Source,
  type TreeNode,
} from './src/extension.ts'

const sourceTypeSchema = Type.Union([
  Type.Literal('npm'),
  Type.Literal('pypi'),
  Type.Literal('crates'),
  Type.Literal('repo'),
])
const sourceSchema = Type.Object({
  type: sourceTypeSchema,
  name: Type.String(),
  version: Type.String(),
  path: Type.String(),
  fetchedAt: Type.String(),
})
const parsedSpecSchema = Type.Object({
  type: sourceTypeSchema,
  name: Type.String(),
  version: Type.Optional(Type.String()),
  ref: Type.Optional(Type.String()),
  repository: Type.Optional(Type.String()),
})
const listParameters = Type.Object({})
const hasParameters = Type.Object({ name: Type.String(), version: Type.Optional(Type.String()) })
const getParameters = Type.Object({ name: Type.String() })
const resolveParameters = Type.Object({ spec: Type.String() })
const opensrcNamespace = { name: 'opensrc', description: 'Tools for cached package and repository sources.' }
const nonEmptyStringSchema = Type.String({ minLength: 1 })
const fileTypeSchema = Type.Union([Type.Literal('file'), Type.Literal('directory')])
const fileEntrySchema = Type.Object({
  path: Type.String(),
  type: fileTypeSchema,
  size: Type.Number(),
  modifiedAt: Type.Optional(Type.String()),
})
const treeNodeSchema = Type.Object({
  name: Type.String(),
  type: fileTypeSchema,
  children: Type.Optional(Type.Array(Type.This())),
})
const grepResultSchema = Type.Object({
  source: Type.String(),
  file: Type.String(),
  line: Type.Number(),
  column: Type.Number(),
  text: Type.String(),
})
const sourcePositionSchema = Type.Object({ line: Type.Number(), column: Type.Number(), offset: Type.Number() })
const astGrepMatchSchema = Type.Object({
  source: Type.String(),
  file: Type.String(),
  text: Type.String(),
  start: sourcePositionSchema,
  end: sourcePositionSchema,
  line: Type.Number(),
  column: Type.Number(),
  metavars: Type.Record(Type.String(), Type.String()),
})
const filesParameters = Type.Object({
  sourceName: nonEmptyStringSchema,
  glob: Type.Optional(nonEmptyStringSchema),
})
const treeOptionsSchema = Type.Object({
  depth: Type.Optional(Type.Integer({ minimum: 0 })),
  pattern: Type.Optional(nonEmptyStringSchema),
})
const treeParameters = Type.Object({
  sourceName: nonEmptyStringSchema,
  options: Type.Optional(treeOptionsSchema),
})
const grepOptionsSchema = Type.Object({
  sources: Type.Optional(Type.Array(nonEmptyStringSchema)),
  include: Type.Optional(nonEmptyStringSchema),
  maxResults: Type.Optional(Type.Integer({ minimum: 0 })),
})
const grepParameters = Type.Object({
  pattern: nonEmptyStringSchema,
  options: Type.Optional(grepOptionsSchema),
})
const astGrepOptionsSchema = Type.Object({
  glob: Type.Optional(nonEmptyStringSchema),
  lang: Type.Optional(Type.Union([nonEmptyStringSchema, Type.Array(nonEmptyStringSchema)])),
  limit: Type.Optional(Type.Integer({ minimum: 0 })),
})
const astGrepParameters = Type.Object({
  sourceName: nonEmptyStringSchema,
  pattern: nonEmptyStringSchema,
  options: Type.Optional(astGrepOptionsSchema),
})
const readParameters = Type.Object({ sourceName: nonEmptyStringSchema, filePath: nonEmptyStringSchema })
const readManyParameters = Type.Object({
  sourceName: nonEmptyStringSchema,
  paths: Type.Array(nonEmptyStringSchema),
})
const fetchParameters = Type.Object({
  specs: Type.Union([nonEmptyStringSchema, Type.Array(nonEmptyStringSchema, { minItems: 1 })]),
})
const removeParameters = Type.Object({ names: Type.Array(nonEmptyStringSchema, { minItems: 1 }) })
const cleanOptionsSchema = Type.Object({
  packages: Type.Optional(Type.Boolean()),
  repos: Type.Optional(Type.Boolean()),
  npm: Type.Optional(Type.Boolean()),
  pypi: Type.Optional(Type.Boolean()),
  crates: Type.Optional(Type.Boolean()),
})
const cleanParameters = Type.Object({ options: Type.Optional(cleanOptionsSchema) })
const fetchedSourceSchema = Type.Object({ source: sourceSchema, alreadyExists: Type.Boolean() })
const removeResultSchema = Type.Object({ success: Type.Literal(true), removed: Type.Array(Type.String()) })

const opensrcListTool: EffectToolDefinition<typeof listParameters, OpensrcServices, OpensrcFailure, readonly Source[]> =
  {
    name: 'opensrc_list',
    label: 'List OpenSrc sources',
    description: 'List package and repository sources in the OpenSrc cache.',
    promptSnippet: 'List cached sources before you choose a source name.',
    promptGuidelines: ['Use `source.name` with the other `tools.opensrc_*` tools.'],
    parameters: listParameters,
    outputSchema: Type.Array(sourceSchema),
    exposure: 'codemode',
    namespace: opensrcNamespace,
    annotations: { readOnlyHint: true },
    execute: () => runOpensrcApi((api) => api.list()),
  }

const opensrcHasTool: EffectToolDefinition<typeof hasParameters, OpensrcServices, OpensrcFailure, boolean> = {
  name: 'opensrc_has',
  label: 'Check an OpenSrc source',
  description: 'Check whether a package or repository source is in the OpenSrc cache.',
  promptSnippet: 'Check whether an OpenSrc source is cached.',
  promptGuidelines: ['Use the source name and optional version to check the cache.'],
  parameters: hasParameters,
  outputSchema: Type.Boolean(),
  exposure: 'codemode',
  namespace: opensrcNamespace,
  annotations: { readOnlyHint: true },
  execute: ({ name, version }: Static<typeof hasParameters>) => runOpensrcApi((api) => api.has(name, version)),
}

const opensrcGetTool: EffectToolDefinition<typeof getParameters, OpensrcServices, OpensrcFailure, Source | null> = {
  name: 'opensrc_get',
  label: 'Get OpenSrc source metadata',
  description: 'Return the metadata for a source in the OpenSrc cache.',
  promptSnippet: 'Get metadata for one cached source.',
  promptGuidelines: ['Use `source.name` when you pass a cached source to another tool.'],
  parameters: getParameters,
  outputSchema: Type.Union([sourceSchema, Type.Null()]),
  exposure: 'codemode',
  namespace: opensrcNamespace,
  annotations: { readOnlyHint: true },
  execute: ({ name }: Static<typeof getParameters>) =>
    runOpensrcApi((api) => api.get(name).pipe(Effect.map((source) => source ?? null))),
}

const opensrcResolveTool: EffectToolDefinition<typeof resolveParameters, OpensrcServices, OpensrcFailure, ParsedSpec> =
  {
    name: 'opensrc_resolve',
    label: 'Resolve an OpenSrc spec',
    description: 'Parse a package or repository source spec without fetching it.',
    promptSnippet: 'Parse an OpenSrc source spec without fetching it.',
    promptGuidelines: ['Use this tool to inspect a source spec before you fetch it.'],
    parameters: resolveParameters,
    outputSchema: parsedSpecSchema,
    exposure: 'codemode',
    namespace: opensrcNamespace,
    annotations: { readOnlyHint: true },
    execute: ({ spec }: Static<typeof resolveParameters>) => runOpensrcApi((api) => api.resolve(spec)),
  }

const opensrcFilesTool: EffectToolDefinition<
  typeof filesParameters,
  OpensrcServices,
  OpensrcFailure,
  readonly FileEntry[]
> = {
  name: 'opensrc_files',
  label: 'List OpenSrc files',
  description: 'List files in a cached package or repository source.',
  promptSnippet: 'List paths in a cached source.',
  promptGuidelines: ['Use a glob to limit the returned paths.'],
  parameters: filesParameters,
  outputSchema: Type.Array(fileEntrySchema),
  exposure: 'codemode',
  namespace: opensrcNamespace,
  annotations: { readOnlyHint: true },
  execute: ({ sourceName, glob }: Static<typeof filesParameters>) =>
    runOpensrcApi((api) => api.files(sourceName, glob)),
}

const opensrcTreeTool: EffectToolDefinition<typeof treeParameters, OpensrcServices, OpensrcFailure, TreeNode> = {
  name: 'opensrc_tree',
  label: 'Build an OpenSrc source tree',
  description: 'Build a directory tree for a cached package or repository source.',
  promptSnippet: 'Show the directory tree for a cached source.',
  promptGuidelines: ['Use depth or pattern to limit a large tree.'],
  parameters: treeParameters,
  outputSchema: treeNodeSchema,
  exposure: 'codemode',
  namespace: opensrcNamespace,
  annotations: { readOnlyHint: true },
  execute: ({ sourceName, options }: Static<typeof treeParameters>) =>
    runOpensrcApi((api) => api.tree(sourceName, options)),
}

const opensrcGrepTool: EffectToolDefinition<
  typeof grepParameters,
  OpensrcServices,
  OpensrcFailure,
  readonly GrepResult[]
> = {
  name: 'opensrc_grep',
  label: 'Search OpenSrc source text',
  description: 'Search files in cached sources for matching text.',
  promptSnippet: 'Search cached source files for text.',
  promptGuidelines: ['Pass source names and a glob to narrow a search.'],
  parameters: grepParameters,
  outputSchema: Type.Array(grepResultSchema),
  exposure: 'codemode',
  namespace: opensrcNamespace,
  annotations: { readOnlyHint: true },
  execute: ({ pattern, options }: Static<typeof grepParameters>) => runOpensrcApi((api) => api.grep(pattern, options)),
}

const opensrcAstGrepTool: EffectToolDefinition<
  typeof astGrepParameters,
  OpensrcServices,
  OpensrcFailure,
  readonly AstGrepMatch[]
> = {
  name: 'opensrc_ast_grep',
  label: 'Search OpenSrc code structure',
  description: 'Find code structure in files from a cached source.',
  promptSnippet: 'Match code structure in a cached source.',
  promptGuidelines: ['Use a supported language and a syntax pattern.'],
  parameters: astGrepParameters,
  outputSchema: Type.Array(astGrepMatchSchema),
  exposure: 'codemode',
  namespace: opensrcNamespace,
  annotations: { readOnlyHint: true },
  execute: ({ sourceName, pattern, options }: Static<typeof astGrepParameters>) =>
    runOpensrcApi((api) => api.astGrep(sourceName, pattern, options)),
}

const opensrcReadTool: EffectToolDefinition<typeof readParameters, OpensrcServices, OpensrcFailure, string> = {
  name: 'opensrc_read',
  label: 'Read an OpenSrc file',
  description: 'Read one file from a cached package or repository source.',
  promptSnippet: 'Read one file from a cached source.',
  promptGuidelines: ['Pass the source name and a relative file path.'],
  parameters: readParameters,
  outputSchema: Type.String(),
  exposure: 'codemode',
  namespace: opensrcNamespace,
  annotations: { readOnlyHint: true },
  execute: ({ sourceName, filePath }: Static<typeof readParameters>) =>
    runOpensrcApi((api) => api.read(sourceName, filePath)),
}

const opensrcReadManyTool: EffectToolDefinition<
  typeof readManyParameters,
  OpensrcServices,
  OpensrcFailure,
  Readonly<Record<string, string>>
> = {
  name: 'opensrc_read_many',
  label: 'Read OpenSrc files',
  description: 'Read several files from a cached package or repository source.',
  promptSnippet: 'Read related files from a cached source in one call.',
  promptGuidelines: ['Use a glob in a path when you need to read matching files.'],
  parameters: readManyParameters,
  outputSchema: Type.Record(Type.String(), Type.String()),
  exposure: 'codemode',
  namespace: opensrcNamespace,
  annotations: { readOnlyHint: true },
  execute: ({ sourceName, paths }: Static<typeof readManyParameters>) =>
    runOpensrcApi((api) => api.readMany(sourceName, paths)),
}

const opensrcFetchTool: EffectToolDefinition<
  typeof fetchParameters,
  OpensrcServices,
  OpensrcFailure,
  readonly FetchedSource[]
> = {
  name: 'opensrc_fetch',
  label: 'Fetch OpenSrc sources',
  description: 'Fetch one or more package or repository sources into the cache.',
  promptSnippet: 'Fetch one source spec or a list of source specs.',
  promptGuidelines: ['Use a source spec accepted by `opensrc_resolve`.'],
  parameters: fetchParameters,
  outputSchema: Type.Array(fetchedSourceSchema),
  exposure: 'codemode',
  namespace: opensrcNamespace,
  annotations: { readOnlyHint: false, openWorldHint: true },
  execute: ({ specs }: Static<typeof fetchParameters>) => runOpensrcApi((api) => api.fetch(specs)),
}

const opensrcRemoveTool: EffectToolDefinition<typeof removeParameters, OpensrcServices, OpensrcFailure, RemoveResult> =
  {
    name: 'opensrc_remove',
    label: 'Remove OpenSrc sources',
    description: 'Remove one or more named sources from the cache.',
    promptSnippet: 'Remove sources from the OpenSrc cache by name.',
    promptGuidelines: ['Use source names returned by `opensrc_list`.'],
    parameters: removeParameters,
    outputSchema: removeResultSchema,
    exposure: 'codemode',
    namespace: opensrcNamespace,
    annotations: { readOnlyHint: false, destructiveHint: true },
    execute: ({ names }: Static<typeof removeParameters>) => runOpensrcApi((api) => api.remove(names)),
  }

const opensrcCleanTool: EffectToolDefinition<typeof cleanParameters, OpensrcServices, OpensrcFailure, RemoveResult> = {
  name: 'opensrc_clean',
  label: 'Clean the OpenSrc cache',
  description: 'Clean the cache groups selected by the package, repository, and registry options.',
  promptSnippet: 'Clean selected groups from the OpenSrc cache.',
  promptGuidelines: ['Pass only the cache groups that the user requested.'],
  parameters: cleanParameters,
  outputSchema: removeResultSchema,
  exposure: 'codemode',
  namespace: opensrcNamespace,
  annotations: { readOnlyHint: false, destructiveHint: true },
  execute: ({ options }: Static<typeof cleanParameters>) => runOpensrcApi((api) => api.clean(options)),
}

function createOpensrcNativePlugin(config: OpensrcConfig): PiPlugin<OpensrcServices> {
  return PiExtension.define({
    id: 'opensrc',
    layer: createOpensrcServiceLayer(config),
    effect: ({ tools }: PiRegistrationContext<OpensrcServices>) =>
      Effect.gen(function* () {
        yield* tools.register(opensrcListTool)
        yield* tools.register(opensrcHasTool)
        yield* tools.register(opensrcGetTool)
        yield* tools.register(opensrcResolveTool)
        yield* tools.register(opensrcFilesTool)
        yield* tools.register(opensrcTreeTool)
        yield* tools.register(opensrcGrepTool)
        yield* tools.register(opensrcAstGrepTool)
        yield* tools.register(opensrcReadTool)
        yield* tools.register(opensrcReadManyTool)
        yield* tools.register(opensrcFetchTool)
        yield* tools.register(opensrcRemoveTool)
        yield* tools.register(opensrcCleanTool)
      }),
  })
}

const runOpensrcApi = Effect.fnUntraced(function* <Value extends JsonValue>(
  operation: (api: OpensrcApiService) => Effect.Effect<Value, OpensrcFailure>,
): Effect.fn.Return<PiToolResult<Value>, OpensrcFailure, OpensrcServices | PiToolContextTag> {
  const context = yield* PiToolContext
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const api = yield* createOpensrcApi(context.toolSignal ?? context.signal).pipe(
        Effect.provideService(OpensrcContext, { cwd: context.cwd }),
      )
      return createOpensrcToolResult(yield* operation(api))
    }),
  )
})

function createOpensrcToolResult<Value extends JsonValue>(value: Value): PiToolResult<Value> {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) ?? 'null' }],
    details: value,
    structuredContent: value,
  }
}

const opensrcExtension = PiExtension.install(createOpensrcNativePlugin(resolveOpensrcConfig()))

export { createOpensrcNativePlugin, opensrcExtension as default }
