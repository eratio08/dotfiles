import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecResult } from '@earendil-works/pi-coding-agent'
import { PiExtension } from '@eratio/pi-effect'
import { createFakeExtensionApi, createFakeExtensionContext, type FakeExtension } from '@eratio/pi-effect/testing'
import { Effect } from 'effect'
import { createOpensrcNativePlugin } from '../index.ts'
import type {
  OpensrcConfig,
  OpensrcFailure,
  PiExecutionRequest,
  PiExecutionResult,
  PiHostService,
  Source,
} from '../src/extension.ts'
import { createOpensrcFailure } from '../src/extension.ts'

const source = {
  type: 'npm' as const,
  name: 'zod',
  version: '3.0.0',
  path: 'packages/zod',
  fetchedAt: '2026-01-01',
}
const readme = '# Zod\nA schema parser.'
const sourceFile = 'export const parse = () => 1\nparse()\n'

function createNativePiHost(exec: FakeExtension['api']['exec']): PiHostService {
  return {
    exec: (request: PiExecutionRequest) =>
      Effect.callback<PiExecutionResult, OpensrcFailure>((resume) => {
        const controller = new AbortController()
        void exec(request.command, [...request.args], { cwd: request.cwd, signal: controller.signal }).then(
          (result) =>
            resume(
              Effect.succeed({
                stdout: result.stdout,
                stderr: result.stderr,
                code: result.code,
                killed: result.killed ?? false,
              }),
            ),
          (cause) =>
            resume(
              Effect.succeed({
                stdout: '',
                stderr: cause instanceof Error ? cause.message : String(cause),
                code: 1,
                killed: controller.signal.aborted,
              }),
            ),
        )
        return Effect.sync(() => controller.abort())
      }),
  }
}

async function createOpensrcNativeHarness(piHost?: PiHostService): Promise<{
  readonly fake: FakeExtension
  readonly requests: string[][]
  readonly maxConcurrentFetches: () => number
  readonly fetchStarted: Promise<void>
  readonly fetchWasCancelled: () => boolean
  readonly failOn: (operation: string | undefined) => void
  readonly invoke: (name: string, params: unknown, signal?: AbortSignal) => Promise<unknown>
  readonly shutdown: () => Promise<void>
}> {
  const fake = createFakeExtensionApi()
  const home = await mkdtemp(join(tmpdir(), 'opensrc-native-tools-'))
  const sourceRoot = join(home, source.path)
  await mkdir(join(sourceRoot, 'src'), { recursive: true })
  await writeFile(join(sourceRoot, 'README.md'), readme)
  await writeFile(join(sourceRoot, 'src/index.ts'), sourceFile)
  const requests: string[][] = []
  let cachedSources = [source]
  let failedOperation: string | undefined
  let activeFetches = 0
  let maxConcurrentFetches = 0
  let fetchWasCancelled = false
  let resolveFetchStarted: (() => void) | undefined
  const fetchStarted = new Promise<void>((resolve) => {
    resolveFetchStarted = resolve
  })
  fake.api.exec = async (
    _command: string,
    args: string[],
    options?: Parameters<typeof fake.api.exec>[2],
  ): Promise<ExecResult> => {
    requests.push([...args])
    if (args[0] === failedOperation) {
      return { stdout: '', stderr: 'fetch denied', code: 2, killed: false }
    }
    if (args[0] === 'fetch') {
      activeFetches += 1
      maxConcurrentFetches = Math.max(maxConcurrentFetches, activeFetches)
      resolveFetchStarted?.()
      const wasCancelled = await new Promise<boolean>((resolve) => {
        const signal = options?.signal
        if (signal?.aborted) {
          fetchWasCancelled = true
          return resolve(true)
        }
        const finish = (cancelled: boolean): void => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', cancel)
          resolve(cancelled)
        }
        const cancel = (): void => {
          fetchWasCancelled = true
          finish(true)
        }
        const timer = setTimeout(() => finish(false), 25)
        signal?.addEventListener('abort', cancel, { once: true })
      })
      activeFetches -= 1
      if (wasCancelled) {
        fetchWasCancelled = true
        return { stdout: '', stderr: '', code: 1, killed: true }
      }
      const spec = args[1]
      if (spec !== undefined && !cachedSources.some((cached) => cached.name === spec)) {
        const fetched = { ...source, name: spec, path: `packages/${spec}`, fetchedAt: '2026-01-02' }
        cachedSources = [...cachedSources, fetched]
        await mkdir(join(home, fetched.path), { recursive: true })
        await writeFile(join(home, fetched.path, 'README.md'), `Fetched ${spec}`)
      }
    }
    if (args[0] === 'remove' || args[0] === 'clean') cachedSources = []
    return {
      stdout: args[0] === '--version' ? 'opensrc 0.7.3' : JSON.stringify({ packages: cachedSources, repos: [] }),
      stderr: '',
      code: 0,
      killed: false,
    }
  }
  const config: OpensrcConfig = { bin: 'opensrc-test', home, environment: {} }
  const host = piHost ?? createNativePiHost(fake.api.exec)
  await PiExtension.install(createOpensrcNativePlugin(config, host))(fake.api)
  return {
    fake,
    requests,
    maxConcurrentFetches: () => maxConcurrentFetches,
    fetchStarted,
    fetchWasCancelled: () => fetchWasCancelled,
    failOn: (operation: string | undefined) => {
      failedOperation = operation
    },
    invoke: (name: string, params: unknown, signal?: AbortSignal) =>
      fake.invokeTool(name, 'opensrc-native-test', params, undefined, signal),
    shutdown: async () => {
      await fake.invokeEvent('session_shutdown', { type: 'session_shutdown', reason: 'test' })
      await rm(home, { recursive: true, force: true })
    },
  }
}

test('should return cached sources as structured data given native codemode registration', async () => {
  //given
  const harness = await createOpensrcNativeHarness()

  try {
    //when
    const result = await harness.invoke('opensrc_list', {})

    //then
    expect(harness.fake.tools.get('opensrc_list')).toMatchObject({
      exposure: 'codemode',
      namespace: { name: 'opensrc' },
      outputSchema: expect.any(Object),
    })
    expect(result).toMatchObject({ structuredContent: [source] })
  } finally {
    await harness.shutdown()
  }
})

test('should check a source and version given a native codemode call', async () => {
  //given
  const harness = await createOpensrcNativeHarness()

  try {
    //when
    const result = await harness.invoke('opensrc_has', { name: 'zod', version: '3.0.0' })

    //then
    expect(result).toMatchObject({ structuredContent: true })
  } finally {
    await harness.shutdown()
  }
})

test('should return null for a missing source given a native codemode call', async () => {
  //given
  const harness = await createOpensrcNativeHarness()

  try {
    //when
    const result = await harness.invoke('opensrc_get', { name: 'missing' })

    //then
    expect(harness.fake.tools.get('opensrc_get')?.outputSchema).toBeDefined()
    expect(result).toMatchObject({ structuredContent: null })
  } finally {
    await harness.shutdown()
  }
})

test('should parse a source spec without fetching given a native codemode call', async () => {
  //given
  const harness = await createOpensrcNativeHarness()

  try {
    //when
    const result = await harness.invoke('opensrc_resolve', { spec: 'zod' })

    //then
    expect(result).toMatchObject({ structuredContent: { type: 'npm', name: 'zod' } })
    expect(harness.requests.map(([operation]) => operation)).not.toContain('fetch')
  } finally {
    await harness.shutdown()
  }
})

test('should list cached file paths given a native codemode call', async () => {
  //given
  const harness = await createOpensrcNativeHarness()
  const inventory = (await harness.invoke('opensrc_list', {})) as { structuredContent: { name: string }[] }
  const sourceName = inventory.structuredContent[0]?.name

  try {
    //when
    const result = await harness.invoke('opensrc_files', { sourceName, glob: '**/*.ts' })

    //then
    expect(result).toMatchObject({
      structuredContent: expect.arrayContaining([expect.objectContaining({ path: 'src/index.ts', type: 'file' })]),
    })
  } finally {
    await harness.shutdown()
  }
})

test('should build a cached source tree given a native codemode call', async () => {
  //given
  const harness = await createOpensrcNativeHarness()
  const inventory = (await harness.invoke('opensrc_list', {})) as { structuredContent: { name: string }[] }
  const sourceName = inventory.structuredContent[0]?.name

  try {
    //when
    const result = await harness.invoke('opensrc_tree', { sourceName, options: { depth: 2 } })

    //then
    expect(result).toMatchObject({
      structuredContent: {
        name: 'zod',
        children: expect.arrayContaining([expect.objectContaining({ name: 'src', type: 'directory' })]),
      },
    })
  } finally {
    await harness.shutdown()
  }
})

test('should search cached source text given a native codemode call', async () => {
  //given
  const harness = await createOpensrcNativeHarness()
  const inventory = (await harness.invoke('opensrc_list', {})) as { structuredContent: { name: string }[] }
  const sourceName = inventory.structuredContent[0]?.name

  try {
    //when
    const result = await harness.invoke('opensrc_grep', {
      pattern: 'parse',
      options: { sources: [sourceName], include: '**/*.ts' },
    })

    //then
    expect(result).toMatchObject({
      structuredContent: expect.arrayContaining([
        expect.objectContaining({ source: 'zod', file: 'src/index.ts', line: 1 }),
      ]),
    })
  } finally {
    await harness.shutdown()
  }
})

test('should match cached code structure given a native codemode call', async () => {
  //given
  const harness = await createOpensrcNativeHarness()
  const inventory = (await harness.invoke('opensrc_list', {})) as { structuredContent: { name: string }[] }
  const sourceName = inventory.structuredContent[0]?.name

  try {
    //when
    const result = await harness.invoke('opensrc_ast_grep', {
      sourceName,
      pattern: 'parse()',
      options: { lang: 'typescript' },
    })

    //then
    expect(result).toMatchObject({
      structuredContent: expect.arrayContaining([
        expect.objectContaining({ source: 'zod', file: 'src/index.ts', line: 2 }),
      ]),
    })
  } finally {
    await harness.shutdown()
  }
})

test('should read one cached file given a native codemode call', async () => {
  //given
  const harness = await createOpensrcNativeHarness()
  const inventory = (await harness.invoke('opensrc_list', {})) as { structuredContent: { name: string }[] }
  const sourceName = inventory.structuredContent[0]?.name

  try {
    //when
    const result = await harness.invoke('opensrc_read', { sourceName, filePath: 'README.md' })

    //then
    expect(result).toMatchObject({ structuredContent: readme })
  } finally {
    await harness.shutdown()
  }
})

test('should read several cached files in one call given native codemode', async () => {
  //given
  const harness = await createOpensrcNativeHarness()
  const inventory = (await harness.invoke('opensrc_list', {})) as { structuredContent: { name: string }[] }
  const sourceName = inventory.structuredContent[0]?.name

  try {
    //when
    const result = await harness.invoke('opensrc_read_many', {
      sourceName,
      paths: ['README.md', 'src/*.ts'],
    })

    //then
    expect(result).toMatchObject({ structuredContent: { 'README.md': readme, 'src/index.ts': sourceFile } })
  } finally {
    await harness.shutdown()
  }
})

test('should interrupt file reads and AST searches given a cancelled native tool call', async () => {
  //given
  const harness = await createOpensrcNativeHarness()
  const inventory = (await harness.invoke('opensrc_list', {})) as { structuredContent: { name: string }[] }
  const sourceName = inventory.structuredContent[0]?.name
  const controller = new AbortController()
  controller.abort()

  try {
    //when
    const outcomes = await Promise.allSettled([
      harness.invoke('opensrc_read', { sourceName, filePath: 'README.md' }, controller.signal),
      harness.invoke(
        'opensrc_ast_grep',
        { sourceName, pattern: 'parse()', options: { lang: 'typescript' } },
        controller.signal,
      ),
    ])

    //then
    expect(outcomes.map(({ status }) => status)).toEqual(['rejected', 'rejected'])
  } finally {
    await harness.shutdown()
  }
})

test('should fetch sources and report cache status given a native codemode call', async () => {
  //given
  const harness = await createOpensrcNativeHarness()

  try {
    //when
    const result = await harness.invoke('opensrc_fetch', { specs: 'zod' })

    //then
    expect(result).toMatchObject({ structuredContent: [{ source, alreadyExists: true }] })
    expect(harness.requests.map(([operation]) => operation)).toContain('fetch')
  } finally {
    await harness.shutdown()
  }
})

test('isolates private GitHub tokens in a mixed native fetch', async () => {
  const token = 'gho-mixed-test-token'
  const privateSource: Source = {
    type: 'repo',
    name: 'github.com/acme/private',
    version: 'main',
    path: 'repos/acme/private',
    fetchedAt: '2026-01-02',
  }
  const publicSource: Source = {
    type: 'repo',
    name: 'github.com/acme/public',
    version: 'main',
    path: 'repos/acme/public',
    fetchedAt: '2026-01-02',
  }
  const lockedSource: Source = {
    type: 'repo',
    name: 'github.com/acme/locked',
    version: 'main',
    path: 'repos/acme/locked',
    fetchedAt: '2026-01-02',
  }
  const newPublicSource: Source = {
    type: 'repo',
    name: 'github.com/acme/new-public',
    version: 'main',
    path: 'repos/acme/new-public',
    fetchedAt: '2026-01-02',
  }
  const gitlabSource: Source = {
    type: 'repo',
    name: 'gitlab.com/team/project',
    version: 'main',
    path: 'repos/team/project',
    fetchedAt: '2026-01-02',
  }
  const sourcesBySpec = new Map<string, Source>([
    ['acme/private', privateSource],
    ['acme/public', publicSource],
    ['acme/locked', lockedSource],
    ['acme/new-public', newPublicSource],
    ['zod', source],
    ['gitlab:team/project', gitlabSource],
  ])
  const cachedSources: Source[] = [source]
  const requests: PiExecutionRequest[] = []
  const host: PiHostService = {
    exec: (request: PiExecutionRequest) => {
      requests.push(request)
      if (request.command === 'opensrc-test' && request.args[0] === '--version') {
        return Effect.succeed({ stdout: 'opensrc 0.7.3', stderr: '', code: 0, killed: false })
      }
      if (request.command === 'opensrc-test' && request.args[0] === 'list') {
        return Effect.succeed({
          stdout: JSON.stringify({
            packages: cachedSources.filter((cached) => cached.type !== 'repo'),
            repos: cachedSources.filter((cached) => cached.type === 'repo'),
          }),
          stderr: '',
          code: 0,
          killed: false,
        })
      }
      if (request.command === 'opensrc-test' && request.args[0] === 'fetch') {
        const cwdIndex = request.args.indexOf('--cwd')
        const specs = request.args.slice(1, cwdIndex)
        if (specs.length > 1) {
          return Effect.succeed({
            stdout: '',
            stderr: 'Repository not found on GitHub. If this is a private repo, set GITHUB_TOKEN.',
            code: 1,
            killed: false,
          })
        }
        const spec = specs[0]
        if ((spec === 'acme/private' || spec === 'acme/locked') && request.environment.GITHUB_TOKEN !== token) {
          return Effect.succeed({
            stdout: '',
            stderr: 'Repository not found on GitHub. If this is a private repo, set GITHUB_TOKEN.',
            code: 1,
            killed: false,
          })
        }
        if (request.environment.GITHUB_TOKEN !== undefined && spec !== 'acme/private') {
          return Effect.succeed({ stdout: '', stderr: 'token reached an unrelated source', code: 1, killed: false })
        }
        const fetched = spec === undefined ? undefined : sourcesBySpec.get(spec)
        if (fetched === undefined) {
          return Effect.succeed({ stdout: '', stderr: 'unknown source spec', code: 2, killed: false })
        }
        if (!cachedSources.some((cached) => cached.name === fetched.name)) cachedSources.push(fetched)
        return Effect.succeed({ stdout: '', stderr: '', code: 0, killed: false })
      }
      if (request.command === 'gh' && request.args[0] === 'repo') {
        if (request.args[2] === 'acme/locked') {
          return Effect.succeed({ stdout: '', stderr: 'repository access denied', code: 1, killed: false })
        }
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
  const harness = await createOpensrcNativeHarness(host)

  try {
    const result = (await harness.invoke('opensrc_fetch', {
      specs: ['acme/private', 'acme/public', 'zod', 'gitlab:team/project'],
    })) as { structuredContent: { source: Source; alreadyExists: boolean }[] }

    expect(result.structuredContent.map(({ source: fetched }) => fetched.name)).toEqual([
      'github.com/acme/private',
      'github.com/acme/public',
      'zod',
      'gitlab.com/team/project',
    ])
    expect(result.structuredContent.map(({ alreadyExists }) => alreadyExists)).toEqual([false, false, true, false])

    const fetches = requests.filter((request) => request.command === 'opensrc-test' && request.args[0] === 'fetch')
    expect(fetches.map((request) => request.args.slice(1, request.args.indexOf('--cwd')))).toEqual([
      ['acme/private', 'acme/public', 'zod', 'gitlab:team/project'],
      ['acme/private'],
      ['acme/private'],
      ['acme/public'],
      ['zod'],
      ['gitlab:team/project'],
    ])
    expect(
      fetches.filter((request) => request.environment.GITHUB_TOKEN !== undefined).map((request) => request.args[1]),
    ).toEqual(['acme/private'])
    expect(requests.flatMap((request) => request.args)).not.toContain(token)
    const ghRequests = requests.filter((request) => request.command === 'gh')
    expect(ghRequests.map((request) => request.args.slice(0, 2))).toEqual([
      ['repo', 'view'],
      ['auth', 'status'],
      ['auth', 'token'],
    ])
    expect(
      ghRequests.every(
        (request) => request.environment.GH_TOKEN === undefined && request.environment.GITHUB_TOKEN === undefined,
      ),
    ).toBe(true)

    await expect(harness.invoke('opensrc_fetch', { specs: ['acme/locked', 'acme/new-public'] })).rejects.toThrow(
      'GitHub CLI could not confirm repository visibility',
    )
    const listed = (await harness.invoke('opensrc_list', {})) as { structuredContent: Source[] }
    expect(listed.structuredContent.map(({ name }) => name)).toContain(newPublicSource.name)
    expect(
      requests.filter(
        (request) => request.command === 'gh' && request.args[0] === 'auth' && request.args[1] === 'token',
      ),
    ).toHaveLength(1)
  } finally {
    await harness.shutdown()
  }
})

test('should complete a private fetch given an interactive refreshable GitHub login', async () => {
  const requests: PiExecutionRequest[] = []
  const prompts: string[] = []
  const privateSource: Source = {
    type: 'repo',
    name: 'github.com/acme/private',
    version: 'main',
    path: 'repos/acme/private',
    fetchedAt: '2026-01-02',
  }
  let loggedIn = false
  let fetched = false
  let completeLogin: (() => void) | undefined
  let loginCancelled = false
  let browserOpenedBeforeCodePrompt = false
  const host: PiHostService = {
    exec: (request: PiExecutionRequest) => {
      requests.push(request)
      if (request.detached)
        return Effect.fail(createOpensrcFailure({ _tag: 'cli', operation: 'browser', message: 'browser unavailable' }))
      if (request.command === 'opensrc-test' && request.args[0] === '--version')
        return Effect.succeed({ stdout: 'opensrc 0.7.3', stderr: '', code: 0, killed: false })
      if (request.command === 'opensrc-test' && request.args[0] === 'list')
        return Effect.succeed({
          stdout: JSON.stringify({ packages: [source], repos: fetched ? [privateSource] : [] }),
          stderr: '',
          code: 0,
          killed: false,
        })
      if (request.command === 'opensrc-test' && request.args[0] === 'fetch') {
        if (request.environment.GITHUB_TOKEN === 'short-lived-token') {
          fetched = true
          return Effect.succeed({ stdout: '', stderr: '', code: 0, killed: false })
        }
        return Effect.succeed({
          stdout: '',
          stderr: 'Repository not found on GitHub. If this is a private repo, set GITHUB_TOKEN.',
          code: 1,
          killed: false,
        })
      }
      if (request.command === 'gh' && request.args[0] === 'repo')
        return Effect.succeed({ stdout: 'true', stderr: '', code: 0, killed: false })
      if (request.command === 'gh' && request.args[1] === 'status')
        return Effect.succeed({
          stdout: JSON.stringify({
            hosts: { 'github.com': [{ active: true, state: 'success', refreshable: loggedIn }] },
          }),
          stderr: '',
          code: 0,
          killed: false,
        })
      if (request.command === 'gh' && request.args[1] === 'login')
        return Effect.callback((resume) => {
          completeLogin = () => {
            loggedIn = true
            resume(Effect.succeed({ stdout: '', stderr: '', code: 0, killed: false }))
          }
          queueMicrotask(() => request.onStderr?.('First copy your one-time code: ABCD-1234\n'))
          return Effect.sync(() => {
            loginCancelled = true
          })
        })
      if (request.command === 'gh' && request.args[1] === 'token')
        return Effect.succeed({ stdout: 'short-lived-token', stderr: '', code: 0, killed: false })
      return Effect.succeed({ stdout: '', stderr: 'unexpected command', code: 99, killed: false })
    },
  }
  const harness = await createOpensrcNativeHarness(host)
  const context = createFakeExtensionContext()
  context.ui.confirm = async (title: string, message: string): Promise<boolean> => {
    prompts.push(`${title}: ${message}`)
    if (prompts.length === 2) {
      browserOpenedBeforeCodePrompt = requests.some((request) => request.detached === true)
      completeLogin?.()
    }
    return true
  }

  try {
    const result = await harness.fake.invokeTool(
      'opensrc_fetch',
      'login-test',
      { specs: 'acme/private' },
      {
        ...context,
        tools: [],
        executeTool: async () => {
          throw new Error('unexpected nested tool')
        },
      },
    )

    expect(result).toMatchObject({ structuredContent: [{ source: { name: privateSource.name } }] })
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('ABCD-1234')
    expect(browserOpenedBeforeCodePrompt).toBe(true)
    expect(requests).toContainEqual(
      expect.objectContaining({
        command: process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open',
        args:
          process.platform === 'win32'
            ? ['url.dll,FileProtocolHandler', 'https://github.com/login/device']
            : ['https://github.com/login/device'],
        detached: true,
      }),
    )
    expect(JSON.stringify(result)).not.toContain('ABCD-1234')
    expect(requests.filter((request) => request.command === 'gh').map((request) => request.args.slice(0, 2))).toEqual([
      ['repo', 'view'],
      ['auth', 'status'],
      ['auth', 'login'],
      ['auth', 'status'],
      ['repo', 'view'],
      ['auth', 'token'],
    ])

    loggedIn = false
    fetched = false
    context.ui.confirm = async (): Promise<boolean> => false
    await expect(
      harness.fake.invokeTool(
        'opensrc_fetch',
        'login-declined-test',
        { specs: 'acme/private' },
        {
          ...context,
          tools: [],
          executeTool: async () => {
            throw new Error('unexpected nested tool')
          },
        },
      ),
    ).rejects.toThrow('cancelled')
    expect(requests.filter((request) => request.args[0] === 'auth' && request.args[1] === 'login')).toHaveLength(1)
    expect(requests.find((request) => request.args[1] === 'login')?.args).toContain('--clipboard=false')

    loginCancelled = false
    let confirmationCount = 0
    context.ui.confirm = async (): Promise<boolean> => {
      confirmationCount += 1
      return confirmationCount === 1
    }
    await expect(
      harness.fake.invokeTool(
        'opensrc_fetch',
        'login-code-declined-test',
        { specs: 'acme/private' },
        {
          ...context,
          tools: [],
          executeTool: async () => {
            throw new Error('unexpected nested tool')
          },
        },
      ),
    ).rejects.toThrow('cancelled')
    expect(loginCancelled).toBe(true)
  } finally {
    await harness.shutdown()
  }
})

test('should read a fetched source given a native codemode call', async () => {
  //given
  const harness = await createOpensrcNativeHarness()

  try {
    //when
    const fetched = (await harness.invoke('opensrc_fetch', { specs: 'left-pad' })) as {
      structuredContent: { source: { name: string }; alreadyExists: boolean }[]
    }
    const sourceName = fetched.structuredContent[0]?.source.name
    const result = await harness.invoke('opensrc_read', { sourceName, filePath: 'README.md' })

    //then
    expect(fetched).toMatchObject({ structuredContent: [{ source: { name: 'left-pad' }, alreadyExists: false }] })
    expect(result).toMatchObject({ structuredContent: 'Fetched left-pad' })
  } finally {
    await harness.shutdown()
  }
})

test('should remove named sources given a native codemode call', async () => {
  //given
  const harness = await createOpensrcNativeHarness()
  const inventory = (await harness.invoke('opensrc_list', {})) as { structuredContent: { name: string }[] }
  const sourceName = inventory.structuredContent[0]?.name

  try {
    //when
    const result = await harness.invoke('opensrc_remove', { names: [sourceName] })

    //then
    expect(result).toMatchObject({ structuredContent: { success: true, removed: ['zod'] } })
  } finally {
    await harness.shutdown()
  }
})

test('should clean selected cache groups given a native codemode call', async () => {
  //given
  const harness = await createOpensrcNativeHarness()

  try {
    //when
    const result = await harness.invoke('opensrc_clean', { options: { packages: true } })

    //then
    expect(result).toMatchObject({ structuredContent: { success: true, removed: ['zod'] } })
    expect(harness.requests.map(([operation]) => operation)).toContain('clean')
  } finally {
    await harness.shutdown()
  }
})

test('should return a typed CLI failure given a failed native fetch', async () => {
  //given
  const harness = await createOpensrcNativeHarness()
  harness.failOn('fetch')

  try {
    //when
    const result = harness.invoke('opensrc_fetch', { specs: 'zod' })

    //then
    await expect(result).rejects.toThrow('fetch denied')
  } finally {
    await harness.shutdown()
  }
})

test('should stop a running fetch given native tool cancellation', async () => {
  //given
  const harness = await createOpensrcNativeHarness()
  const controller = new AbortController()

  try {
    //when
    const fetch = harness.invoke('opensrc_fetch', { specs: 'slow-source' }, controller.signal)
    await harness.fetchStarted
    controller.abort()
    const outcome = await Promise.allSettled([fetch])

    //then
    expect(outcome.map(({ status }) => status)).toEqual(['rejected'])
    expect(harness.fetchWasCancelled()).toBe(true)
  } finally {
    await harness.shutdown()
  }
})

test('should serialize native fetch mutations given concurrent tool calls', async () => {
  //given
  const harness = await createOpensrcNativeHarness()

  try {
    //when
    await Promise.all([
      harness.invoke('opensrc_fetch', { specs: 'zod' }),
      harness.invoke('opensrc_fetch', { specs: ['zod'] }),
    ])

    //then
    expect(harness.maxConcurrentFetches()).toBe(1)
  } finally {
    await harness.shutdown()
  }
})
