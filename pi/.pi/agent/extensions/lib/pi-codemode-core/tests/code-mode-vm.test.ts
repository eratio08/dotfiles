import { describe, expect, test } from 'bun:test'
import {
  createCodeModeApi,
  createCodeModeFilename,
  createCodeModeJiti,
  runCodeModeVm,
  transformCodeModeProgram,
} from '../src/code-mode-vm.ts'

const definition = {
  apiName: 'ExampleApi',
  programName: 'ExampleProgram',
  declarations: 'type ExampleApi = { add(value: number): number; wait(value: string): Promise<string> }',
  methods: [
    { name: 'add', kind: 'sync' as const },
    { name: 'wait', kind: 'async' as const },
  ],
  examples: [],
}

describe('code mode VM', () => {
  test('loads declarations and invokes a synchronous default program', async () => {
    //given
    const jiti = createCodeModeJiti()
    const filename = createCodeModeFilename('/tmp', 'example', 1)
    const transformed = transformCodeModeProgram(
      jiti,
      definition,
      'export default (api: ExampleApi) => api.add(2)',
      filename,
    )
    const api = createCodeModeApi(
      definition.methods,
      (method, args) => (method === 'add' ? Number(args[0]) + 3 : undefined),
      async (_method, args) => String(args[0]),
    )

    //when
    const result = await runCodeModeVm(transformed, api, filename, 1000)

    //then
    expect(result).toBe(5)
  })

  test('awaits asynchronous API methods', async () => {
    //given
    const jiti = createCodeModeJiti()
    const filename = createCodeModeFilename('/tmp', 'example', 2)
    const source = ['export default async (api: ExampleApi) => `', '$', '{await api.wait("done")}:ok`'].join('')
    const transformed = transformCodeModeProgram(jiti, definition, source, filename)
    const api = createCodeModeApi(
      definition.methods,
      () => undefined,
      async (_method, args) => String(args[0]),
    )

    //when
    const result = await runCodeModeVm(transformed, api, filename, 1000)

    //then
    expect(result).toBe('done:ok')
  })

  test('rejects a Promise from a synchronous method', async () => {
    //given
    const jiti = createCodeModeJiti()
    const filename = createCodeModeFilename('/tmp', 'example', 3)
    const transformed = transformCodeModeProgram(
      jiti,
      definition,
      'export default (api: ExampleApi) => api.add(2)',
      filename,
    )
    const api = createCodeModeApi(
      definition.methods,
      () => Promise.resolve(2),
      async (_method, args) => String(args[0]),
    )

    //when
    const result = runCodeModeVm(transformed, api, filename, 1000)

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'transport', operation: 'add' })
  })

  test('rejects a missing default export', async () => {
    //given
    const jiti = createCodeModeJiti()
    const filename = createCodeModeFilename('/tmp', 'example', 4)
    const transformed = transformCodeModeProgram(jiti, definition, 'export const value = 1', filename)
    const api = createCodeModeApi(
      definition.methods,
      () => 1,
      async () => 'ok',
    )

    //when
    const result = runCodeModeVm(transformed, api, filename, 1000)

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'validation', operation: 'default-export' })
  })

  test('does not expose host globals or undeclared methods', async () => {
    //given
    const jiti = createCodeModeJiti()
    const filename = createCodeModeFilename('/tmp', 'example', 5)
    const transformed = transformCodeModeProgram(
      jiti,
      definition,
      'export default (api: ExampleApi) => [process, require, api.missing]',
      filename,
    )
    const api = createCodeModeApi(
      definition.methods,
      () => 1,
      async () => 'ok',
    )

    //when
    const result = runCodeModeVm(transformed, api, filename, 1000)

    //then
    await expect(result).resolves.toEqual([undefined, undefined, undefined])
  })

  test('rejects static and dynamic imports', async () => {
    //given
    const jiti = createCodeModeJiti()
    const api = createCodeModeApi(
      definition.methods,
      () => 1,
      async () => 'ok',
    )
    const staticFilename = createCodeModeFilename('/tmp', 'static-import', 6)
    const dynamicFilename = createCodeModeFilename('/tmp', 'dynamic-import', 7)
    const staticCode = transformCodeModeProgram(
      jiti,
      definition,
      'import fs from "node:fs"; export default () => fs.readFileSync',
      staticFilename,
    )
    const dynamicCode = transformCodeModeProgram(
      jiti,
      definition,
      'export default async () => await import("node:fs")',
      dynamicFilename,
    )

    //when
    const staticResult = runCodeModeVm(staticCode, api, staticFilename, 1000)
    const dynamicResult = runCodeModeVm(dynamicCode, api, dynamicFilename, 1000)

    //then
    await expect(staticResult).rejects.toMatchObject({ _tag: 'compile' })
    await expect(dynamicResult).rejects.toMatchObject({ _tag: 'invoke' })
  })
})
