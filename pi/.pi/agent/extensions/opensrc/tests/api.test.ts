import { describe, expect, test } from 'bun:test'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Effect, Exit, Layer } from 'effect'
import type { FileEntry, OpensrcFailure, RawAstMatch, Source } from '../src/core/model.ts'
import { createOpensrcFailure } from '../src/core/model.ts'
import { OpensrcContext } from '../src/effects/context.ts'
import type { FileSystemService } from '../src/effects/file-system.ts'
import { FileSystem } from '../src/effects/file-system.ts'
import type { AstParserService } from '../src/effects/opensrc-api.ts'
import { AstParser, createOpensrcApi } from '../src/effects/opensrc-api.ts'
import type { OpenSrcCliService, OpensrcConfig } from '../src/effects/opensrc-cli.ts'
import { OpenSrcCli, OpensrcConfiguration } from '../src/effects/opensrc-cli.ts'
import type { SourceStoreService } from '../src/effects/source-store.ts'
import { SourceStore, SourceStoreLive } from '../src/effects/source-store.ts'

const captureEffectResult = <A, E>(
  effect: Effect.Effect<A, E>,
): Effect.Effect<{ _tag: 'Left'; left: E } | { _tag: 'Right'; right: A }, never, never> =>
  Effect.match(effect, {
    onFailure: (left: E) => ({ _tag: 'Left' as const, left }),
    onSuccess: (right: A) => ({ _tag: 'Right' as const, right }),
  })

const source: Source = {
  type: 'npm',
  name: 'zod',
  version: '3.0.0',
  path: 'sources/zod',
  fetchedAt: '2026-01-01',
}

const entries: readonly FileEntry[] = [
  { path: 'README.md', type: 'file', size: 5 },
  { path: 'src', type: 'directory', size: 0 },
  { path: 'src/index.ts', type: 'file', size: 18 },
]

const contents: Readonly<Record<string, string>> = {
  'README.md': 'parse documentation',
  'src/index.ts': 'export const parse = () => 1',
}

const failure = (operation: string, message: string, cause?: unknown): OpensrcFailure =>
  createOpensrcFailure({
    _tag: 'filesystem',
    operation,
    message,
    cause,
  })

describe('opensrc API', () => {
  test('should query files, trees, grep, AST matches, reads, sources, and fetches given OpenSrc services', async () => {
    //given
    let fetchCalls = 0
    const config: OpensrcConfig = {
      bin: 'opensrc',
      home: '/tmp/opensrc-api-home',
      environment: {},
    }
    const fileSystem: FileSystemService = {
      list: (_root: string, pattern: string | undefined) =>
        Effect.succeed(
          entries.filter(
            (entry) =>
              pattern === undefined ||
              ((pattern === '**/*.ts' || pattern === 'src/*.ts') && entry.path.endsWith('.ts')),
          ),
        ),
      read: (_root: string, path: string) =>
        contents[path] === undefined
          ? Effect.fail(failure('read', `Missing ${path}`, { path, marker: 'filesystem-cause' }))
          : Effect.succeed(contents[path]),
      realPath: (_root: string, path?: string) => Effect.succeed(`/tmp/opensrc-api-home/sources/zod/${path ?? ''}`),
    }
    const store: SourceStoreService = {
      current: () => [source],
      load: () => Effect.succeed([source]),
      refresh: () => Effect.succeed([source]),
      mutate: <A>(operation: (before: readonly Source[]) => Effect.Effect<A, OpensrcFailure>) =>
        Effect.gen(function* () {
          const before = [source]
          const value = yield* operation(before)
          return { before, after: [source], value }
        }),
      snapshot: Effect.succeed([source]),
    }
    const cli: OpenSrcCliService = {
      preflight: () => Effect.void,
      list: () => Effect.succeed({ packages: [source] }),
      fetch: () => {
        fetchCalls += 1
        return Effect.void
      },
      remove: () => Effect.void,
      clean: () => Effect.void,
    }
    const astParser: AstParserService = {
      find: (sourceName: string, file: string, _content: string, _pattern: string, _language: string, _limit: number) =>
        Effect.succeed<readonly RawAstMatch[]>([
          {
            source: sourceName,
            file,
            text: 'parse()',
            start: { line: 0, column: 0, offset: 0 },
            end: { line: 0, column: 7, offset: 7 },
            metavars: {},
          },
        ]),
    }
    const layer = Layer.mergeAll(
      Layer.succeed(OpensrcContext, { cwd: '/tmp/project' } as ExtensionContext),
      Layer.succeed(OpensrcConfiguration, config),
      Layer.succeed(FileSystem, fileSystem),
      Layer.succeed(OpenSrcCli, cli),
      Layer.succeed(SourceStore, store),
      Layer.succeed(AstParser, astParser),
    )

    //when
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const api = yield* createOpensrcApi()
          const listed = yield* api.list()
          const hasSource = yield* api.has('zod')
          const hasMissingSource = yield* api.has('missing')
          const foundSource = yield* api.get('zod')
          const missingSource = yield* api.get('missing')
          const read = yield* api.read('zod', 'src/index.ts')
          const files = yield* api.files('zod', '**/*.ts')
          const tree = yield* api.tree('zod')
          const grep = yield* api.grep('parse')
          const ast = yield* api.astGrep('zod', 'parse()', { lang: 'typescript' })
          const reads = yield* api.readMany('zod', ['src/*.ts', 'missing.ts'])
          const resolved = yield* api.resolve('zod')
          const fetched = yield* api.fetch('zod')
          const invalid = yield* captureEffectResult(api.read('', 'missing.ts'))
          const readFailure = yield* captureEffectResult(api.read('zod', 'missing.ts'))
          const invalidTree = yield* captureEffectResult(api.tree('zod', { depth: -1 } as never))
          const invalidGrep = yield* captureEffectResult(api.grep('parse', { maxResults: 1.5 } as never))
          const invalidAst = yield* captureEffectResult(api.astGrep('zod', 'parse()', { lang: [''] } as never))
          const invalidClean = yield* captureEffectResult(api.clean({ packages: 'yes' } as never))
          const invalidPaths = yield* captureEffectResult(api.readMany('zod', [''] as never))
          const invalidSpecs = yield* captureEffectResult(api.fetch([''] as never))
          return {
            listed,
            hasSource,
            hasMissingSource,
            foundSource,
            missingSource,
            read,
            files,
            tree,
            grep,
            ast,
            reads,
            resolved,
            fetched,
            invalid,
            readFailure,
            invalidTree,
            invalidGrep,
            invalidAst,
            invalidClean,
            invalidPaths,
            invalidSpecs,
          }
        }).pipe(Effect.provide(layer)),
      ),
    )

    //then
    expect(observed.listed).toEqual([source])
    expect(observed.hasSource).toBe(true)
    expect(observed.hasMissingSource).toBe(false)
    expect(observed.foundSource).toEqual(source)
    expect(observed.missingSource).toBeUndefined()
    expect(observed.read).toBe(contents['src/index.ts'])
    expect(observed.files.map((entry) => entry.path)).toEqual(['src/index.ts'])
    expect(observed.tree.children).toContainEqual(expect.objectContaining({ name: 'README.md', type: 'file' }))
    expect(observed.grep[0]).toMatchObject({ file: 'README.md', line: 1 })
    expect(observed.ast).toContainEqual(expect.objectContaining({ file: 'src/index.ts', line: 1, column: 1 }))
    expect(observed.reads['src/index.ts']).toBe('export const parse = () => 1')
    expect(observed.reads['missing.ts']).toContain('[Error:')
    expect(observed.resolved).toEqual({ type: 'npm', name: 'zod' })
    expect(observed.fetched[0].alreadyExists).toBe(true)
    expect(observed.invalid).toMatchObject({ _tag: 'Left', left: { _tag: 'validation' } })
    expect(observed.readFailure).toMatchObject({
      _tag: 'Left',
      left: { _tag: 'filesystem', cause: { path: 'missing.ts', marker: 'filesystem-cause' } },
    })
    expect(observed.invalidTree).toMatchObject({ _tag: 'Left', left: { _tag: 'validation', operation: 'tree' } })
    expect(observed.invalidGrep).toMatchObject({ _tag: 'Left', left: { _tag: 'validation', operation: 'grep' } })
    expect(observed.invalidAst).toMatchObject({ _tag: 'Left', left: { _tag: 'validation', operation: 'astGrep' } })
    expect(observed.invalidClean).toMatchObject({ _tag: 'Left', left: { _tag: 'validation', operation: 'clean' } })
    expect(observed.invalidPaths).toMatchObject({ _tag: 'Left', left: { _tag: 'validation' } })
    expect(observed.invalidSpecs).toMatchObject({ _tag: 'Left', left: { _tag: 'validation', operation: 'validation' } })
    expect(fetchCalls).toBe(1)
  })

  test('should serialize concurrent mutations given simultaneous fetch, remove, and clean operations', async () => {
    //given
    const oldSource: Source = { ...source, name: 'old-package', path: 'sources/old-package' }
    const cleanSource: Source = { ...source, name: 'clean-me', path: 'sources/clean-me' }
    let current = [oldSource, cleanSource]
    const makeSource = (name: string): Source => ({ ...source, name, path: `sources/${name}` })
    const cli: OpenSrcCliService = {
      preflight: () => Effect.void,
      list: () => Effect.sync(() => ({ packages: current })),
      fetch: (specs: readonly string[]) =>
        Effect.promise(async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 10))
          current = [...current, ...specs.map(makeSource)]
        }),
      remove: (names: readonly string[]) =>
        Effect.promise(async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 10))
          current = current.filter((candidate) => !names.includes(candidate.name))
        }),
      clean: () =>
        Effect.promise(async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 10))
          current = current.filter((candidate) => candidate.name !== 'clean-me')
        }),
    }
    const fileSystem: FileSystemService = {
      list: () => Effect.succeed([]),
      read: () => Effect.succeed(''),
      realPath: () => Effect.succeed('/tmp/opensrc-api-home'),
    }
    const astParser: AstParserService = { find: () => Effect.succeed([]) }
    const config: OpensrcConfig = { bin: 'opensrc', home: '/tmp/opensrc-api-home', environment: {} }
    const layer = Layer.mergeAll(
      Layer.succeed(OpensrcContext, { cwd: '/tmp/project' } as ExtensionContext),
      Layer.succeed(OpensrcConfiguration, config),
      Layer.succeed(FileSystem, fileSystem),
      Layer.succeed(OpenSrcCli, cli),
      SourceStoreLive().pipe(Layer.provide(Layer.succeed(OpenSrcCli, cli))),
      Layer.succeed(AstParser, astParser),
    )

    //when
    const observed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const api = yield* createOpensrcApi()
          return yield* Effect.all(
            [api.fetch('new-package'), api.remove(['old-package']), api.clean({ packages: true })],
            { concurrency: 'unbounded' },
          )
        }).pipe(Effect.provide(layer)),
      ),
    )

    //then
    expect(observed[0]).toEqual([{ source: expect.objectContaining({ name: 'new-package' }), alreadyExists: false }])
    expect(observed[1]).toEqual({ success: true, removed: ['old-package'] })
    expect(observed[2]).toEqual({ success: true, removed: ['clean-me'] })
  })

  test('should interrupt a pending API call given an outer interruption', async () => {
    //given
    const config: OpensrcConfig = {
      bin: 'opensrc',
      home: '/tmp/opensrc-api-home',
      environment: {},
    }
    const fileSystem: FileSystemService = {
      list: () => Effect.never,
      read: () => Effect.never,
      realPath: () => Effect.never,
    }
    const store: SourceStoreService = {
      current: () => [source],
      load: () => Effect.succeed([source]),
      refresh: () => Effect.succeed([source]),
      mutate: <A>(operation: (before: readonly Source[]) => Effect.Effect<A, OpensrcFailure>) =>
        Effect.gen(function* () {
          const before = [source]
          const value = yield* operation(before)
          return { before, after: [source], value }
        }),
      snapshot: Effect.succeed([source]),
    }
    const cli: OpenSrcCliService = {
      preflight: () => Effect.void,
      list: () => Effect.succeed({ packages: [source] }),
      fetch: () => Effect.void,
      remove: () => Effect.void,
      clean: () => Effect.void,
    }
    const astParser: AstParserService = { find: () => Effect.never }
    const layer = Layer.mergeAll(
      Layer.succeed(OpensrcContext, { cwd: '/tmp/project' } as ExtensionContext),
      Layer.succeed(OpensrcConfiguration, config),
      Layer.succeed(FileSystem, fileSystem),
      Layer.succeed(OpenSrcCli, cli),
      Layer.succeed(SourceStore, store),
      Layer.succeed(AstParser, astParser),
    )
    const controller = new AbortController()
    const execution = Effect.runPromiseExit(
      Effect.scoped(
        Effect.gen(function* () {
          const api = yield* createOpensrcApi()
          yield* api.read('zod', 'src/index.ts')
        }).pipe(Effect.provide(layer)),
      ),
      { signal: controller.signal },
    )

    //when
    const exit = await new Promise<Awaited<typeof execution>>((resolve) => {
      setTimeout(() => {
        controller.abort()
        void execution.then(resolve)
      }, 5)
    })

    //then
    expect(Exit.hasInterrupts(exit)).toBe(true)
  })
})
