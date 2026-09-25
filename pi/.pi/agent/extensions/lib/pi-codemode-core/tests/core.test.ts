import { describe, expect, test } from 'bun:test'
import { Clock, Context, Effect, Fiber, Layer, ManagedRuntime, Schema } from 'effect'
import type {
  ProgramRunner as CodeModeCore,
  ProgramDefinition as CodeModeDefinition,
  ProgramFailure as CodeModeFailure,
  ProgramHostErrorCodec as CodeModeHostErrorCodec,
  ProgramRunOptions as CodeModeRunOptions,
  ProgramWireValue as CodeModeWireValue,
} from '../src/index.ts'
import {
  ProgramHost as CodeModeEffectHost,
  createProgramRunner as createCodeModeCore,
  createProgramFailure as createCodeModeFailure,
} from '../src/index.ts'

const definition: CodeModeDefinition = {
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
  core: CodeModeCore<R, E>,
  definition: CodeModeDefinition,
  host: CodeModeEffectHost<R, E>,
  code: string,
  runOptions: CodeModeRunOptions,
): Effect.Effect<unknown, CodeModeFailure | E, R> =>
  Effect.provideService(core.evaluate(definition, code, runOptions), CodeModeEffectHost<R, E>(), host)

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

const hostErrorCodec: CodeModeHostErrorCodec<HostFailure> = {
  encode: (failure) => ({ code: failure.code, message: failure.message }),
  decode: (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new TypeError('Invalid host failure.')
    const record = value as { readonly code?: CodeModeWireValue; readonly message?: CodeModeWireValue }
    if (typeof record.code !== 'string' || typeof record.message !== 'string')
      throw new TypeError('Invalid host failure.')
    return { code: record.code, message: record.message }
  },
}

describe('code mode core', () => {
  test('runs a worker evaluation with an Effect host', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const host: CodeModeEffectHost<never, never> = {
      invoke: (method, args) => Effect.succeed(method === 'wait' ? String(args[0]).length : undefined),
      invokeSync: (method, args) => (method === 'add' ? Number(args[0]) + 1 : undefined),
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

  test('uses the host provided for each evaluation', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const firstHost: CodeModeEffectHost<never, never> = {
      invoke: () => Effect.succeed('unused'),
      invokeSync: () => 1,
    }
    const secondHost: CodeModeEffectHost<never, never> = {
      invoke: () => Effect.succeed('unused'),
      invokeSync: () => 2,
    }

    //when
    const result = Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* evaluateWithHost(
          core,
          definition,
          firstHost,
          'export default (api: ExampleApi) => api.add(0)',
          options,
        )
        const second = yield* evaluateWithHost(
          core,
          definition,
          secondHost,
          'export default (api: ExampleApi) => api.add(0)',
          options,
        )
        return [first, second]
      }),
    )

    //then
    await expect(result).resolves.toEqual([1, 2])
  })

  test('preserves host Effect requirements', async () => {
    //given
    const core = createCodeModeCore<HostDependencyRequirement, never>()
    const host: CodeModeEffectHost<HostDependencyRequirement, never> = {
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

  test('maps an invalid definition to a validation failure', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const invalidDefinition = { ...definition, methods: [] }
    const host: CodeModeEffectHost<never, never> = {
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

  test('reuses a caller-owned runtime for multiple evaluations', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const runtime = ManagedRuntime.make(Layer.empty)
    const host: CodeModeEffectHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: (_method, args) => Number(args[0]) + 1,
    }

    //when
    const results = await Promise.all([
      runtime.runPromise(
        evaluateWithHost(core, definition, host, 'export default (api: ExampleApi) => api.add(1)', options),
      ),
      runtime.runPromise(
        evaluateWithHost(core, definition, host, 'export default (api: ExampleApi) => api.add(2)', options),
      ),
    ])
    await runtime.dispose()

    //then
    expect(results).toEqual([2, 3])
  })

  test('rejects external imports before worker creation', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const host: CodeModeEffectHost<never, never> = {
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

  test('uses the explicit in-process execution mode', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const host: CodeModeEffectHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: (_method, args) => Number(args[0]) + 1,
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

  test('returns a typed cancellation failure', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const controller = new AbortController()
    controller.abort()
    const host: CodeModeEffectHost<never, never> = {
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

  test('uses the Effect clock to measure evaluation deadlines', async () => {
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
    const core = createCodeModeCore<never, never>()
    const host: CodeModeEffectHost<never, never> = {
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

  test('keeps an already-aborted caller signal ahead of the clock deadline', async () => {
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
    const core = createCodeModeCore<never, never>()
    const controller = new AbortController()
    controller.abort()
    const host: CodeModeEffectHost<never, never> = {
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

  test('terminates a worker after a timeout', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const host: CodeModeEffectHost<never, never> = {
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

  test('times out a Promise that never settles', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const host: CodeModeEffectHost<never, never> = {
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

  test('interrupts a worker evaluation through the caller runtime', async () => {
    //given
    const core = createCodeModeCore<never, never>()
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

  test('cancels an in-process Promise while it is pending', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const controller = new AbortController()
    const host: CodeModeEffectHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(core, definition, host, 'export default () => new Promise(() => {})', {
        ...options,
        execution: 'in-process',
        signal: controller.signal,
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort()

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'cancellation' })
  })

  test('cancels a worker while an Effect host call is pending', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const controller = new AbortController()
    const host: CodeModeEffectHost<never, never> = {
      invoke: () => Effect.never,
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(
      evaluateWithHost(core, definition, host, 'export default async (api: ExampleApi) => await api.wait("ok")', {
        ...options,
        signal: controller.signal,
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort()

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'cancellation' })
  })

  test('returns an invoke failure when a host throws before returning an Effect', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const host: CodeModeEffectHost<never, never> = {
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

  test('preserves CodeModeFailure host failures in worker mode', async () => {
    //given
    const failure = createCodeModeFailure({ _tag: 'host', operation: 'wait', message: 'Host failed.' })
    const core = createCodeModeCore<never, typeof failure>()
    const host: CodeModeEffectHost<never, typeof failure> = {
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

  test('preserves custom host failures in worker mode with a codec', async () => {
    //given
    const failure: HostFailure = { code: 'HOST_FAILED', message: 'Host failed.' }
    const core = createCodeModeCore<never, HostFailure>()
    const host: CodeModeEffectHost<never, HostFailure> = {
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

  test('round trips tagged host failures through their error codec', async () => {
    //given
    const failure: TaggedHostFailure = {
      _tag: 'HostMissing',
      operation: 'fetch',
      message: 'not found',
      code: 42,
    }
    const codecCalls = { encode: 0, decode: 0 }
    const errorCodec: CodeModeHostErrorCodec<TaggedHostFailure> = {
      encode: (error) => {
        codecCalls.encode += 1
        return { ...error }
      },
      decode: (value) => {
        codecCalls.decode += 1
        return Schema.decodeUnknownSync(taggedHostFailureSchema)(value)
      },
    }
    const core = createCodeModeCore<never, TaggedHostFailure>()
    const host: CodeModeEffectHost<never, TaggedHostFailure> = {
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

  test('exposes tagged host failures as encoded data when worker code catches them', async () => {
    //given
    const failure: TaggedHostFailure = {
      _tag: 'HostMissing',
      operation: 'fetch',
      message: 'not found',
      code: 42,
    }
    const codecCalls = { encode: 0, decode: 0 }
    const errorCodec: CodeModeHostErrorCodec<TaggedHostFailure> = {
      encode: (error) => {
        codecCalls.encode += 1
        return { ...error }
      },
      decode: (value) => {
        codecCalls.decode += 1
        return Schema.decodeUnknownSync(taggedHostFailureSchema)(value)
      },
    }
    const core = createCodeModeCore<never, TaggedHostFailure>()
    const host: CodeModeEffectHost<never, TaggedHostFailure> = {
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

  test('exposes the encoded host error when worker code catches it', async () => {
    //given
    const failure: HostFailure = { code: 'HOST_FAILED', message: 'Host failed.' }
    const core = createCodeModeCore<never, HostFailure>()
    const host: CodeModeEffectHost<never, HostFailure> = {
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

  test('preserves custom host failures in in-process mode without a codec', async () => {
    //given
    const failure: HostFailure = { code: 'HOST_FAILED', message: 'Host failed.' }
    const core = createCodeModeCore<never, HostFailure>()
    const host: CodeModeEffectHost<never, HostFailure> = {
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

  test('rejects a custom worker host failure when its codec is missing', async () => {
    //given
    const failure: HostFailure = { code: 'HOST_FAILED', message: 'Host failed.' }
    const core = createCodeModeCore<never, HostFailure>()
    const host: CodeModeEffectHost<never, HostFailure> = {
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

  test('returns a failure when a host error codec cannot encode', async () => {
    //given
    const failure: HostFailure = { code: 'HOST_FAILED', message: 'Host failed.' }
    const core = createCodeModeCore<never, HostFailure>()
    const host: CodeModeEffectHost<never, HostFailure> = {
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

  test('returns a failure when a host error codec cannot decode', async () => {
    //given
    const failure: HostFailure = { code: 'HOST_FAILED', message: 'Host failed.' }
    const core = createCodeModeCore<never, HostFailure>()
    const host: CodeModeEffectHost<never, HostFailure> = {
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

  test('turns thrown non-error values into code mode failures', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const host: CodeModeEffectHost<never, never> = {
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

  test('preserves ordinary exception details', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const host: CodeModeEffectHost<never, never> = {
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

  test('returns a typed failure for a non-cloneable result', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const host: CodeModeEffectHost<never, never> = {
      invoke: () => Effect.succeed('ok'),
      invokeSync: () => 1,
    }

    //when
    const result = Effect.runPromise(evaluateWithHost(core, definition, host, 'export default () => () => 1', options))

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'serialize' })
  })

  test('returns a typed failure for non-cloneable sync arguments', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const host: CodeModeEffectHost<never, never> = {
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
