import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { PiProcess } from '@eratio/pi-effect'
import { Effect, Exit, Layer, ManagedRuntime } from 'effect'
import type {
  OpenSrcCliService,
  OpensrcConfig,
  PiExecutionRequest,
  PiHostService,
  Source,
  SourceIndex,
} from '../src/extension.ts'
import {
  createAstParser,
  createFileSystem,
  createOpensrcFailure,
  GithubLogin,
  OpenSrcCli,
  OpenSrcCliLive,
  OpensrcConfiguration,
  PiHost,
  PiHostLive,
  resolveOpensrcConfig,
  SourceStore,
  SourceStoreLive,
} from '../src/extension.ts'

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

  test('should use each layer’s CLI dependencies given concurrent source fetches', async () => {
    const requests: PiExecutionRequest[][] = [[], []]
    const clients = await Promise.all(
      requests.map((calls, index) =>
        makeCli(
          {
            exec: (request: PiExecutionRequest) => {
              calls.push(request)
              return Effect.succeed({
                stdout: request.args[0] === '--version' ? 'opensrc 0.7.3' : '',
                stderr: '',
                code: 0,
                killed: false,
              })
            },
          },
          { ...config, bin: `opensrc-${index}`, environment: { OPENSRC_HOME: `/tmp/opensrc-${index}` } },
        ),
      ),
    )

    try {
      await Promise.all(
        clients.map(({ cli }, index) => Effect.runPromise(cli.fetch([`owner/repo-${index}`], '/tmp/project'))),
      )

      for (const [index, calls] of requests.entries()) {
        expect(calls).toHaveLength(2)
        expect(calls[1]).toMatchObject({
          command: `opensrc-${index}`,
          args: ['fetch', `owner/repo-${index}`, '--cwd', '/tmp/project', '--quiet'],
          environment: { OPENSRC_HOME: `/tmp/opensrc-${index}` },
        })
      }
    } finally {
      await Promise.all(clients.map(({ dispose }) => dispose()))
    }
  })

  test('should terminate AST workers after matches, parser errors, and cancellation', async () => {
    //given
    const originalTerminate = Worker.prototype.terminate
    let terminationCount = 0
    Worker.prototype.terminate = function (this: Worker): Promise<number> {
      terminationCount += 1
      return originalTerminate.call(this)
    }
    const parser = createAstParser()

    try {
      //when
      const matches = await Effect.runPromise(
        parser.find('zod', 'src/index.ts', 'const value = parse()', 'parse()', 'typescript', 100),
      )
      const failure = await Effect.runPromiseExit(
        parser.find('zod', 'src/index.ts', 'const value = parse()', 'parse()', 'python', 100),
      )
      const controller = new AbortController()
      const content = Array.from({ length: 100000 }, () => 'const value = parse()').join('\n')
      const evaluation = Effect.runPromiseExit(
        parser.find('zod', 'src/index.ts', content, 'parse()', 'typescript', 100),
        { signal: controller.signal },
      )
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      controller.abort()
      const exit = await evaluation

      //then
      expect(matches.map((match) => match.text)).toEqual(['parse()'])
      expect(Exit.isFailure(failure)).toBe(true)
      if (Exit.isFailure(failure)) expect(String(failure.cause)).toContain('Unsupported AST language')
      expect(Exit.hasInterrupts(exit)).toBe(true)
      expect(terminationCount).toBe(3)
    } finally {
      Worker.prototype.terminate = originalTerminate
    }
  })

  test('should pass environment values to a child without changing the parent environment given a child process launch', async () => {
    //given
    const previousHome = process.env.OPENSRC_HOME
    const { host, dispose } = await makePiHost()

    //when
    const result = await Effect.runPromise(
      host.exec({
        command: process.execPath,
        args: ['-e', 'process.stdout.write(process.env.OPENSRC_HOME ?? ""); process.stderr.write("child-warning")'],
        environment: { OPENSRC_HOME: '/tmp/opensrc-effect-home' },
      }),
    )

    //then
    expect(result).toEqual({
      stdout: '/tmp/opensrc-effect-home',
      stderr: 'child-warning',
      code: 0,
      killed: false,
    })
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

  test('should send SIGTERM then SIGKILL after five seconds given caller cancellation', async () => {
    //given
    const root = await mkdtemp(join(tmpdir(), 'opensrc-child-cancel-'))
    const marker = join(root, 'signal')
    const childPidPath = join(root, 'pid')
    const script = [
      'const { writeFileSync } = require("node:fs")',
      `process.on("SIGTERM", () => writeFileSync(${JSON.stringify(marker)}, "terminated"))`,
      `writeFileSync(${JSON.stringify(childPidPath)}, String(process.pid))`,
      `writeFileSync(${JSON.stringify(marker)}, "ready")`,
      'setInterval(() => {}, 1000)',
    ].join(';')
    const controller = new AbortController()
    const { host, dispose } = await makePiHost()
    let childPid: number | undefined
    const evaluation = Effect.runPromiseExit(
      host.exec({
        command: process.execPath,
        args: ['-e', script],
        environment: { OPENSRC_HOME: '/tmp/opensrc-effect-home' },
      }),
      { signal: controller.signal },
    )
    const waitForMarker = async (expected: string): Promise<void> => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if ((await readFile(marker, 'utf8').catch(() => '')) === expected) return
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
      }
      throw new Error(`Child process did not write ${expected}.`)
    }
    const isChildRunning = (pid: number): boolean => {
      try {
        process.kill(pid, 0)
        return true
      } catch (cause) {
        if (cause instanceof Error && 'code' in cause && cause.code === 'ESRCH') return false
        throw cause
      }
    }
    const waitForChildExit = async (pid: number): Promise<void> => {
      for (let attempt = 0; attempt < 650; attempt += 1) {
        if (!isChildRunning(pid)) return
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
      }
      throw new Error('Child process was not killed after the SIGTERM grace period.')
    }

    try {
      //when
      await waitForMarker('ready')
      childPid = Number(await readFile(childPidPath, 'utf8'))
      const cancelledAt = Date.now()
      controller.abort()
      const exit = await evaluation
      await waitForMarker('terminated')
      await waitForChildExit(childPid)

      //then
      expect(Exit.hasInterrupts(exit)).toBe(true)
      expect(Date.now() - cancelledAt).toBeGreaterThanOrEqual(4_500)
    } finally {
      if (!controller.signal.aborted) controller.abort()
      if (childPid !== undefined && isChildRunning(childPid)) process.kill(childPid, 'SIGKILL')
      await dispose()
      await rm(root, { recursive: true, force: true })
    }
  }, 10_000)

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
    expect(result).toMatchObject({ stdout: '', code: 1, killed: false })
    expect(result.stderr).toContain('opensrc-command-that-does-not-exist')
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

  test('does not request a GitHub token for a public repository', async () => {
    const requests: PiExecutionRequest[] = []
    const host: PiHostService = {
      exec: (request: PiExecutionRequest) => {
        requests.push(request)
        return Effect.succeed({
          stdout: request.args[0] === '--version' ? 'opensrc 0.7.3' : '',
          stderr: '',
          code: 0,
          killed: false,
        })
      },
    }
    const cliConfig: OpensrcConfig = {
      ...config,
      environment: { ...config.environment, GH_TOKEN: 'ambient-gh-token', GITHUB_TOKEN: 'ambient-github-token' },
    }
    const { cli, dispose } = await makeCli(host, cliConfig)

    try {
      await Effect.runPromise(cli.fetch(['owner/public'], '/tmp/project'))

      const fetch = requests.find((request) => request.command === 'opensrc-test' && request.args[0] === 'fetch')
      expect(fetch?.environment.GH_TOKEN).toBeUndefined()
      expect(fetch?.environment.GITHUB_TOKEN).toBeUndefined()
      expect(requests.filter((request) => request.command === 'gh')).toHaveLength(0)
    } finally {
      await dispose()
    }
  })

  test('uses a refreshable gh token only for a confirmed private repository retry', async () => {
    const token = 'gho-short-token'
    const requests: PiExecutionRequest[] = []
    let fetchCount = 0
    const host: PiHostService = {
      exec: (request: PiExecutionRequest) => {
        requests.push(request)
        if (request.command === 'opensrc-test' && request.args[0] === '--version') {
          return Effect.succeed({ stdout: 'opensrc 0.7.3', stderr: '', code: 0, killed: false })
        }
        if (request.command === 'opensrc-test' && request.args[0] === 'fetch') {
          fetchCount += 1
          if (request.environment.GITHUB_TOKEN === token) {
            const failed = fetchCount === 4
            return Effect.succeed({
              stdout: '',
              stderr: failed ? `clone failed with ${token}` : '',
              code: failed ? 2 : 0,
              killed: false,
            })
          }
          return Effect.succeed({
            stdout: '',
            stderr: 'Repository not found on GitHub. If this is a private repo, set GITHUB_TOKEN.',
            code: 1,
            killed: false,
          })
        }
        if (request.command === 'gh' && request.args[0] === 'repo') {
          return Effect.succeed({ stdout: 'true', stderr: '', code: 0, killed: false })
        }
        if (request.command === 'gh' && request.args[0] === 'auth' && request.args[1] === 'status') {
          return Effect.succeed({
            stdout: JSON.stringify({
              hosts: { 'github.com': [{ active: true, state: 'success', refreshable: true }] },
            }),
            stderr: '',
            code: 0,
            killed: false,
          })
        }
        if (request.command === 'gh' && request.args[0] === 'auth' && request.args[1] === 'token') {
          return Effect.succeed({ stdout: token, stderr: '', code: 0, killed: false })
        }
        return Effect.succeed({ stdout: '', stderr: 'unexpected command', code: 99, killed: false })
      },
    }
    const { cli, dispose } = await makeCli(host, config)

    try {
      await Effect.runPromise(cli.fetch(['owner/private'], '/tmp/project'))
      const failedRetry = await Effect.runPromise(Effect.exit(cli.fetch(['owner/private'], '/tmp/project')))

      expect(Exit.isFailure(failedRetry)).toBe(true)
      if (Exit.isFailure(failedRetry)) expect(String(failedRetry.cause)).not.toContain(token)

      const fetches = requests.filter((request) => request.command === 'opensrc-test' && request.args[0] === 'fetch')
      expect(fetches).toHaveLength(4)
      expect(fetches[0]?.environment.GITHUB_TOKEN).toBeUndefined()
      expect(fetches[0]?.environment.GH_TOKEN).toBeUndefined()
      expect(fetches[1]?.environment.GITHUB_TOKEN).toBe(token)
      expect(fetches[1]?.args).not.toContain(token)
      expect(fetches[2]?.environment.GITHUB_TOKEN).toBeUndefined()
      expect(fetches[2]?.environment.GH_TOKEN).toBeUndefined()
      expect(fetches[3]?.environment.GITHUB_TOKEN).toBe(token)
      expect(
        requests.filter(
          (request) => request.command === 'gh' && request.args[0] === 'auth' && request.args[1] === 'token',
        ),
      ).toHaveLength(2)
      expect(requests.flatMap((request) => request.args)).not.toContain(token)
    } finally {
      await dispose()
    }
  })

  test('should not use a token given a failed post-login credential or visibility check', async () => {
    for (const failure of ['credential', 'visibility'] as const) {
      const requests: PiExecutionRequest[] = []
      let loggedIn = false
      const host: PiHostService = {
        exec: (request: PiExecutionRequest) => {
          requests.push(request)
          if (request.command === 'opensrc-test' && request.args[0] === '--version')
            return Effect.succeed({ stdout: 'opensrc 0.7.3', stderr: '', code: 0, killed: false })
          if (request.command === 'opensrc-test' && request.args[0] === 'fetch')
            return Effect.succeed({
              stdout: '',
              stderr: 'Repository not found on GitHub. If this is a private repo, set GITHUB_TOKEN.',
              code: 1,
              killed: false,
            })
          if (request.args[0] === 'repo')
            return Effect.succeed({
              stdout: loggedIn && failure === 'visibility' ? 'false' : 'true',
              stderr: '',
              code: 0,
              killed: false,
            })
          if (request.args[1] === 'status')
            return Effect.succeed({
              stdout: JSON.stringify({
                hosts: {
                  'github.com': [{ active: true, state: 'success', refreshable: loggedIn && failure !== 'credential' }],
                },
              }),
              stderr: '',
              code: 0,
              killed: false,
            })
          return Effect.succeed({ stdout: '', stderr: 'unexpected command', code: 99, killed: false })
        },
      }
      const { cli, dispose } = await makeCli(host, config)

      try {
        const result = await Effect.runPromiseExit(
          cli.fetch(['owner/private'], '/tmp/project').pipe(
            Effect.provideService(
              GithubLogin,
              Effect.sync(() => {
                loggedIn = true
              }),
            ),
          ),
        )

        expect(Exit.isFailure(result)).toBe(true)
        expect(requests.some((request) => request.args[0] === 'auth' && request.args[1] === 'token')).toBe(false)
        expect(requests.filter((request) => request.args[0] === 'fetch')).toHaveLength(1)
      } finally {
        await dispose()
      }
    }
  })

  test('does not fetch a private repository when gh has no refreshable login', async () => {
    const requests: PiExecutionRequest[] = []
    const host: PiHostService = {
      exec: (request: PiExecutionRequest) => {
        requests.push(request)
        if (request.command === 'opensrc-test' && request.args[0] === '--version') {
          return Effect.succeed({ stdout: 'opensrc 0.7.3', stderr: '', code: 0, killed: false })
        }
        if (request.command === 'opensrc-test' && request.args[0] === 'fetch') {
          return Effect.succeed({
            stdout: '',
            stderr: 'Repository not found on GitHub. If this is a private repo, set GITHUB_TOKEN.',
            code: 1,
            killed: false,
          })
        }
        if (request.command === 'gh' && request.args[0] === 'repo') {
          return Effect.succeed({ stdout: 'true', stderr: '', code: 0, killed: false })
        }
        if (request.command === 'gh' && request.args[0] === 'auth' && request.args[1] === 'status') {
          return Effect.succeed({
            stdout: JSON.stringify({
              hosts: { 'github.com': [{ active: true, state: 'success', refreshable: false }] },
            }),
            stderr: '',
            code: 0,
            killed: false,
          })
        }
        return Effect.succeed({ stdout: '', stderr: '', code: 0, killed: false })
      },
    }
    const { cli, dispose } = await makeCli(host, config)

    try {
      const result = await Effect.runPromise(Effect.exit(cli.fetch(['owner/private'], '/tmp/project')))

      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) expect(String(result.cause)).toContain('refreshable')
      expect(
        requests.filter(
          (request) => request.command === 'gh' && request.args[0] === 'auth' && request.args[1] === 'token',
        ),
      ).toHaveLength(0)
    } finally {
      await dispose()
    }
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
        const current = store.current()
        return { first, second, failed, preserved, current }
      }),
    )
    await runtime.dispose()

    //then
    expect(result.first[0].version).toBe('3.0.0')
    expect(result.second[0].version).toBe('4.0.0')
    expect(Exit.isFailure(result.failed)).toBe(true)
    expect(result.preserved[0].version).toBe('4.0.0')
    expect(result.current[0].version).toBe('4.0.0')
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
