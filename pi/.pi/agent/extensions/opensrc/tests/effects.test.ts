import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Effect, Exit, Layer, ManagedRuntime } from 'effect'
import type { Source, SourceIndex } from '../src/core/model.ts'
import { createOpensrcFailure } from '../src/core/model.ts'
import { createFileSystem } from '../src/effects/file-system.ts'
import { createAstParser } from '../src/effects/opensrc-api.ts'
import type { OpenSrcCliService, OpensrcConfig } from '../src/effects/opensrc-cli.ts'
import { OpenSrcCli, OpenSrcCliLive, OpensrcConfiguration, resolveOpensrcConfig } from '../src/effects/opensrc-cli.ts'
import type { PiHostService } from '../src/effects/pi-host.ts'
import { OpensrcPi, PiHost, PiHostLive } from '../src/effects/pi-host.ts'
import { createOpensrcRuntime } from '../src/effects/runtime.ts'
import { SourceStore, SourceStoreLive } from '../src/effects/source-store.ts'

const source: Source = {
  type: 'npm',
  name: 'zod',
  version: '3.0.0',
  path: 'packages/zod',
  fetchedAt: '2026-01-01',
}

const config: OpensrcConfig = {
  bin: 'opensrc-test',
  home: '/tmp/opensrc-test-home',
  environment: { OPENSRC_HOME: '/tmp/opensrc-test-home' },
}

async function makeCli(
  host: PiHostService,
  cliConfig: OpensrcConfig,
): Promise<{ cli: OpenSrcCliService; dispose: () => Promise<void> }> {
  const runtime = ManagedRuntime.make(
    OpenSrcCliLive.pipe(
      Layer.provide(Layer.mergeAll(Layer.succeed(PiHost, host), Layer.succeed(OpensrcConfiguration, cliConfig))),
    ),
  )
  const cli = await runtime.runPromise(
    Effect.gen(function* () {
      return yield* OpenSrcCli
    }),
  )
  return { cli, dispose: () => runtime.dispose() }
}

async function makePiHost(pi: ExtensionAPI): Promise<{ host: PiHostService; dispose: () => Promise<void> }> {
  const runtime = ManagedRuntime.make(PiHostLive.pipe(Layer.provide(Layer.succeed(OpensrcPi, pi))))
  const host = await runtime.runPromise(
    Effect.gen(function* () {
      return yield* PiHost
    }),
  )
  return { host, dispose: () => runtime.dispose() }
}

describe('opensrc effects', () => {
  test('forwards CLI arguments through the Effect service', async () => {
    //given
    const requests: Array<{ args: readonly string[]; cwd?: string }> = []
    const host: PiHostService = {
      exec: (request) => {
        requests.push({ args: request.args, cwd: request.cwd })
        return Effect.succeed({
          stdout: request.args[0] === '--version' ? 'opensrc 0.7.3' : '{"packages":[],"repos":[]}',
          stderr: '',
          code: 0,
          killed: false,
        })
      },
    }
    const { cli, dispose } = await makeCli(host, config)

    //when
    const result = await Effect.runPromise(cli.list())

    //then
    expect(result).toEqual({ packages: [], repos: [] })
    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual({ args: ['list', '--json'], cwd: undefined })
    await dispose()
  })

  test('shares one concurrent CLI preflight', async () => {
    //given
    let versionCalls = 0
    const host: PiHostService = {
      exec: (request) =>
        Effect.promise(async () => {
          if (request.args[0] === '--version') {
            versionCalls += 1
            await new Promise<void>((resolve) => setTimeout(resolve, 10))
            return { stdout: 'opensrc 0.7.3', stderr: '', code: 0, killed: false }
          }
          return { stdout: '{"packages":[],"repos":[]}', stderr: '', code: 0, killed: false }
        }),
    }
    const { cli, dispose } = await makeCli(host, config)

    //when
    await Promise.all([Effect.runPromise(cli.list()), Effect.runPromise(cli.fetch(['zod'], '/tmp/project'))])

    //then
    expect(versionCalls).toBe(1)
    await dispose()
  })

  test('terminates the AST parser worker when interrupted', async () => {
    //given
    const controller = new AbortController()
    const parser = createAstParser()
    const content = Array.from({ length: 100000 }, () => 'const value = parse()').join('\n')
    const evaluation = Effect.runPromiseExit(
      parser.find('zod', 'src/index.ts', content, 'parse()', 'typescript', 100),
      { signal: controller.signal },
    )

    //when
    controller.abort()
    const exit = await evaluation

    //then
    expect(Exit.hasInterrupts(exit)).toBe(true)
  })

  test('passes environment values to a child without changing the parent environment', async () => {
    //given
    const previousHome = process.env.OPENSRC_HOME
    const { host, dispose } = await makePiHost({} as ExtensionAPI)

    //when
    const result = await Effect.runPromise(
      host.exec({
        command: process.execPath,
        args: ['-e', 'process.stdout.write(process.env.OPENSRC_HOME ?? "")'],
        environment: { OPENSRC_HOME: '/tmp/opensrc-effect-home' },
      }),
    )

    //then
    expect(result.stdout).toBe('/tmp/opensrc-effect-home')
    expect(process.env.OPENSRC_HOME).toBe(previousHome)
    await dispose()
  })

  test('keeps concurrent child environments isolated', async () => {
    //given
    const { host, dispose } = await makePiHost({} as ExtensionAPI)
    const command = process.execPath
    const args = ['-e', 'setTimeout(() => process.stdout.write(process.env.OPENSRC_HOME ?? ""), 20)']

    //when
    const results = await Promise.all([
      Effect.runPromise(host.exec({ command, args, environment: { OPENSRC_HOME: '/tmp/opensrc-first' } })),
      Effect.runPromise(host.exec({ command, args, environment: { OPENSRC_HOME: '/tmp/opensrc-second' } })),
    ])

    //then
    expect(results.map((result) => result.stdout).sort()).toEqual(['/tmp/opensrc-first', '/tmp/opensrc-second'])
    await dispose()
  })

  test('interrupts a child process while it waits', async () => {
    //given
    const controller = new AbortController()
    const { host, dispose } = await makePiHost({} as ExtensionAPI)
    const evaluation = Effect.runPromiseExit(
      host.exec({
        command: process.execPath,
        args: ['-e', 'setTimeout(() => {}, 1000)'],
        environment: { OPENSRC_HOME: '/tmp/opensrc-effect-home' },
      }),
      { signal: controller.signal },
    )

    //when
    await new Promise<void>((resolve) =>
      setTimeout(() => {
        controller.abort()
        resolve()
      }, 10),
    )
    const exit = await evaluation

    //then
    expect(Exit.hasInterrupts(exit)).toBe(true)
    await dispose()
  })

  test('keeps the parent environment after a child failure', async () => {
    //given
    const previousHome = process.env.OPENSRC_HOME
    const { host, dispose } = await makePiHost({} as ExtensionAPI)

    //when
    const result = await Effect.runPromise(
      host.exec({
        command: 'opensrc-command-that-does-not-exist',
        args: [],
        environment: { OPENSRC_HOME: '/tmp/opensrc-effect-home' },
      }),
    )

    //then
    expect(result.code).toBe(1)
    expect(process.env.OPENSRC_HOME).toBe(previousHome)
    await dispose()
  })

  test('forwards the working directory for fetch commands', async () => {
    //given
    const requests: Array<{ args: readonly string[]; cwd?: string }> = []
    const host: PiHostService = {
      exec: (request) => {
        requests.push({ args: request.args, cwd: request.cwd })
        return Effect.succeed({ stdout: 'opensrc 0.7.3', stderr: '', code: 0, killed: false })
      },
    }
    const { cli, dispose } = await makeCli(host, config)

    //when
    await Effect.runPromise(cli.fetch(['zod'], '/tmp/project'))

    //then
    expect(requests.at(-1)).toEqual({ args: ['fetch', 'zod', '--cwd', '/tmp/project', '--quiet'], cwd: '/tmp/project' })
    await dispose()
  })

  test('maps a failed CLI command to a typed failure', async () => {
    //given
    const host: PiHostService = {
      exec: () => Effect.succeed({ stdout: 'opensrc 0.7.3', stderr: 'permission denied', code: 2, killed: false }),
    }
    const { cli, dispose } = await makeCli(host, config)

    //when
    const exit = await Effect.runPromise(Effect.exit(cli.preflight()))

    //then
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain('permission denied')
      expect(String(exit.cause)).toContain('npm install -g opensrc')
    }
    await dispose()
  })

  test('resolves OPENSRC_HOME and the executable without using another cache variable', () => {
    //given
    const environment = { OPENSRC_HOME: '~/isolated', OPENSRC_BIN: '/tmp/opensrc' }

    //when
    const result = resolveOpensrcConfig(environment, '/home/tester')

    //then
    expect(result.bin).toBe('/tmp/opensrc')
    expect(result.environment).toEqual({ OPENSRC_HOME: '/home/tester/isolated' })
  })

  test('refreshes the source snapshot after success and preserves it after failure', async () => {
    //given
    let listCalls = 0
    const changed: Source = { ...source, version: '4.0.0' }
    const fakeCli = {
      preflight: () => Effect.void,
      list: () => {
        listCalls += 1
        if (listCalls === 3)
          return Effect.fail(createOpensrcFailure({ _tag: 'cli', operation: 'list', message: 'failed' }))
        const index: SourceIndex = listCalls === 1 ? { packages: [source] } : { packages: [changed] }
        return Effect.succeed(index)
      },
      fetch: () => Effect.void,
      remove: () => Effect.void,
      clean: () => Effect.void,
    }
    const runtime = ManagedRuntime.make(SourceStoreLive().pipe(Layer.provide(Layer.succeed(OpenSrcCli, fakeCli))))

    //when
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const store = yield* SourceStore
        const first = yield* store.load()
        const second = yield* store.refresh()
        const failed = yield* Effect.exit(store.refresh())
        const preserved = yield* store.snapshot
        return { first, second, failed, preserved }
      }),
    )
    await runtime.dispose()

    //then
    expect(result.first[0].version).toBe('3.0.0')
    expect(result.second[0].version).toBe('4.0.0')
    expect(Exit.isFailure(result.failed)).toBe(true)
    expect(result.preserved[0].version).toBe('4.0.0')
  })

  test('disposes the managed runtime', async () => {
    //given
    const runtime = createOpensrcRuntime()
    const pi = {} as ExtensionAPI
    const context = { cwd: '/tmp/project' } as ExtensionContext

    //when
    await runtime.dispose()

    //then
    await expect(runtime.run('export default () => 1', pi, context, undefined)).rejects.toThrow('disposed')
  })

  test('rejects filesystem traversal before reading outside the source root', async () => {
    //given
    const root = await mkdtemp(join(tmpdir(), 'opensrc-fs-test-'))
    const outside = join(root, '..', 'opensrc-outside.txt')
    await writeFile(outside, 'secret')
    const fileSystem = createFileSystem()

    //when
    const exit = await Effect.runPromise(Effect.exit(fileSystem.read(root, '../opensrc-outside.txt')))

    //then
    expect(Exit.isFailure(exit)).toBe(true)
    await rm(root, { recursive: true, force: true })
    await rm(outside, { force: true })
  })
})
