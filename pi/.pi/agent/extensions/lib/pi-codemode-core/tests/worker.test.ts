import { describe, expect, test } from 'bun:test'
import { Worker } from 'node:worker_threads'
import { Effect } from 'effect'
import * as Core from '../src/index.ts'

const definition: Core.ProgramDefinition = {
  apiName: 'ExampleApi',
  programName: 'ExampleProgram',
  declarations: 'type ExampleApi = { add(value: number): number; wait(value: string): Promise<string> }',
  methods: [
    { name: 'add', kind: 'sync' },
    { name: 'wait', kind: 'async' },
  ],
  examples: [],
}

const options: Core.ProgramRunOptions = {
  cwd: '/tmp',
  filenamePrefix: 'worker',
  timeoutMs: 1000,
}

const evaluateWithHost = <R, E>(
  core: Core.ProgramRunner<R, E>,
  host: Core.ProgramOperationInvoker<R, E>,
  code: string,
  runOptions: Core.ProgramRunOptions,
): Effect.Effect<unknown, Core.ProgramFailure | E, R> =>
  Effect.provideService(core.evaluate(definition, code, runOptions), Core.ProgramOperationInvoker<R, E>(), host)

describe('code mode worker', () => {
  test('should evaluate synchronous and asynchronous host calls given a worker program', async () => {
    //given
    const core = Core.createProgramRunner<never, never>()
    const host: Core.ProgramOperationInvoker<never, never> = {
      invoke: (method: string, args: readonly unknown[]) =>
        Effect.succeed(method === 'wait' ? String(args[0]).length : undefined),
      invokeSync: (method: string, args: readonly unknown[]) => (method === 'add' ? Number(args[0]) + 1 : undefined),
    }

    //when
    const result = await Effect.runPromise(
      evaluateWithHost(core, host, 'export default async (api: ExampleApi) => api.add(await api.wait("ok"))', options),
    )

    //then
    expect(result).toBe(3)
  })

  test('should fail a synchronous host call given no host sync method', async () => {
    //given
    const core = Core.createProgramRunner<never, never>()
    const host: Core.ProgramOperationInvoker<never, never> = {
      invoke: () => Effect.succeed(undefined),
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(core, host, 'export default (api: ExampleApi) => api.add(1)', options),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'invoke', operation: 'add' })
  })

  test('should preserve the result given worker termination fails after evaluation', async () => {
    //given
    const core = Core.createProgramRunner<never, never>()
    const host: Core.ProgramOperationInvoker<never, never> = {
      invoke: () => Effect.succeed(undefined),
      invokeSync: () => undefined,
    }
    const terminate = Worker.prototype.terminate
    Worker.prototype.terminate = function (this: Worker): Promise<number> {
      return terminate.call(this).then(() => Promise.reject(new Error('termination failed')))
    }

    let result: unknown
    try {
      //when
      result = await Effect.runPromise(evaluateWithHost(core, host, 'export default () => 3', options))
    } finally {
      Worker.prototype.terminate = terminate
    }

    //then
    expect(result).toBe(3)
  })

  test('should stop execution given a loop starts after an awaited host call', async () => {
    //given
    const core = Core.createProgramRunner<never, never>()
    const host: Core.ProgramOperationInvoker<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => undefined,
    }
    const runOptions = { ...options, timeoutMs: 100 }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(
        core,
        host,
        'export default async (api: ExampleApi) => { await api.wait("ok"); while (true) {} }',
        runOptions,
      ),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'timeout' })
  })
})
