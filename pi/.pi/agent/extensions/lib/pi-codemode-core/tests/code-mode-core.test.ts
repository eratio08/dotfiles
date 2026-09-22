import { describe, expect, test } from 'bun:test'
import { Effect, Fiber, Layer, ManagedRuntime } from 'effect'
import type { CodeModeDefinition, CodeModeEffectHost, CodeModeHostErrorCodec, CodeModeWireValue } from '../src/index.ts'
import { createCodeModeCore, createCodeModeFailure } from '../src/index.ts'

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

type HostFailure = {
  readonly code: string
  readonly message: string
}

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
      core.evaluate(
        definition,
        host,
        'export default async (api: ExampleApi) => api.add(await api.wait("ok"))',
        options,
      ),
    )

    //then
    expect(result).toBe(3)
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
      runtime.runPromise(core.evaluate(definition, host, 'export default (api: ExampleApi) => api.add(1)', options)),
      runtime.runPromise(core.evaluate(definition, host, 'export default (api: ExampleApi) => api.add(2)', options)),
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
      core.evaluate(definition, host, 'import "node:fs"; export default () => 1', options),
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
      core.evaluate(definition, host, 'export default (api: ExampleApi) => api.add(2)', {
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
      core.evaluate(definition, host, 'export default () => 1', { ...options, signal: controller.signal }),
    )

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
      core.evaluate(definition, host, 'export default () => { while (true) {} }', { ...options, timeoutMs: 100 }),
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
      core.evaluate(definition, host, 'export default () => new Promise(() => {})', { ...options, timeoutMs: 100 }),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'timeout' })
  })

  test('interrupts a worker evaluation through the caller runtime', async () => {
    //given
    const core = createCodeModeCore<never, never>()
    const fiber = Effect.runFork(
      core.evaluate(
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
      core.evaluate(definition, host, 'export default () => new Promise(() => {})', {
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
      core.evaluate(definition, host, 'export default async (api: ExampleApi) => await api.wait("ok")', {
        ...options,
        signal: controller.signal,
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    controller.abort()

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'cancellation' })
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
      core.evaluate(definition, host, 'export default async (api: ExampleApi) => await api.wait("ok")', options),
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
      core.evaluate(definition, host, 'export default async (api: ExampleApi) => await api.wait("ok")', options),
    )

    //then
    await expect(result).rejects.toEqual(failure)
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
      core.evaluate(
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
      core.evaluate(definition, host, 'export default async (api: ExampleApi) => await api.wait("ok")', {
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
      core.evaluate(definition, host, 'export default async (api: ExampleApi) => await api.wait("ok")', options),
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
      core.evaluate(definition, host, 'export default async (api: ExampleApi) => await api.wait("ok")', options),
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
      core.evaluate(definition, host, 'export default async (api: ExampleApi) => await api.wait("ok")', options),
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
      core.evaluate(definition, host, 'export default () => { throw "bad value" }', options),
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
      core.evaluate(definition, host, 'export default () => { throw new TypeError("bad value") }', options),
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
    const result = Effect.runPromise(core.evaluate(definition, host, 'export default () => () => 1', options))

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
      core.evaluate(definition, host, 'export default (api: ExampleApi) => api.add(() => 1)', options),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'serialize' })
  })
})
