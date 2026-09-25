import { describe, expect, test } from 'bun:test'
import { Worker } from 'node:worker_threads'
import { Effect } from 'effect'
import { ProgramHost } from '../src/contract.ts'
import { CodeModeRequestQueueService, createCodeModeRequestQueue } from '../src/request-queue.ts'
import { createCodeModeFilename, createCodeModeJiti, transformCodeModeProgram } from '../src/vm.ts'
import { runCodeModeWorkerEvaluation } from '../src/worker-runner.ts'

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
    const host: ProgramHost<never, never> = {
      invoke: (method, args) => Effect.succeed(method === 'wait' ? String(args[0]).length : undefined),
      invokeSync: (method, args) => (method === 'add' ? Number(args[0]) + 1 : undefined),
    }
    const signal = new AbortController().signal

    //when
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* Effect.provideService(
            createCodeModeRequestQueue<never, never>(),
            ProgramHost<never, never>(),
            host,
          )
          return yield* runCodeModeWorkerEvaluation<never, never>(
            definition,
            code,
            filename,
            1000,
            () => 1000,
            signal,
          ).pipe(
            Effect.provideService(CodeModeRequestQueueService, queue),
            Effect.provideService(ProgramHost<never, never>(), host),
          )
        }),
      ),
    )

    //then
    expect(result).toBe(3)
  })

  test('fails a worker sync call when the host has no sync method', async () => {
    //given
    const jiti = createCodeModeJiti()
    const filename = createCodeModeFilename('/tmp', 'worker-missing-sync', 1)
    const code = transformCodeModeProgram(jiti, definition, 'export default (api: ExampleApi) => api.add(1)', filename)
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed(undefined),
    }
    const signal = new AbortController().signal

    //when
    const result = Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* Effect.provideService(
            createCodeModeRequestQueue<never, never>(),
            ProgramHost<never, never>(),
            host,
          )
          return yield* runCodeModeWorkerEvaluation<never, never>(
            definition,
            code,
            filename,
            1000,
            () => 1000,
            signal,
          ).pipe(
            Effect.provideService(CodeModeRequestQueueService, queue),
            Effect.provideService(ProgramHost<never, never>(), host),
          )
        }),
      ),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'invoke', operation: 'add' })
  })

  test('ignores worker termination failures after a successful evaluation', async () => {
    //given
    const jiti = createCodeModeJiti()
    const filename = createCodeModeFilename('/tmp', 'worker-termination', 1)
    const code = transformCodeModeProgram(jiti, definition, 'export default () => 3', filename)
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed(undefined),
      invokeSync: () => undefined,
    }
    const signal = new AbortController().signal
    const terminate = Worker.prototype.terminate
    Worker.prototype.terminate = function (this: Worker): Promise<number> {
      return terminate.call(this).then(() => Promise.reject(new Error('termination failed')))
    }

    let result: unknown
    try {
      //when
      result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const queue = yield* Effect.provideService(
              createCodeModeRequestQueue<never, never>(),
              ProgramHost<never, never>(),
              host,
            )
            return yield* runCodeModeWorkerEvaluation<never, never>(
              definition,
              code,
              filename,
              1000,
              () => 1000,
              signal,
            ).pipe(
              Effect.provideService(CodeModeRequestQueueService, queue),
              Effect.provideService(ProgramHost<never, never>(), host),
            )
          }),
        ),
      )
    } finally {
      Worker.prototype.terminate = terminate
    }

    //then
    expect(result).toBe(3)
  })

  test('stops a loop that starts after an awaited host call', async () => {
    //given
    const jiti = createCodeModeJiti()
    const filename = createCodeModeFilename('/tmp', 'worker-loop', 1)
    const source = ['export default async (api: ExampleApi) => { await api.wait("ok"); while (true) {} }'].join('')
    const code = transformCodeModeProgram(jiti, definition, source, filename)
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => undefined,
    }
    const signal = new AbortController().signal

    //when
    const result = Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* Effect.provideService(
            createCodeModeRequestQueue<never, never>(),
            ProgramHost<never, never>(),
            host,
          )
          return yield* runCodeModeWorkerEvaluation<never, never>(
            definition,
            code,
            filename,
            1000,
            () => 100,
            signal,
          ).pipe(
            Effect.provideService(CodeModeRequestQueueService, queue),
            Effect.provideService(ProgramHost<never, never>(), host),
          )
        }),
      ),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'timeout' })
  })
})
