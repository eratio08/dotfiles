import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename } from 'node:path'
import * as Core from '@eratio/pi-codemode-core'
import * as Output from '@eratio/pi-codemode-core/output'
import { Effect, Layer, ManagedRuntime } from 'effect'

describe('package exports', () => {
  test('loads the root and output entry points', () => {
    expect(typeof Core.ProgramHost).toBe('function')
    expect(typeof Core.createProgramRunner).toBe('function')
    expect(typeof Core.createProgramFailure).toBe('function')
    expect(typeof Output.serializeOutput).toBe('function')
    expect(Object.keys(Core).filter((name) => name.includes('CodeMode'))).toEqual([])
    expect(Object.keys(Output).filter((name) => name.includes('CodeMode'))).toEqual([])
  })

  test('resolves the root and output entry points for CommonJS consumers', () => {
    //given
    const packageRequire = createRequire(import.meta.url)
    const entries = ['@eratio/pi-codemode-core', '@eratio/pi-codemode-core/output']

    //when
    const entryNames = entries.map((entry) => basename(packageRequire.resolve(entry)))

    //then
    expect(entryNames).toEqual(['index.js', 'output.js'])
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
    const core = Core.createProgramRunner<never, never>()
    const runtime = ManagedRuntime.make(Layer.succeed(Core.ProgramHost<never, never>(), host))
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
