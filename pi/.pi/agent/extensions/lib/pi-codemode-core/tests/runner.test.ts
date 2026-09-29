import { describe, expect, test } from 'bun:test'
import { Effect, Fiber } from 'effect'
import * as Core from '../src/index.ts'

const definition: Core.ProgramDefinition = {
  apiName: 'QueueApi',
  programName: 'QueueProgram',
  declarations: 'type QueueApi = { call(value: string): Promise<string> }',
  methods: [{ name: 'call', kind: 'async' }],
  examples: [],
}

const options: Core.ProgramRunOptions = {
  cwd: '/tmp',
  filenamePrefix: 'queue',
  timeoutMs: 1000,
}

const evaluateWithHost = <R, E>(
  core: Core.ProgramRunner<R, E>,
  host: Core.ProgramHost<R, E>,
  code: string,
  runOptions: Core.ProgramRunOptions,
): Effect.Effect<unknown, Core.ProgramFailure | E, R> =>
  Effect.provideService(core.evaluate(definition, code, runOptions), Core.ProgramHost<R, E>(), host)

describe('code mode runner', () => {
  test('should run host calls in offer order given concurrent API calls', async () => {
    //given
    const events: string[] = []
    const core = Core.createProgramRunner<never, never>()
    const host: Core.ProgramHost<never, never> = {
      invoke: (_method: string, args: readonly unknown[]) =>
        Effect.promise(async () => {
          const value = String(args[0])
          events.push(`${value}:start`)
          await Promise.resolve()
          events.push(`${value}:end`)
          return value
        }),
    }

    //when
    const result = await Effect.runPromise(
      evaluateWithHost(
        core,
        host,
        'export default async (api: QueueApi) => await Promise.all([api.call("first"), api.call("second")])',
        options,
      ),
    )

    //then
    expect(result).toEqual(['first', 'second'])
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  test('should process later requests given a host that throws before returning an Effect', async () => {
    //given
    const core = Core.createProgramRunner<never, never>()
    const host: Core.ProgramHost<never, never> = {
      invoke: (_method: string, args: readonly unknown[]) => {
        if (args[0] === 'throws') throw new Error('Host failed before returning an Effect.')
        return Effect.succeed(String(args[0]))
      },
    }

    //when
    const result = await Effect.runPromise(
      evaluateWithHost(
        core,
        host,
        'export default async (api: QueueApi) => { const first = api.call("throws").catch(() => "failed"); const second = api.call("next"); return await Promise.all([first, second]) }',
        options,
      ),
    )

    //then
    expect(result).toEqual(['failed', 'next'])
  })

  test('should interrupt the host Effect given the caller signal aborts', async () => {
    //given
    let interrupted = false
    let resolveStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const controller = new AbortController()
    const core = Core.createProgramRunner<never, never>()
    const host: Core.ProgramHost<never, never> = {
      invoke: () => {
        resolveStarted()
        return Effect.never.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              interrupted = true
            }),
          ),
        )
      },
    }
    const runAndAbort = async (): Promise<unknown> => {
      const evaluation = Effect.runPromise(
        evaluateWithHost(core, host, 'export default async (api: QueueApi) => api.call("slow")', {
          ...options,
          signal: controller.signal,
        }),
      )
      await started
      controller.abort()
      return await evaluation
    }

    //when
    const result = runAndAbort()

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'cancellation' })
    expect(interrupted).toBe(true)
  })

  test('should interrupt the host Effect given the evaluation fiber is interrupted', async () => {
    //given
    let interrupted = false
    let resolveStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const core = Core.createProgramRunner<never, never>()
    const host: Core.ProgramHost<never, never> = {
      invoke: () => {
        resolveStarted()
        return Effect.never.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              interrupted = true
            }),
          ),
        )
      },
    }
    const interruptAfterStart = async (): Promise<unknown> => {
      const fiber = Effect.runFork(
        evaluateWithHost(core, host, 'export default async (api: QueueApi) => api.call("slow")', options),
      )
      const joined = Fiber.join(fiber)
      await started
      await Effect.runPromise(Fiber.interrupt(fiber))
      return Effect.runPromise(joined)
    }

    //when
    const result = interruptAfterStart()

    //then
    await expect(result).rejects.toBeDefined()
    expect(interrupted).toBe(true)
  })
})
