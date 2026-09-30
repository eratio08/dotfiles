import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecResult } from '@earendil-works/pi-coding-agent'
import { PiExtension } from '@eratio/pi-effect'
import { createFakeExtensionApi, type FakeExtension } from '@eratio/pi-effect/testing'
import { createOpensrcNativePlugin } from '../index.ts'
import type { OpensrcConfig } from '../src/extension.ts'

const source = {
  type: 'npm' as const,
  name: 'zod',
  version: '3.0.0',
  path: 'packages/zod',
  fetchedAt: '2026-01-01',
}
const readme = '# Zod\nA schema parser.'
const sourceFile = 'export const parse = () => 1\nparse()\n'

async function createOpensrcNativeHarness(): Promise<{
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
  await PiExtension.install(createOpensrcNativePlugin(config))(fake.api)
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
