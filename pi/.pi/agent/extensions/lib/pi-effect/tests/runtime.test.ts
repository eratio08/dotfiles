import { expect, test } from 'bun:test'
import { Context, Effect, Layer } from 'effect'
import { providePiContext } from '../src/context.ts'
import { PiRuntimeDisposedError } from '../src/errors.ts'
import { createPiManagedRuntime } from '../src/runtime.ts'
import { PiContext, type PiContextValue } from '../src/services.ts'

class RuntimeProbe extends Context.Service<RuntimeProbe, { readonly value: number }>()('tests/RuntimeProbe') {}

function contextValue(cwd: string): PiContextValue {
  return {
    mode: 'tui',
    hasUI: true,
    cwd,
    signal: undefined,
    model: undefined,
    thinkingLevel: undefined,
    isIdle: () => Effect.succeed(true),
    isProjectTrusted: () => Effect.succeed(true),
    hasPendingMessages: () => Effect.succeed(false),
    contextUsage: () => Effect.succeed(undefined),
    abort: () => Effect.succeed(undefined),
    shutdown: () => Effect.succeed(undefined),
    compact: () => Effect.succeed(undefined),
    systemPrompt: () => Effect.succeed(''),
  }
}

test('should build a stable layer once and release scoped resources given runtime startup and shutdown', async () => {
  //given
  let builds = 0
  let releases = 0
  const layer = Layer.effect(
    RuntimeProbe,
    Effect.acquireRelease(
      Effect.sync(() => {
        builds += 1
        return { value: 42 }
      }),
      () =>
        Effect.sync(() => {
          releases += 1
        }),
    ),
  )
  const runtime = createPiManagedRuntime(layer)

  //when
  const values = await Promise.all([
    runtime.run(Effect.map(RuntimeProbe, (probe) => probe.value)),
    runtime.run(Effect.map(RuntimeProbe, (probe) => probe.value)),
  ])
  await runtime.dispose()

  //then
  expect(values).toEqual([42, 42])
  expect(builds).toBe(1)
  expect(releases).toBe(1)
})

test('should keep invocation contexts isolated given concurrent runtime calls', async () => {
  //given
  const runtime = createPiManagedRuntime(Layer.empty)
  const readCwd = Effect.map(PiContext, (context) => context.cwd)

  //when
  const values = await Promise.all([
    runtime.run(providePiContext(readCwd, contextValue('/one'))),
    runtime.run(providePiContext(readCwd, contextValue('/two'))),
  ])
  await runtime.dispose()

  //then
  expect(values).toEqual(['/one', '/two'])
})

test('should interrupt work and reject runs given a disposed runtime', async () => {
  //given
  const runtime = createPiManagedRuntime(Layer.empty)
  const controller = new AbortController()
  const interrupted = runtime.run(Effect.never, [controller.signal])
  controller.abort()
  await expect(interrupted).rejects.toBeDefined()

  //when
  await runtime.dispose()
  const rejected = runtime.run(Effect.succeed(undefined))

  //then
  await expect(rejected).rejects.toBeInstanceOf(PiRuntimeDisposedError)
  expect(runtime.isClosing()).toBe(true)
})

export { RuntimeProbe }
