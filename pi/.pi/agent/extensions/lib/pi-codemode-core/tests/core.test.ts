import { describe, expect, test } from 'bun:test'
import { Clock, Context, Effect, Fiber, Layer, ManagedRuntime, Schema } from 'effect'
import type {
  ProgramDefinition,
  ProgramFailure,
  ProgramHostErrorCodec,
  ProgramRunner,
  ProgramRunOptions,
  ProgramWireValue,
} from '../src/index.ts'
import { createProgramFailure, createProgramRunner, ProgramHost } from '../src/index.ts'

const definition: ProgramDefinition = {
  apiName: 'ExampleApi',
  programName: 'ExampleProgram',
  declarations: 'type ExampleApi = { add(value: number): number; wait(value: string): Promise<string> }',
  methods: [
    { name: 'add', kind: 'sync' },
    { name: 'wait', kind: 'async' },
  ],
  examples: [],
}

const options = {
  cwd: '/tmp',
  filenamePrefix: 'core',
  timeoutMs: 1000,
}

const evaluateWithHost = <R, E>(
  core: ProgramRunner<R, E>,
  definition: ProgramDefinition,
  host: ProgramHost<R, E>,
  code: string,
  runOptions: ProgramRunOptions,
): Effect.Effect<unknown, ProgramFailure | E, R> =>
  Effect.provideService(core.evaluate(definition, code, runOptions), ProgramHost<R, E>(), host)

const HostDependency = Context.Service<{ readonly value: string }>('code-mode-core/TestHostDependency')
type HostDependencyRequirement = Context.Service.Identifier<typeof HostDependency>

type HostFailure = {
  readonly code: string
  readonly message: string
}

type TaggedHostFailure = {
  readonly _tag: 'HostMissing'
  readonly operation: 'fetch'
  readonly message: string
  readonly code: number
}

const taggedHostFailureSchema = Schema.Struct({
  _tag: Schema.Literal('HostMissing'),
  operation: Schema.Literal('fetch'),
  message: Schema.String,
  code: Schema.Number,
})

const hostErrorCodec: ProgramHostErrorCodec<HostFailure> = {
  encode: (failure: HostFailure) => ({ code: failure.code, message: failure.message }),
  decode: (value: ProgramWireValue) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new TypeError('Invalid host failure.')
    const record = value as { readonly code?: ProgramWireValue; readonly message?: ProgramWireValue }
    if (typeof record.code !== 'string' || typeof record.message !== 'string')
      throw new TypeError('Invalid host failure.')
    return { code: record.code, message: record.message }
  },
}

describe('code mode core', () => {
  test('should run the program in a worker given an Effect host', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const host: ProgramHost<never, never> = {
      invoke: (method: string, args: readonly unknown[]) =>
        Effect.succeed(method === 'wait' ? String(args[0]).length : undefined),
      invokeSync: (method: string, args: readonly unknown[]) => (method === 'add' ? Number(args[0]) + 1 : undefined),
    }

    //when
    const result = await Effect.runPromise(
      evaluateWithHost(
        core,
        definition,
        host,
        'export default async (api: ExampleApi) => api.add(await api.wait("ok"))',
        options,
      ),
    )

    //then
    expect(result).toBe(3)
  })

  test('should use the supplied host given multiple evaluations', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const firstHost: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('unused'),
      invokeSync: () => 1,
    }
    const secondHost: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('unused'),
      invokeSync: () => 2,
    }
    const firstResult = await Effect.runPromise(
      evaluateWithHost(core, definition, firstHost, 'export default (api: ExampleApi) => api.add(0)', options),
    )

    //when
    const result = Effect.runPromise(
      evaluateWithHost(core, definition, secondHost, 'export default (api: ExampleApi) => api.add(0)', options),
    )

    //then
    expect(firstResult).toBe(1)
    await expect(result).resolves.toBe(2)
  })

  test('should preserve host Effect requirements given an Effect-based host', async () => {
    //given
    const core = createProgramRunner<HostDependencyRequirement, never>()
    const host: ProgramHost<HostDependencyRequirement, never> = {
      invoke: () => Effect.map(HostDependency, ({ value }) => value),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      Effect.provideService(
        evaluateWithHost(
          core,
          definition,
          host,
          'export default async (api: ExampleApi) => await api.wait("ok")',
          options,
        ),
        HostDependency,
        { value: 'provided' },
      ),
    )

    //then
    await expect(result).resolves.toBe('provided')
  })

  test('should return a validation failure given an invalid definition', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const invalidDefinition = { ...definition, methods: [] }
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(evaluateWithHost(core, invalidDefinition, host, 'export default () => 1', options))

    //then
    await expect(result).rejects.toEqual({
      _tag: 'validation',
      operation: 'definition',
      message: 'The code mode must declare at least one method.',
    })
  })

  test('should reuse a caller-owned runtime given multiple evaluations', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const runtime = ManagedRuntime.make(Layer.empty)
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: (_method: string, args: readonly unknown[]) => Number(args[0]) + 1,
    }
    const evaluation = Effect.all(
      [
        evaluateWithHost(core, definition, host, 'export default (api: ExampleApi) => api.add(1)', options),
        evaluateWithHost(core, definition, host, 'export default (api: ExampleApi) => api.add(2)', options),
      ],
      { concurrency: 'unbounded' },
    )

    try {
      //when
      const results = await runtime.runPromise(evaluation)

      //then
      expect(results).toEqual([2, 3])
    } finally {
      await runtime.dispose()
    }
  })

  test('should reject external imports before worker creation given a program with an import', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(core, definition, host, 'import "node:fs"; export default () => 1', options),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'validation', operation: 'import' })
  })

  test('should use in-process execution given the in-process option', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: (_method: string, args: readonly unknown[]) => Number(args[0]) + 1,
    }

    //when
    const result = await Effect.runPromise(
      evaluateWithHost(core, definition, host, 'export default (api: ExampleApi) => api.add(2)', {
        ...options,
        execution: 'in-process',
      }),
    )

    //then
    expect(result).toBe(3)
  })

  test('should return a cancellation failure given an already-aborted signal', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const controller = new AbortController()
    controller.abort()
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(core, definition, host, 'export default () => 1', { ...options, signal: controller.signal }),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'cancellation' })
  })

  test('should measure evaluation deadlines with the Effect clock given a test clock', async () => {
    //given
    let monotonicTime = 0n
    const readMonotonicTime = (): bigint => {
      const current = monotonicTime
      monotonicTime += 1_000_000n
      return current
    }
    const clock: Clock.Clock = {
      currentTimeMillisUnsafe: () => 0,
      currentTimeMillis: Effect.succeed(0),
      currentTimeNanosUnsafe: () => 0n,
      currentTimeNanos: Effect.succeed(0n),
      monotonicTimeNanosUnsafe: readMonotonicTime,
      monotonicTimeNanos: Effect.sync(readMonotonicTime),
      sleep: () => Effect.void,
    }
    const core = createProgramRunner<never, never>()
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => 1,
    }
    const evaluation = Effect.provideService(
      evaluateWithHost(core, definition, host, 'export default () => 1', { ...options, timeoutMs: 1 }),
      Clock.Clock,
      clock,
    )

    //when
    const result = Effect.runPromise(evaluation)

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'timeout' })
  })

  test('should report cancellation before timeout given an already-aborted signal', async () => {
    //given
    let monotonicTime = 0n
    const readMonotonicTime = (): bigint => {
      const current = monotonicTime
      monotonicTime += 1_000_000n
      return current
    }
    const clock: Clock.Clock = {
      currentTimeMillisUnsafe: () => 0,
      currentTimeMillis: Effect.succeed(0),
      currentTimeNanosUnsafe: () => 0n,
      currentTimeNanos: Effect.succeed(0n),
      monotonicTimeNanosUnsafe: readMonotonicTime,
      monotonicTimeNanos: Effect.sync(readMonotonicTime),
      sleep: () => Effect.void,
    }
    const core = createProgramRunner<never, never>()
    const controller = new AbortController()
    controller.abort()
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => 1,
    }
    const evaluation = Effect.provideService(
      evaluateWithHost(core, definition, host, 'export default () => 1', {
        ...options,
        timeoutMs: 1,
        signal: controller.signal,
      }),
      Clock.Clock,
      clock,
    )

    //when
    const result = Effect.runPromise(evaluation)

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'cancellation' })
  })

  test('should terminate the worker given an evaluation timeout', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(core, definition, host, 'export default () => { while (true) {} }', {
        ...options,
        timeoutMs: 100,
      }),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'timeout' })
  })

  test('should time out the program given a Promise that never settles', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(core, definition, host, 'export default () => new Promise(() => {})', {
        ...options,
        timeoutMs: 100,
      }),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'timeout' })
  })

  test('should interrupt a worker evaluation given caller runtime cancellation', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const fiber = Effect.runFork(
      evaluateWithHost(
        core,
        definition,
        { invoke: () => Effect.succeed('ok'), invokeSync: () => 1 },
        'export default () => new Promise(() => {})',
        options,
      ),
    )
    const joined = Fiber.join(fiber)
    await new Promise((resolve) => setTimeout(resolve, 20))

    //when
    await Effect.runPromise(Fiber.interrupt(fiber))

    //then
    await expect(Effect.runPromise(joined)).rejects.toBeDefined()
  })

  test('should cancel in-process execution given a pending Promise and an aborted signal', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const controller = new AbortController()
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => 1,
    }
    const result = Effect.runPromise(
      evaluateWithHost(core, definition, host, 'export default () => new Promise(() => {})', {
        ...options,
        execution: 'in-process',
        signal: controller.signal,
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))

    //when
    controller.abort()

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'cancellation' })
  })

  test('should cancel worker execution given a pending host Effect', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const controller = new AbortController()
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.never,
      invokeSync: () => 1,
    }
    const result = Effect.runPromise(
      evaluateWithHost(core, definition, host, 'export default async (api: ExampleApi) => await api.wait("ok")', {
        ...options,
        signal: controller.signal,
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))

    //when
    controller.abort()

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'cancellation' })
  })

  test('should return an invoke failure given a host that throws before returning an Effect', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const host: ProgramHost<never, never> = {
      invoke: () => {
        throw new Error('Host failed before returning an Effect.')
      },
      invokeSync: () => 1,
    }
    const evaluation = evaluateWithHost(
      core,
      definition,
      host,
      'export default async (api: ExampleApi) => await api.wait("ok")',
      {
        ...options,
        timeoutMs: 500,
      },
    )

    //when
    const result = Effect.runPromise(evaluation)

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'invoke', operation: 'wait' })
  })

  test('should preserve ProgramFailure host failures given worker execution', async () => {
    //given
    const failure = createProgramFailure({ _tag: 'host', operation: 'wait', message: 'Host failed.' })
    const core = createProgramRunner<never, typeof failure>()
    const host: ProgramHost<never, typeof failure> = {
      invoke: () => Effect.fail(failure),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(
        core,
        definition,
        host,
        'export default async (api: ExampleApi) => await api.wait("ok")',
        options,
      ),
    )

    //then
    await expect(result).rejects.toEqual(failure)
  })

  test('should preserve custom host failures given worker execution with a codec', async () => {
    //given
    const failure: HostFailure = { code: 'HOST_FAILED', message: 'Host failed.' }
    const core = createProgramRunner<never, HostFailure>()
    const host: ProgramHost<never, HostFailure> = {
      errorCodec: hostErrorCodec,
      invoke: () => Effect.fail(failure),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(
        core,
        definition,
        host,
        'export default async (api: ExampleApi) => await api.wait("ok")',
        options,
      ),
    )

    //then
    await expect(result).rejects.toEqual(failure)
  })

  test('should round-trip tagged host failures given an error codec', async () => {
    //given
    const failure: TaggedHostFailure = {
      _tag: 'HostMissing',
      operation: 'fetch',
      message: 'not found',
      code: 42,
    }
    const codecCalls = { encode: 0, decode: 0 }
    const errorCodec: ProgramHostErrorCodec<TaggedHostFailure> = {
      encode: (error: TaggedHostFailure) => {
        codecCalls.encode += 1
        return { ...error }
      },
      decode: (value: ProgramWireValue) => {
        codecCalls.decode += 1
        return Schema.decodeUnknownSync(taggedHostFailureSchema)(value)
      },
    }
    const core = createProgramRunner<never, TaggedHostFailure>()
    const host: ProgramHost<never, TaggedHostFailure> = {
      errorCodec,
      invoke: () => Effect.fail(failure),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(
        core,
        definition,
        host,
        'export default async (api: ExampleApi) => await api.wait("ok")',
        options,
      ),
    )

    //then
    await expect(result).rejects.toEqual(failure)
    expect(codecCalls).toEqual({ encode: 1, decode: 1 })
  })

  test('should expose encoded data given worker code catches a tagged host failure', async () => {
    //given
    const failure: TaggedHostFailure = {
      _tag: 'HostMissing',
      operation: 'fetch',
      message: 'not found',
      code: 42,
    }
    const codecCalls = { encode: 0, decode: 0 }
    const errorCodec: ProgramHostErrorCodec<TaggedHostFailure> = {
      encode: (error: TaggedHostFailure) => {
        codecCalls.encode += 1
        return { ...error }
      },
      decode: (value: ProgramWireValue) => {
        codecCalls.decode += 1
        return Schema.decodeUnknownSync(taggedHostFailureSchema)(value)
      },
    }
    const core = createProgramRunner<never, TaggedHostFailure>()
    const host: ProgramHost<never, TaggedHostFailure> = {
      errorCodec,
      invoke: () => Effect.fail(failure),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(
        core,
        definition,
        host,
        'export default async (api: ExampleApi) => { try { await api.wait("ok"); return "unexpected" } catch (error) { return error } }',
        options,
      ),
    )

    //then
    await expect(result).resolves.toEqual({ type: 'code-mode-host-error', value: failure })
    expect(codecCalls).toEqual({ encode: 1, decode: 0 })
  })

  test('should expose the encoded host error given worker code catches it', async () => {
    //given
    const failure: HostFailure = { code: 'HOST_FAILED', message: 'Host failed.' }
    const core = createProgramRunner<never, HostFailure>()
    const host: ProgramHost<never, HostFailure> = {
      errorCodec: hostErrorCodec,
      invoke: () => Effect.fail(failure),
      invokeSync: () => 1,
    }

    //when
    const result = await Effect.runPromise(
      evaluateWithHost(
        core,
        definition,
        host,
        'export default async (api: ExampleApi) => { try { await api.wait("ok"); return "unexpected" } catch (error) { return error } }',
        options,
      ),
    )

    //then
    expect(result).toEqual({ type: 'code-mode-host-error', value: failure })
  })

  test('should preserve custom host failures given in-process execution without a codec', async () => {
    //given
    const failure: HostFailure = { code: 'HOST_FAILED', message: 'Host failed.' }
    const core = createProgramRunner<never, HostFailure>()
    const host: ProgramHost<never, HostFailure> = {
      invoke: () => Effect.fail(failure),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(core, definition, host, 'export default async (api: ExampleApi) => await api.wait("ok")', {
        ...options,
        execution: 'in-process',
      }),
    )

    //then
    await expect(result).rejects.toEqual(failure)
  })

  test('should reject a custom host failure given worker execution without a codec', async () => {
    //given
    const failure: HostFailure = { code: 'HOST_FAILED', message: 'Host failed.' }
    const core = createProgramRunner<never, HostFailure>()
    const host: ProgramHost<never, HostFailure> = {
      invoke: () => Effect.fail(failure),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(
        core,
        definition,
        host,
        'export default async (api: ExampleApi) => await api.wait("ok")',
        options,
      ),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'serialize', operation: 'host-error' })
  })

  test('should return a serialization failure given a host error codec that cannot encode', async () => {
    //given
    const failure: HostFailure = { code: 'HOST_FAILED', message: 'Host failed.' }
    const core = createProgramRunner<never, HostFailure>()
    const host: ProgramHost<never, HostFailure> = {
      errorCodec: {
        ...hostErrorCodec,
        encode: () => {
          throw new Error('encode failed')
        },
      },
      invoke: () => Effect.fail(failure),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(
        core,
        definition,
        host,
        'export default async (api: ExampleApi) => await api.wait("ok")',
        options,
      ),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'serialize', operation: 'host-error' })
  })

  test('should return a deserialization failure given a host error codec that cannot decode', async () => {
    //given
    const failure: HostFailure = { code: 'HOST_FAILED', message: 'Host failed.' }
    const core = createProgramRunner<never, HostFailure>()
    const host: ProgramHost<never, HostFailure> = {
      errorCodec: {
        ...hostErrorCodec,
        decode: () => {
          throw new Error('decode failed')
        },
      },
      invoke: () => Effect.fail(failure),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(
        core,
        definition,
        host,
        'export default async (api: ExampleApi) => await api.wait("ok")',
        options,
      ),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'deserialize', operation: 'host-error' })
  })

  test('should convert thrown non-Error values to failures given program execution', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(core, definition, host, 'export default () => { throw "bad value" }', options),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'invoke', message: 'bad value' })
  })

  test('should preserve exception details given a thrown Error', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(core, definition, host, 'export default () => { throw new TypeError("bad value") }', options),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'invoke', name: 'TypeError', message: 'bad value' })
  })

  test('should return a serialization failure given a non-cloneable result', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(evaluateWithHost(core, definition, host, 'export default () => () => 1', options))

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'serialize' })
  })

  test('should return a serialization failure given non-cloneable synchronous arguments', async () => {
    //given
    const core = createProgramRunner<never, never>()
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(core, definition, host, 'export default (api: ExampleApi) => api.add(() => 1)', options),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'serialize' })
  })
})
