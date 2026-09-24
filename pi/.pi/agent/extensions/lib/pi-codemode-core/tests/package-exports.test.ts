import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { CodeModeEffectHost, createCodeModeCore } from '@eratio/pi-codemode-core'
import { serializeCodeModeOutput } from '@eratio/pi-codemode-core/output'
import { Effect, Layer, ManagedRuntime } from 'effect'

describe('package exports', () => {
  test('loads the root and output entry points', () => {
    expect(typeof CodeModeEffectHost).toBe('function')
    expect(typeof createCodeModeCore).toBe('function')
    expect(typeof serializeCodeModeOutput).toBe('function')
  })

  test('bundles declaration entry points', () => {
    //given
    const distUrl = new URL('../dist/', import.meta.url)

    //when
    const emittedFiles = readdirSync(distUrl)

    //then
    expect(emittedFiles).toContain('index.d.ts')
    expect(emittedFiles).toContain('output.d.ts')
  })

  test('runs a worker from the bundled root entry point', async () => {
    //given
    const definition = {
      apiName: 'WorkerApi',
      programName: 'Bundled worker test',
      declarations: 'type WorkerApi = { value(): Promise<string> }',
      methods: [{ name: 'value', kind: 'async' }],
      examples: [],
    } as const
    const host = {
      invoke: (_method: string, _args: readonly unknown[]) => Effect.succeed('bundled'),
    }
    const core = createCodeModeCore<never, never>()
    const runtime = ManagedRuntime.make(Layer.succeed(CodeModeEffectHost<never, never>(), host))
    const evaluation = core.evaluate(definition, 'export default async (api: WorkerApi) => api.value()', {
      cwd: process.cwd(),
      filenamePrefix: 'bundle-test',
      timeoutMs: 30_000,
    })
    let result: unknown
    try {
      //when
      result = await runtime.runPromise(evaluation)
    } finally {
      await runtime.dispose()
    }

    //then
    expect(result).toBe('bundled')
  })
})
