import type {
  ProgramFailure,
  ProgramFailureTag,
  ProgramHostErrorCodec,
  ProgramWireValue,
} from '@eratio/pi-codemode-core'
import { createProgramFailure } from '@eratio/pi-codemode-core'
import { defineMethod } from '@eratio/pi-effect-codemode'
import { Type } from 'typebox'
import { createOpensrcFailure, OpensrcFailure } from '../core/model.ts'
import type { OpensrcApiService } from './opensrc-api.ts'

const stringSchema = Type.String({ minLength: 1 })
const treeOptionsSchema = Type.Object({
  depth: Type.Optional(Type.Integer({ minimum: 0 })),
  pattern: Type.Optional(stringSchema),
})
const grepOptionsSchema = Type.Object({
  sources: Type.Optional(Type.Array(stringSchema)),
  include: Type.Optional(stringSchema),
  maxResults: Type.Optional(Type.Integer({ minimum: 0 })),
})
const astGrepOptionsSchema = Type.Object({
  glob: Type.Optional(stringSchema),
  lang: Type.Optional(Type.Union([stringSchema, Type.Array(stringSchema)])),
  limit: Type.Optional(Type.Integer({ minimum: 0 })),
})
const cleanOptionsSchema = Type.Object({
  packages: Type.Optional(Type.Boolean()),
  repos: Type.Optional(Type.Boolean()),
  npm: Type.Optional(Type.Boolean()),
  pypi: Type.Optional(Type.Boolean()),
  crates: Type.Optional(Type.Boolean()),
})
const hasParameters = Type.Object({ name: stringSchema, version: Type.Optional(stringSchema) })
const getParameters = Type.Object({ name: stringSchema })
const filesParameters = Type.Object({ sourceName: stringSchema, glob: Type.Optional(stringSchema) })
const treeParameters = Type.Object({ sourceName: stringSchema, options: Type.Optional(treeOptionsSchema) })
const grepParameters = Type.Object({
  pattern: stringSchema,
  options: Type.Optional(grepOptionsSchema),
})
const astGrepParameters = Type.Object({
  sourceName: stringSchema,
  pattern: stringSchema,
  options: Type.Optional(astGrepOptionsSchema),
})
const readParameters = Type.Object({ sourceName: stringSchema, filePath: stringSchema })
const readManyParameters = Type.Object({ sourceName: stringSchema, paths: Type.Array(stringSchema) })
const resolveParameters = Type.Object({ spec: stringSchema })
const fetchParameters = Type.Object({
  specs: Type.Union([stringSchema, Type.Array(stringSchema, { minItems: 1 })]),
})
const removeParameters = Type.Object({ names: Type.Array(stringSchema, { minItems: 1 }) })
const cleanParameters = Type.Object({ options: Type.Optional(cleanOptionsSchema) })

function serializeFailureCause(value: unknown, seen: WeakSet<object> = new WeakSet()): ProgramWireValue {
  if (
    value === undefined ||
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    typeof value === 'bigint'
  ) {
    return value
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value !== 'object') return String(value)
  if (seen.has(value)) return '[Circular]'
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((entry) => serializeFailureCause(entry, seen))
    if (!(value instanceof Error)) {
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) return String(value)
    }
    const serialized: Record<string, ProgramWireValue> = {}
    if (value instanceof Error) {
      serialized.name = value.name
      serialized.message = value.message
      if (value.stack !== undefined) serialized.stack = value.stack
      if (value.cause !== undefined) serialized.cause = serializeFailureCause(value.cause, seen)
    }
    for (const key of Object.keys(value)) {
      if (Object.hasOwn(serialized, key)) continue
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      serialized[key] =
        descriptor !== undefined && 'value' in descriptor ? serializeFailureCause(descriptor.value, seen) : '[Getter]'
    }
    return serialized
  } catch {
    try {
      return String(value)
    } catch {
      return '[Unserializable cause]'
    }
  } finally {
    seen.delete(value)
  }
}

const opensrcErrorCodec: ProgramHostErrorCodec<ProgramFailure | OpensrcFailure> = {
  encode: (error: OpensrcFailure | ProgramFailure) => {
    const failure = {
      _tag: error._tag,
      operation: error.operation,
      message: error.message,
      ...(error.cause === undefined ? {} : { cause: serializeFailureCause(error.cause) }),
    }
    return error instanceof OpensrcFailure ? { kind: 'opensrc', ...failure } : { kind: 'program', ...failure }
  },
  decode: (value: ProgramWireValue) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('The OpenSrc error codec received an invalid value.')
    }
    const record = value as Record<string, ProgramWireValue>
    if (typeof record._tag !== 'string' || typeof record.operation !== 'string' || typeof record.message !== 'string') {
      throw new TypeError('The OpenSrc error codec received an invalid failure.')
    }
    const cause = record.cause
    const fields = {
      operation: record.operation,
      message: record.message,
      ...(cause === undefined ? {} : { cause }),
    }
    if (record.kind === 'opensrc') {
      return createOpensrcFailure({ _tag: record._tag as OpensrcFailure['_tag'], ...fields })
    }
    if (record.kind === 'program') {
      return createProgramFailure({ _tag: record._tag as ProgramFailureTag, ...fields })
    }
    throw new TypeError('The OpenSrc error codec received an unknown failure type.')
  },
}

const opensrcMethods = {
  list: defineMethod<undefined, never, OpensrcFailure, OpensrcApiService>({
    description: 'List cached source packages and repositories.',
    signature: '(): Promise<readonly Source[]>',
    execute: (_params: undefined, _signal: AbortSignal, api: OpensrcApiService) => api.list(),
  }),
  has: defineMethod<typeof hasParameters, never, OpensrcFailure, OpensrcApiService>({
    description: 'Check whether a package or repository is cached, optionally at a specific version.',
    signature: '(params: { name: string; version?: string }): Promise<boolean>',
    parameters: hasParameters,
    execute: (params: { version?: string | undefined; name: string }, _signal: AbortSignal, api: OpensrcApiService) =>
      api.has(params.name, params.version),
  }),
  get: defineMethod<typeof getParameters, never, OpensrcFailure, OpensrcApiService>({
    description: 'Get cached source details by name.',
    signature: '(params: { name: string }): Promise<Source | undefined>',
    parameters: getParameters,
    execute: (params: { name: string }, _signal: AbortSignal, api: OpensrcApiService) => api.get(params.name),
  }),
  files: defineMethod<typeof filesParameters, never, OpensrcFailure, OpensrcApiService>({
    description: 'List files in a cached source. Use a glob to limit the paths.',
    signature: '(params: { sourceName: string; glob?: string }): Promise<readonly FileEntry[]>',
    parameters: filesParameters,
    execute: (
      params: { glob?: string | undefined; sourceName: string },
      _signal: AbortSignal,
      api: OpensrcApiService,
    ) => api.files(params.sourceName, params.glob),
  }),
  tree: defineMethod<typeof treeParameters, never, OpensrcFailure, OpensrcApiService>({
    description: 'Return a directory tree for a cached source.',
    signature: '(params: { sourceName: string; options?: TreeOptions }): Promise<TreeNode>',
    parameters: treeParameters,
    execute: (
      params: {
        options?: { depth?: number | undefined; pattern?: string | undefined } | undefined
        sourceName: string
      },
      _signal: AbortSignal,
      api: OpensrcApiService,
    ) => api.tree(params.sourceName, params.options),
  }),
  grep: defineMethod<typeof grepParameters, never, OpensrcFailure, OpensrcApiService>({
    description: 'Search file text across cached sources. Use sources and include to limit the search.',
    signature: '(params: { pattern: string; options?: GrepOptions }): Promise<readonly GrepResult[]>',
    parameters: grepParameters,
    execute: (
      params: {
        options?:
          | { sources?: string[] | undefined; include?: string | undefined; maxResults?: number | undefined }
          | undefined
        pattern: string
      },
      _signal: AbortSignal,
      api: OpensrcApiService,
    ) => api.grep(params.pattern, params.options),
  }),
  astGrep: defineMethod<typeof astGrepParameters, never, OpensrcFailure, OpensrcApiService>({
    description: 'Search source files with a language-aware code pattern.',
    signature:
      '(params: { sourceName: string; pattern: string; options?: AstGrepOptions }): Promise<readonly AstGrepMatch[]>',
    parameters: astGrepParameters,
    execute: (
      params: {
        options?:
          | { glob?: string | undefined; lang?: string | string[] | undefined; limit?: number | undefined }
          | undefined
        sourceName: string
        pattern: string
      },
      _signal: AbortSignal,
      api: OpensrcApiService,
    ) => api.astGrep(params.sourceName, params.pattern, params.options),
  }),
  read: defineMethod<typeof readParameters, never, OpensrcFailure, OpensrcApiService>({
    description: 'Read one file from a cached source.',
    signature: '(params: { sourceName: string; filePath: string }): Promise<string>',
    parameters: readParameters,
    execute: (params: { sourceName: string; filePath: string }, _signal: AbortSignal, api: OpensrcApiService) =>
      api.read(params.sourceName, params.filePath),
  }),
  readMany: defineMethod<typeof readManyParameters, never, OpensrcFailure, OpensrcApiService>({
    description: 'Read several files or globs from one cached source.',
    signature: '(params: { sourceName: string; paths: readonly string[] }): Promise<Readonly<Record<string, string>>>',
    parameters: readManyParameters,
    execute: (params: { sourceName: string; paths: string[] }, _signal: AbortSignal, api: OpensrcApiService) =>
      api.readMany(params.sourceName, params.paths),
  }),
  resolve: defineMethod<typeof resolveParameters, never, OpensrcFailure, OpensrcApiService>({
    description: 'Parse a package or repository spec without fetching it.',
    signature: '(params: { spec: string }): Promise<ParsedSpec>',
    parameters: resolveParameters,
    execute: (params: { spec: string }, _signal: AbortSignal, api: OpensrcApiService) => api.resolve(params.spec),
  }),
  fetch: defineMethod<typeof fetchParameters, never, OpensrcFailure, OpensrcApiService>({
    description: 'Fetch package or repository source into the shared cache.',
    signature: '(params: { specs: string | readonly string[] }): Promise<readonly FetchedSource[]>',
    parameters: fetchParameters,
    execute: (params: { specs: string | string[] }, _signal: AbortSignal, api: OpensrcApiService) =>
      api.fetch(params.specs),
  }),
  remove: defineMethod<typeof removeParameters, never, OpensrcFailure, OpensrcApiService>({
    description: 'Remove cached packages or repositories by source name.',
    signature: '(params: { names: readonly string[] }): Promise<RemoveResult>',
    parameters: removeParameters,
    execute: (params: { names: string[] }, _signal: AbortSignal, api: OpensrcApiService) => api.remove(params.names),
  }),
  clean: defineMethod<typeof cleanParameters, never, OpensrcFailure, OpensrcApiService>({
    description: 'Remove cached sources by type or provider.',
    signature: '(params: { options?: CleanOptions }): Promise<RemoveResult>',
    parameters: cleanParameters,
    execute: (
      params: {
        options?:
          | {
              packages?: boolean | undefined
              repos?: boolean | undefined
              npm?: boolean | undefined
              pypi?: boolean | undefined
              crates?: boolean | undefined
            }
          | undefined
      },
      _signal: AbortSignal,
      api: OpensrcApiService,
    ) => api.clean(params.options),
  }),
}

export { opensrcErrorCodec, opensrcMethods }
