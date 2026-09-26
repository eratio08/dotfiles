import { test } from 'bun:test'
import { Context, Effect, Layer } from 'effect'
import type { TSchema } from 'typebox'
import type { InvocationEffect } from '../src/adapter.ts'
import {
  type EffectToolDefinition,
  Pi,
  PiCommandContext,
  PiContext,
  PiExtension,
  type PiHostService,
  type PiProcess,
  type PiRegistrationError,
  PiToolContext,
  type PiToolRegistry,
} from '../src/index.ts'
import type { PiStableServices } from '../src/services.ts'

type Assert<T extends true> = T
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false
type EffectRequirements<T> =
  T extends Effect.Effect<infer _Success, infer _Failure, infer Requirements> ? Requirements : never
type InvocationHasRuntimeRequirements = Assert<
  Equal<EffectRequirements<InvocationEffect>, PiHostService | PiStableServices>
>
type ContextCannotReload = Assert<'reload' extends keyof PiContext['Service'] ? false : true>
type ContextCannotUseUi = Assert<'ui' extends keyof PiContext['Service'] ? false : true>
type ContextCannotUseToolCallId = Assert<'toolCallId' extends keyof PiContext['Service'] ? false : true>
type CommandCanReload = Assert<'reload' extends keyof PiCommandContext['Service'] ? true : false>
type ToolHasToolCallId = Assert<'toolCallId' extends keyof PiToolContext['Service'] ? true : false>
type ToolRegistryAcceptsPiServiceSubset = Assert<
  PiToolRegistry<never>['register'] extends (
    definition: EffectToolDefinition<TSchema, PiToolContext | PiProcess, { readonly _tag: 'ToolFailure' }>,
  ) => Effect.Effect<void, PiRegistrationError>
    ? true
    : false
>
type ToolRegistryRejectsUnavailableService = Assert<
  PiToolRegistry<never>['register'] extends (
    definition: EffectToolDefinition<
      TSchema,
      { readonly _tag: 'UnavailableService' },
      { readonly _tag: 'ToolFailure' }
    >,
  ) => Effect.Effect<void, PiRegistrationError>
    ? false
    : true
>

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

test('should keep command and tool operations out of lifecycle context given capability tags', () => {
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
  InvocationHasRuntimeRequirements,
  ToolHasToolCallId,
  ToolRegistryAcceptsPiServiceSubset,
  ToolRegistryRejectsUnavailableService,
}
