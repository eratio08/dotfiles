import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PiProcess } from '@eratio/pi-effect'
import { Effect, Exit, Layer, ManagedRuntime } from 'effect'
import type { PiExecutionRequest, Source, SourceIndex } from '../src/core/model.ts'
import { createOpensrcFailure } from '../src/core/model.ts'
import { createFileSystem } from '../src/effects/file-system.ts'
import { createAstParser } from '../src/effects/opensrc-api.ts'
import type { OpenSrcCliService, OpensrcConfig } from '../src/effects/opensrc-cli.ts'
import { OpenSrcCli, OpenSrcCliLive, OpensrcConfiguration, resolveOpensrcConfig } from '../src/effects/opensrc-cli.ts'
import type { PiHostService } from '../src/effects/pi-host.ts'
import { PiHost, PiHostLive } from '../src/effects/pi-host.ts'
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

async function makePiHost(): Promise<{ host: PiHostService; dispose: () => Promise<void> }> {
  const runtime = ManagedRuntime.make(
    PiHostLive.pipe(
      Layer.provide(
        Layer.succeed(PiProcess, {
          exec: () => Effect.succeed({ stdout: '', stderr: '', code: 0, killed: false }),
        }),
      ),
    ),
  )
  const host = await runtime.runPromise(
    Effect.gen(function* () {
      return yield* PiHost
    }),
  )
  return { host, dispose: () => runtime.dispose() }
}

describe('opensrc effects', () => {
  test('should forward CLI arguments given an Effect service call', async () => {
    //given
    const requests: Array<{ args: readonly string[]; cwd?: string }> = []
    const host: PiHostService = {
      exec: (request: PiExecutionRequest) => {
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

  test('should share one CLI preflight given concurrent calls', async () => {
    //given
    let versionCalls = 0
    const host: PiHostService = {
      exec: (request: PiExecutionRequest) =>
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

  test('should terminate the AST parser worker given interrupted parsing', async () => {
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

  test('should pass environment values to a child without changing the parent environment given a child process launch', async () => {
    //given
    const previousHome = process.env.OPENSRC_HOME
    const { host, dispose } = await makePiHost()

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

  test('should keep child environments isolated given concurrent child processes', async () => {
    //given
    const { host, dispose } = await makePiHost()
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

  test('should interrupt a child process given caller cancellation while it waits', async () => {
    //given
    const controller = new AbortController()
    const { host, dispose } = await makePiHost()
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

  test('should keep the parent environment unchanged given a child failure', async () => {
    //given
    const previousHome = process.env.OPENSRC_HOME
    const { host, dispose } = await makePiHost()

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

  test('should forward the working directory given a fetch command', async () => {
    //given
    const requests: Array<{ args: readonly string[]; cwd?: string }> = []
    const host: PiHostService = {
      exec: (request: PiExecutionRequest) => {
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

  test('should map a failed CLI command to a typed failure given a nonzero exit', async () => {
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

  test('should resolve OPENSRC_HOME and the executable given no other cache variable', () => {
    //given
    const environment = { OPENSRC_HOME: '~/isolated', OPENSRC_BIN: '/tmp/opensrc' }

    //when
    const result = resolveOpensrcConfig(environment, '/home/tester')

    //then
    expect(result.bin).toBe('/tmp/opensrc')
    expect(result.environment).toEqual({ OPENSRC_HOME: '/home/tester/isolated' })
  })

  test('should refresh the source snapshot after success and preserve it after failure given fetch results', async () => {
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

  test('should reject filesystem traversal before reading outside the source root given an escaping path', async () => {
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
