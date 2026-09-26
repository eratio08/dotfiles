import { describe, expect, test } from 'bun:test'
import { createFakeExtensionApi } from '@eratio/pi-effect/testing'
import opensrcExtension from '../index.ts'
import { createOpensrcFailure, OpensrcFailure } from '../src/core/model.ts'
import { opensrcErrorCodec } from '../src/effects/code-mode.ts'

async function createOpenSrcHarness(): Promise<{
  extension: ReturnType<typeof createFakeExtensionApi>
  requests: string[][]
  invoke: (code: string, signal?: AbortSignal) => Promise<unknown>
}> {
  const extension = createFakeExtensionApi()
  const requests: string[][] = []
  extension.api.exec = async (
    _command: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string; code: number; killed: false }> => {
    requests.push([...args])
    return {
      stdout: args[0] === '--version' ? 'opensrc 0.7.3' : '{"packages":[],"repos":[]}',
      stderr: '',
      code: 0,
      killed: false,
    }
  }
  await opensrcExtension(extension.api as never)
  return {
    extension,
    requests,
    invoke: (code: string, signal?: AbortSignal): Promise<unknown> => {
      const previousHome = process.env.OPENSRC_HOME
      delete process.env.OPENSRC_HOME
      return extension.invokeTool('opensrc', 'opensrc-test-call', { code }, undefined, signal).finally(() => {
        if (previousHome === undefined) delete process.env.OPENSRC_HOME
        else process.env.OPENSRC_HOME = previousHome
      })
    },
  }
}

describe('opensrc code mode', () => {
  test('should register a sequential SDK tool with OpenSrc guidance given code-mode setup', async () => {
    //given
    const { extension } = await createOpenSrcHarness()

    //when
    const tool = extension.tools.get('opensrc')

    //then
    expect(tool?.name).toBe('opensrc')
    expect(tool?.description).toContain('Use `source.name` after `fetch`.')
    expect(tool?.executionMode).toBe('sequential')
    expect(tool?.promptSnippet).toContain('opensrc API')
    expect(tool?.promptGuidelines).toContain('Call api.help() to list available operations.')
    expect(tool?.parameters).toBeDefined()
  })

  test('should return method results with operation counts given method calls', async () => {
    //given
    const { invoke, requests } = await createOpenSrcHarness()
    const code = `export default async (api: opensrcApi) => ({
  present: await api.has({ name: 'zod' }),
  missing: await api.has({ name: 'other' }),
})`

    //when
    const result = await invoke(code)

    //then
    const toolResult = result as {
      content: readonly { type: string; text: string }[]
      details: { truncated: boolean; operations: Readonly<Record<string, number>> }
    }
    expect(JSON.parse(toolResult.content[0].text)).toEqual({ present: false, missing: false })
    expect(toolResult.details).toMatchObject({ truncated: false, operations: { has: 2 } })
    expect(requests).toEqual([['--version'], ['list', '--json']])
  })

  test('should provide generated help for OpenSrc methods and domain types given the API schema', async () => {
    //given
    const { invoke } = await createOpenSrcHarness()

    //when
    const result = await invoke(
      'export default (api: opensrcApi) => ({ overview: api.help(), read: api.help("read") })',
    )

    //then
    const content = (result as { content: readonly { text: string }[] }).content
    const help = JSON.parse(content[0].text) as { overview: string; read: string }
    expect(help.overview).toContain('Batch dependent calls in one program.')
    expect(help.overview).toContain('`fetch` then `read` directly')
    expect(help.overview).toContain('`resolve` or `files` only to discover an unknown spec or path')
    expect(help.overview).toContain('`api.help("<operation>")` when you need a signature and parameter schema')
    for (const method of [
      'list',
      'has',
      'get',
      'files',
      'tree',
      'grep',
      'astGrep',
      'read',
      'readMany',
      'resolve',
      'fetch',
      'remove',
      'clean',
    ]) {
      expect(help.overview).toContain(`- \`${method}\`:`)
    }
    expect(help.read).toContain('read(params: { sourceName: string; filePath: string }): Promise<string>')
    expect(help.read).toContain('Read one file from a cached source.')
    expect(help.read).toContain('type Source =')
    expect(help.read).toContain('type OpensrcHostError =')
  })

  test('should reject invalid method parameters before execution given invalid input', async () => {
    //given
    const { invoke } = await createOpenSrcHarness()

    //when
    const invocation = invoke("export default async (api: opensrcApi) => api.read({ sourceName: 'zod', filePath: '' })")

    //then
    await expect(invocation).rejects.toThrow()
  })

  test('should preserve nested failure causes given worker error encoding', () => {
    //given
    const cause: { path: string; failure: Error; circular?: unknown } = {
      path: '/tmp/cache/source/file.ts',
      failure: new Error('permission denied'),
    }
    cause.circular = cause
    const failure = createOpensrcFailure({
      _tag: 'filesystem',
      operation: 'read',
      message: 'Unable to read source files',
      cause,
    })
    const encoded = opensrcErrorCodec.encode(failure)

    //when
    const decoded = opensrcErrorCodec.decode(encoded)

    //then
    const encodedRecord = encoded as {
      readonly kind: string
      readonly cause: {
        readonly path: string
        readonly failure: { readonly name: string; readonly message: string; readonly stack: string }
        readonly circular: string
      }
    }
    expect(decoded).toBeInstanceOf(OpensrcFailure)
    expect(encodedRecord.kind).toBe('opensrc')
    expect(encodedRecord.cause.path).toBe('/tmp/cache/source/file.ts')
    expect(encodedRecord.cause.failure.name).toBe('Error')
    expect(encodedRecord.cause.failure.message).toBe('permission denied')
    expect(typeof encodedRecord.cause.failure.stack).toBe('string')
    expect(encodedRecord.cause.circular).toBe('[Circular]')
    expect(decoded.cause).toEqual(encodedRecord.cause)
  })

  test('should preserve typed OpenSrc failures given worker calls that fail', async () => {
    //given
    const { invoke } = await createOpenSrcHarness()
    const code = `export default async (api: opensrcApi) => {
  try {
    await api.read({ sourceName: 'missing', filePath: 'README.md' })
  } catch (error) {
    const failure = error as {
      type?: string
      value?: { _tag?: string; operation?: string; message?: string }
    }
    return {
      type: failure.type,
      tag: failure.value?._tag,
      operation: failure.value?.operation,
      message: failure.value?.message,
    }
  }
  return { tag: 'none' }
}`

    //when
    const result = await invoke(code)

    //then
    const content = (result as { content: readonly { text: string }[] }).content
    expect(JSON.parse(content[0].text)).toEqual({
      type: 'code-mode-host-error',
      tag: 'source-not-found',
      operation: 'source',
      message: 'Cached source not found: missing',
    })
  })

  test('should cancel a running OpenSrc program given an aborted signal', async () => {
    //given
    const { invoke } = await createOpenSrcHarness()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10)

    //when
    const invocation = invoke('export default async () => { while (true) {} }', controller.signal)

    //then
    await expect(invocation).rejects.toThrow()
    clearTimeout(timeout)
  })
})
