import { test } from 'bun:test'
import { Context, Effect, Layer } from 'effect'
import { Pi, PiCommandContext, PiContext, PiExtension, PiToolContext } from '../src/index.ts'

type Assert<T extends true> = T
type ContextCannotReload = Assert<'reload' extends keyof PiContext['Service'] ? false : true>
type ContextCannotUseUi = Assert<'ui' extends keyof PiContext['Service'] ? false : true>
type ContextCannotUseToolCallId = Assert<'toolCallId' extends keyof PiContext['Service'] ? false : true>
type CommandCanReload = Assert<'reload' extends keyof PiCommandContext['Service'] ? true : false>
type ToolHasToolCallId = Assert<'toolCallId' extends keyof PiToolContext['Service'] ? true : false>

class LayerService extends Context.Service<LayerService, { readonly value: number }>()('tests/LayerService') {}

const invocationScopedLayer = Layer.effect(
  LayerService,
  Effect.gen(function* () {
    yield* Pi
    return LayerService.of({ value: 1 })
  }),
)

PiExtension.define<LayerService>({
  id: 'tests/invalid-layer',
  // @ts-expect-error Invocation-scoped services cannot be captured by plugin layers.
  layer: invocationScopedLayer,
  effect: () => Effect.succeed(undefined),
})

test('capability tags keep command and tool operations out of lifecycle context', () => {
  //given
  const lifecycleKey = PiContext.key

  //when
  const commandKey = PiCommandContext.key
  const toolKey = PiToolContext.key

  //then
  if (new Set([lifecycleKey, commandKey, toolKey]).size !== 3) {
    throw new Error('Capability tags must be distinct.')
  }
})

export type {
  Assert,
  CommandCanReload,
  ContextCannotReload,
  ContextCannotUseToolCallId,
  ContextCannotUseUi,
  ToolHasToolCallId,
}
