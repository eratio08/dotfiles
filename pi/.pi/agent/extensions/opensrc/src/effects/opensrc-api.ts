import { extname } from 'node:path'
import { Worker } from 'node:worker_threads'
import { Context, Effect, Layer, Schema, type Scope } from 'effect'
import { planClean } from '../core/command-plan.ts'
import type {
  AstGrepMatch,
  AstGrepOptions,
  CleanOptions,
  FetchedSource,
  FileEntry,
  GrepOptions,
  GrepResult,
  OpensrcFailure,
  ParsedSpec,
  RawAstMatch,
  RemoveResult,
  Source,
  SourceFile,
  TreeNode,
  TreeOptions,
} from '../core/model.ts'
import { createOpensrcFailure } from '../core/model.ts'
import { diffSources } from '../core/source-index.ts'
import { sourceMatchesSpec } from '../core/source-spec.ts'
import type { AstParserWorkerMessage, AstParserWorkerRequest } from './ast-parser-worker.ts'
import { OpensrcContext } from './context.ts'
import { decodeOpensrcFailure, failureFromUnknown } from './failure.ts'
import { FileSystem } from './file-system.ts'
import { OpenSrcCli, OpensrcConfiguration } from './opensrc-cli.ts'
import { buildTreeInterruptible, grepFilesInterruptible, normalizeAstMatchesInterruptible } from './source-query.ts'
import { parseSourceSpec, parseSourceSpecEffect } from './source-spec.ts'
import { SourceStore } from './source-store.ts'

interface AstParserService {
  readonly find: (
    source: string,
    file: string,
    content: string,
    pattern: string,
    lang: string,
    limit: number,
  ) => Effect.Effect<readonly RawAstMatch[], OpensrcFailure>
}

class AstParser extends Context.Service<AstParser, AstParserService>()('opensrc/AstParser') {}

type ApiEffect<A> = Effect.Effect<A, OpensrcFailure>

interface OpensrcApiService {
  readonly list: () => ApiEffect<readonly Source[]>
  readonly has: (name: string, version?: string) => ApiEffect<boolean>
  readonly get: (name: string) => ApiEffect<Source | undefined>
  readonly files: (sourceName: string, glob?: string) => ApiEffect<readonly FileEntry[]>
  readonly tree: (sourceName: string, options?: TreeOptions) => ApiEffect<TreeNode>
  readonly grep: (pattern: string, options?: GrepOptions) => ApiEffect<readonly GrepResult[]>
  readonly astGrep: (
    sourceName: string,
    pattern: string,
    options?: AstGrepOptions,
  ) => ApiEffect<readonly AstGrepMatch[]>
  readonly read: (sourceName: string, filePath: string) => ApiEffect<string>
  readonly readMany: (sourceName: string, paths: readonly string[]) => ApiEffect<Readonly<Record<string, string>>>
  readonly resolve: (spec: string) => ApiEffect<ParsedSpec>
  readonly fetch: (specs: string | readonly string[]) => ApiEffect<readonly FetchedSource[]>
  readonly remove: (names: readonly string[]) => ApiEffect<RemoveResult>
  readonly clean: (options?: CleanOptions) => ApiEffect<RemoveResult>
}

const NonNegativeIntegerSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const TreeDepthSchema = NonNegativeIntegerSchema.pipe(
  Schema.annotate({ message: 'Tree depth must be a non-negative integer.' }),
)
const GrepMaxResultsSchema = NonNegativeIntegerSchema.pipe(
  Schema.annotate({ message: 'grep maxResults must be a non-negative integer.' }),
)
const AstLimitSchema = NonNegativeIntegerSchema.pipe(
  Schema.annotate({ message: 'AST limit must be a non-negative integer.' }),
)
const TreeOptionsSchema = Schema.Struct({
  depth: Schema.optional(TreeDepthSchema),
  pattern: Schema.optional(Schema.NonEmptyString),
}).pipe(Schema.annotate({ message: 'Tree options must be an object.' }))
const GrepOptionsSchema = Schema.Struct({
  sources: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  include: Schema.optional(Schema.NonEmptyString),
  maxResults: Schema.optional(GrepMaxResultsSchema),
}).pipe(Schema.annotate({ message: 'Grep options must be an object.' }))
const AstGrepOptionsSchema = Schema.Struct({
  glob: Schema.optional(Schema.NonEmptyString),
  lang: Schema.optional(Schema.Union([Schema.NonEmptyString, Schema.Array(Schema.NonEmptyString)])),
  limit: Schema.optional(AstLimitSchema),
}).pipe(Schema.annotate({ message: 'AST options must be an object.' }))
const CleanOptionsSchema = Schema.Struct({
  packages: Schema.optional(Schema.Boolean),
  repos: Schema.optional(Schema.Boolean),
  npm: Schema.optional(Schema.Boolean),
  pypi: Schema.optional(Schema.Boolean),
  crates: Schema.optional(Schema.Boolean),
}).pipe(Schema.annotate({ message: 'Clean options must be an object.' }))

function createOpensrcApi(
  signal?: AbortSignal,
): Effect.Effect<
  OpensrcApiService,
  OpensrcFailure,
  OpensrcContext | OpensrcConfiguration | FileSystem | OpenSrcCli | SourceStore | AstParser | Scope.Scope
> {
  return Effect.gen(function* () {
    const context = yield* OpensrcContext
    const callSignal = signal ?? (yield* Effect.abortSignal)
    const config = yield* OpensrcConfiguration
    const fileSystem = yield* FileSystem
    const cli = yield* OpenSrcCli
    const sourceStore = yield* SourceStore
    const astParser = yield* AstParser
    yield* sourceStore.load()

    const sourceRoot = (source: Source): ApiEffect<string> =>
      Effect.gen(function* () {
        const cacheRoot = yield* fileSystem.realPath(config.home, undefined, callSignal)
        return yield* fileSystem.realPath(cacheRoot, source.path, callSignal)
      }).pipe(Effect.mapError((cause) => decodeOpensrcFailure(cause) ?? filesystemFailure('source-root', cause)))
    const getSource = (name: string): ApiEffect<Source> =>
      Effect.gen(function* () {
        const validName = yield* assertStringEffect('source name', name)
        const source = sourceStore.current().find((candidate) => candidate.name === validName)
        return source === undefined ? yield* Effect.fail(sourceNotFound(validName)) : source
      })
    const readFiles = (
      source: Source,
      patternValue: string | undefined,
      root?: string,
    ): ApiEffect<readonly FileEntry[]> =>
      Effect.gen(function* () {
        const pattern = patternValue === undefined ? undefined : yield* assertStringEffect('file glob', patternValue)
        const sourcePath = root ?? (yield* sourceRoot(source))
        return yield* fileSystem.list(sourcePath, pattern, callSignal)
      })
    const readOne = (source: Source, filePath: string): ApiEffect<string> =>
      Effect.gen(function* () {
        const validPath = yield* assertStringEffect('file path', filePath)
        const root = yield* sourceRoot(source)
        return yield* fileSystem.read(root, validPath, callSignal)
      })
    const api: OpensrcApiService = {
      list: () => Effect.succeed(sourceStore.current()),
      has: (name: string, version?: string) =>
        Effect.gen(function* () {
          const validName = yield* assertStringEffect('source name', name)
          const validVersion = version === undefined ? undefined : yield* assertStringEffect('source version', version)
          return sourceStore
            .current()
            .some(
              (source) => source.name === validName && (validVersion === undefined || source.version === validVersion),
            )
        }),
      get: (name: string) =>
        Effect.gen(function* () {
          const validName = yield* assertStringEffect('source name', name)
          return sourceStore.current().find((source) => source.name === validName)
        }),
      files: (sourceName: string, globValue?: string) =>
        Effect.gen(function* () {
          const source = yield* getSource(sourceName)
          return yield* readFiles(source, globValue)
        }),
      tree: (sourceName: string, options = {}) =>
        Effect.gen(function* () {
          const treeOptions = yield* decodeTreeOptionsEffect(options)
          const source = yield* getSource(sourceName)
          const entries = yield* readFiles(source, undefined)
          return yield* buildTreeInterruptible(source.name, entries, treeOptions, callSignal)
        }),
      grep: (patternValue: string, options = {}) =>
        Effect.gen(function* () {
          const patternText = yield* assertStringEffect('grep pattern', patternValue)
          const grepOptions = yield* decodeGrepOptionsEffect(options)
          const selected =
            grepOptions.sources === undefined
              ? sourceStore.current()
              : yield* Effect.forEach(grepOptions.sources, (name) => getSource(name))
          const sourceFiles: Array<{ readonly source: string; readonly files: readonly SourceFile[] }> = []
          for (const source of selected) {
            const root = yield* sourceRoot(source)
            const entries = yield* readFiles(source, grepOptions.include, root)
            const files: SourceFile[] = []
            for (const entry of entries) {
              if (entry.type !== 'file') continue
              const content = yield* fileSystem.read(root, entry.path, callSignal)
              files.push({ path: entry.path, content })
            }
            sourceFiles.push({ source: source.name, files })
          }
          return yield* grepFilesInterruptible(sourceFiles, patternText, grepOptions, callSignal)
        }),
      astGrep: (sourceName: string, patternValue: string, options: AstGrepOptions = {}) =>
        Effect.gen(function* () {
          const patternText = yield* assertStringEffect('AST pattern', patternValue)
          const astGrepOptions = yield* decodeAstGrepOptionsEffect(options)
          const source = yield* getSource(sourceName)
          const root = yield* sourceRoot(source)
          const entries = yield* readFiles(source, astGrepOptions.glob, root)
          const languages = yield* normalizeLanguagesEffect(astGrepOptions.lang)
          const limit = astGrepOptions.limit ?? 100
          const matches: RawAstMatch[] = []
          for (const entry of entries) {
            if (entry.type !== 'file') continue
            const fileLanguages = languages.length > 0 ? languages : inferredLanguage(entry.path)
            for (const lang of fileLanguages) {
              const content = yield* fileSystem.read(root, entry.path, callSignal)
              const remaining = limit - matches.length
              if (remaining <= 0) {
                return yield* normalizeAstMatchesInterruptible(source.name, matches, callSignal)
              }
              const result = yield* astParser.find(source.name, entry.path, content, patternText, lang, remaining)
              matches.push(...result.slice(0, remaining))
              if (matches.length >= limit) {
                return yield* normalizeAstMatchesInterruptible(source.name, matches.slice(0, limit), callSignal)
              }
            }
          }
          return yield* normalizeAstMatchesInterruptible(source.name, matches, callSignal)
        }),
      read: (sourceName: string, filePath: string) =>
        Effect.gen(function* () {
          const source = yield* getSource(sourceName)
          return yield* readOne(source, filePath)
        }),
      readMany: (sourceName: string, paths: readonly string[]) =>
        Effect.gen(function* () {
          const validPaths = yield* assertStringArrayEffect('read paths', paths)
          const source = yield* getSource(sourceName)
          const result: Record<string, string> = {}
          for (const requestedPath of validPaths) {
            if (hasGlobMagic(requestedPath)) {
              const entries = yield* readFilesOrError(source, requestedPath, result)
              if (entries === undefined) continue
              const files = entries.filter((entry) => entry.type === 'file')
              if (files.length === 0) {
                result[requestedPath] = `[Error: no files matched ${requestedPath}]`
                continue
              }
              for (const entry of files) {
                const value = yield* readOneOrError(source, entry.path)
                if (value !== undefined) result[entry.path] = value
              }
              continue
            }
            const value = yield* readOneOrError(source, requestedPath)
            if (value !== undefined) result[requestedPath] = value
          }
          return result
        }),
      resolve: (spec: string) =>
        Effect.gen(function* () {
          const validSpec = yield* assertStringEffect('source spec', spec)
          return yield* Effect.try({
            try: () => parseSourceSpec(validSpec),
            catch: (cause: unknown) => {
              const failure = decodeOpensrcFailure(cause)
              return validationFailure(
                'resolve',
                failure?.message ?? (cause instanceof Error ? cause.message : 'The source spec could not be parsed.'),
                failure ?? cause,
              )
            },
          })
        }),
      fetch: (specValues: string | readonly string[]) =>
        Effect.gen(function* () {
          const specs = yield* normalizeSpecsEffect(specValues)
          const parsed: ParsedSpec[] = []
          for (const spec of specs) {
            parsed.push(
              yield* parseSourceSpecEffect(spec).pipe(
                Effect.mapError((cause) => validationFailure('fetch', cause.message, cause)),
              ),
            )
          }
          const mutation = yield* sourceStore.mutate((before) =>
            Effect.gen(function* () {
              const existing = parsed.map((spec) => before.some((source) => sourceMatchesSpec(source, spec)))
              yield* cli.fetch(specs, context.cwd)
              return existing
            }),
          )
          const fetched: FetchedSource[] = []
          for (const [index, spec] of parsed.entries()) {
            const source = mutation.after.find((candidate) => sourceMatchesSpec(candidate, spec))
            if (source === undefined) return yield* Effect.fail(sourceNotFound(spec.name))
            fetched.push({ source, alreadyExists: mutation.value[index] })
          }
          return fetched
        }),
      remove: (names: readonly string[]) =>
        Effect.gen(function* () {
          const validNames = yield* assertStringArrayEffect('source names', names)
          if (validNames.length === 0)
            return yield* Effect.fail(validationFailure('remove', 'At least one source name is required.'))
          if (validNames.some((name) => name.startsWith('-') || name.includes('\u0000'))) {
            return yield* Effect.fail(
              validationFailure('remove', 'Source names cannot start with a flag or contain a null byte.'),
            )
          }
          const mutation = yield* sourceStore.mutate((before) =>
            Effect.gen(function* () {
              yield* cli.remove(validNames)
              return before
            }),
          )
          const removed = diffSources(mutation.value, mutation.after).removed.map((source) => source.name)
          return { success: true, removed: [...new Set(removed)] } satisfies RemoveResult
        }),
      clean: (options = {}) =>
        Effect.gen(function* () {
          const cleanOptions = yield* decodeCleanOptionsEffect(options)
          const mutation = yield* sourceStore.mutate((before) =>
            Effect.gen(function* () {
              yield* cli.clean(planClean(cleanOptions))
              return before
            }),
          )
          const removed = diffSources(mutation.value, mutation.after).removed.map((source) => source.name)
          return { success: true, removed: [...new Set(removed)] } satisfies RemoveResult
        }),
    }

    function readFilesOrError(
      source: Source,
      pattern: string,
      result: Record<string, string>,
    ): ApiEffect<readonly FileEntry[] | undefined> {
      return Effect.match(readFiles(source, pattern), {
        onFailure: (cause: OpensrcFailure) => {
          const stopped = operationStopped(cause)
          if (stopped !== undefined) return { _tag: 'failure' as const, error: stopped }
          result[pattern] = formatIndividualError(cause)
          return { _tag: 'formatted' as const }
        },
        onSuccess: (entries: readonly FileEntry[]) => ({ _tag: 'success' as const, entries }),
      }).pipe(
        Effect.flatMap((outcome) => {
          if (outcome._tag === 'failure') return Effect.fail(outcome.error)
          if (outcome._tag === 'formatted') return Effect.succeed(undefined)
          return Effect.succeed(outcome.entries)
        }),
      )
    }

    function readOneOrError(source: Source, path: string): ApiEffect<string | undefined> {
      return Effect.match(readOne(source, path), {
        onFailure: (cause: OpensrcFailure) => {
          const stopped = operationStopped(cause)
          if (stopped !== undefined) return { _tag: 'failure' as const, error: stopped }
          return { _tag: 'formatted' as const, value: formatIndividualError(cause) }
        },
        onSuccess: (value: string) => ({ _tag: 'success' as const, value }),
      }).pipe(
        Effect.flatMap((outcome) => {
          if (outcome._tag === 'failure') return Effect.fail(outcome.error)
          return Effect.succeed(outcome.value)
        }),
      )
    }

    return api
  })
}

function AstParserLive(): Layer.Layer<AstParser, never, never> {
  return Layer.succeed(AstParser, AstParser.of(createAstParser()))
}

function createAstParser(): AstParserService {
  return {
    find: (source: string, file: string, content: string, patternText: string, language: string, limit: number) =>
      Effect.tryPromise({
        try: (signal: AbortSignal) =>
          evaluateAstParserInWorker(
            { type: 'parse', source, file, content, pattern: patternText, language, limit },
            signal,
          ),
        catch: (cause: unknown) => {
          return failureFromUnknown(cause, 'parser', 'astGrep', 'The source file could not be parsed.')
        },
      }),
  }
}

type AstParserOutcome =
  | { readonly ok: true; readonly matches: readonly RawAstMatch[] }
  | { readonly ok: false; readonly error: OpensrcFailure }

function evaluateAstParserInWorker(
  request: AstParserWorkerRequest,
  signal: AbortSignal,
): Promise<readonly RawAstMatch[]> {
  if (signal.aborted) return Promise.reject(cancellationFailure('astGrep'))
  const worker = new Worker(new URL('./ast-parser-worker.ts', import.meta.url))
  return new Promise((resolve, reject) => {
    let settled = false
    const abortHandler = (): void => finishFailure(cancellationFailure('astGrep'))

    const cleanup = (): void => {
      signal.removeEventListener('abort', abortHandler)
    }

    const complete = (outcome: AstParserOutcome): void => {
      if (outcome.ok) resolve(outcome.matches)
      else reject(outcome.error)
    }

    const finish = (outcome: AstParserOutcome): void => {
      if (settled) return
      settled = true
      cleanup()
      void worker.terminate().then(
        () => complete(outcome),
        () => complete(outcome),
      )
    }

    const finishSuccess = (matches: readonly RawAstMatch[]): void => finish({ ok: true, matches })
    const finishFailure = (error: OpensrcFailure): void => finish({ ok: false, error })

    worker.on('message', (message: AstParserWorkerMessage) => {
      if (message.type === 'result') finishSuccess(message.matches)
      else
        finishFailure(
          createOpensrcFailure({
            _tag: 'parser',
            operation: 'astGrep',
            message: message.message,
            cause: { name: message.name, stack: message.stack },
          }),
        )
    })
    worker.on('error', (cause) =>
      finishFailure(failureFromUnknown(cause, 'parser', 'astGrep', 'The source file could not be parsed.')),
    )
    worker.on('exit', (code) => {
      if (!settled)
        finishFailure(
          createOpensrcFailure({
            _tag: 'parser',
            operation: 'astGrep',
            message: `The AST parser worker exited with code ${code}.`,
          }),
        )
    })
    signal.addEventListener('abort', abortHandler, { once: true })

    Promise.resolve()
      .then(() => worker.postMessage(request))
      .catch((cause) =>
        finishFailure(failureFromUnknown(cause, 'parser', 'postMessage', 'The AST parser worker failed.')),
      )
  })
}

function normalizeSpecsEffect(value: string | readonly string[]): ApiEffect<readonly string[]> {
  return Effect.gen(function* () {
    const specs = typeof value === 'string' ? [value] : value
    const validSpecs = yield* assertStringArrayEffect('source specs', specs)
    if (validSpecs.length === 0)
      return yield* Effect.fail(validationFailure('fetch', 'At least one source spec is required.'))
    return validSpecs
  })
}

function normalizeLanguagesEffect(value: string | readonly string[] | undefined): ApiEffect<readonly string[]> {
  if (value === undefined) return Effect.succeed([])
  const languages = typeof value === 'string' ? [value] : value
  return assertStringArrayEffect('AST languages', languages).pipe(
    Effect.map((items) => items.map((language) => language.toLowerCase())),
  )
}

function inferredLanguage(filePath: string): readonly string[] {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return ['typescript']
  if (extension === '.tsx') return ['tsx']
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs' || extension === '.jsx') return ['javascript']
  if (extension === '.html' || extension === '.htm') return ['html']
  if (extension === '.css') return ['css']
  return []
}

function decodeInputEffect<S extends Schema.ConstraintDecoder<unknown>>(
  operation: string,
  schema: S,
  value: unknown,
  message: string,
): ApiEffect<S['Type']> {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(value),
    catch: (cause: unknown) => validationFailure(operation, message, cause),
  })
}

type TreeOptionsValue = Schema.Schema.Type<typeof TreeOptionsSchema>
type GrepOptionsValue = Schema.Schema.Type<typeof GrepOptionsSchema>
type AstGrepOptionsValue = Schema.Schema.Type<typeof AstGrepOptionsSchema>
type CleanOptionsValue = Schema.Schema.Type<typeof CleanOptionsSchema>

function decodeTreeOptionsEffect(value: unknown): ApiEffect<TreeOptionsValue> {
  return decodeInputEffect('tree', TreeOptionsSchema, value, 'Tree options must be an object.')
}

function decodeGrepOptionsEffect(value: unknown): ApiEffect<GrepOptionsValue> {
  return decodeInputEffect('grep', GrepOptionsSchema, value, 'Grep options must be an object.')
}

function decodeAstGrepOptionsEffect(value: unknown): ApiEffect<AstGrepOptionsValue> {
  return decodeInputEffect('astGrep', AstGrepOptionsSchema, value, 'AST options must be an object.')
}

function decodeCleanOptionsEffect(value: unknown): ApiEffect<CleanOptionsValue> {
  return decodeInputEffect('clean', CleanOptionsSchema, value, 'Clean options must be an object.')
}

function assertStringEffect(name: string, value: unknown): ApiEffect<string> {
  return decodeInputEffect('validation', Schema.NonEmptyString, value, `${name} must be a non-empty string.`)
}

function assertStringArrayEffect(name: string, value: unknown): ApiEffect<readonly string[]> {
  return decodeInputEffect(
    'validation',
    Schema.Array(Schema.NonEmptyString),
    value,
    `${name} must be an array of non-empty strings.`,
  )
}

function hasGlobMagic(value: string): boolean {
  return /[*?{[]/.test(value)
}

function operationStopped(cause: unknown): OpensrcFailure | undefined {
  const failure = decodeOpensrcFailure(cause)
  return failure !== undefined && (failure._tag === 'cancellation' || failure._tag === 'timeout') ? failure : undefined
}

function formatIndividualError(cause: unknown): string {
  const failure = decodeOpensrcFailure(cause)
  if (failure !== undefined) return `[Error: ${failure.message}]`
  return `[Error: ${cause instanceof Error ? cause.message : 'Unable to read the path'}]`
}

function sourceNotFound(name: string): OpensrcFailure {
  return createOpensrcFailure({
    _tag: 'source-not-found',
    operation: 'source',
    message: `Cached source not found: ${name}`,
  })
}

function cancellationFailure(operation = 'api'): OpensrcFailure {
  return createOpensrcFailure({
    _tag: 'cancellation',
    operation,
    message: 'The opensrc operation was cancelled.',
  })
}

function validationFailure(operation: string, message: string, cause?: unknown): OpensrcFailure {
  return createOpensrcFailure({ _tag: 'validation', operation, message, cause })
}

function filesystemFailure(operation: string, cause: unknown): OpensrcFailure {
  return createOpensrcFailure({
    _tag: 'filesystem',
    operation,
    message: cause instanceof Error ? cause.message : 'The source path is not accessible.',
    cause,
  })
}

export { AstParser, AstParserLive, type AstParserService, createAstParser, createOpensrcApi, type OpensrcApiService }
