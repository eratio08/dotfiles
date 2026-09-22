import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import type { CodeModeEffectHost } from '../src/code-mode-contract.ts'
import { createCodeModeRequestQueue } from '../src/code-mode-request-queue.ts'
import { createCodeModeFilename, createCodeModeJiti, transformCodeModeProgram } from '../src/code-mode-vm.ts'
import { runCodeModeWorkerEvaluation } from '../src/code-mode-worker-runner.ts'

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

describe('code mode worker', () => {
  test('evaluates sync and async host calls', async () => {
    //given
    const jiti = createCodeModeJiti()
    const filename = createCodeModeFilename('/tmp', 'worker', 1)
    const source = ['export default async (api: ExampleApi) => api.add(await api.wait("ok"))'].join('')
    const code = transformCodeModeProgram(jiti, definition, source, filename)
    const host: CodeModeEffectHost<never, never> = {
      invoke: (method, args) => Effect.succeed(method === 'wait' ? String(args[0]).length : undefined),
      invokeSync: (method, args) => (method === 'add' ? Number(args[0]) + 1 : undefined),
    }
    const signal = new AbortController().signal

    //when
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* createCodeModeRequestQueue(host)
          return yield* runCodeModeWorkerEvaluation(
            definition,
            code,
            filename,
            1000,
            Date.now(),
            signal,
            queue,
            (method, args) => host.invokeSync?.(method, args),
          )
        }),
      ),
    )

    //then
    expect(result).toBe(3)
  })

  test('stops a loop that starts after an awaited host call', async () => {
    //given
    const jiti = createCodeModeJiti()
    const filename = createCodeModeFilename('/tmp', 'worker-loop', 1)
    const source = ['export default async (api: ExampleApi) => { await api.wait("ok"); while (true) {} }'].join('')
    const code = transformCodeModeProgram(jiti, definition, source, filename)
    const host: CodeModeEffectHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => undefined,
    }
    const signal = new AbortController().signal

    //when
    const result = Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* createCodeModeRequestQueue(host)
          return yield* runCodeModeWorkerEvaluation(
            definition,
            code,
            filename,
            100,
            Date.now(),
            signal,
            queue,
            (method, args) => host.invokeSync?.(method, args),
          )
        }),
      ),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'timeout' })
  })
})
