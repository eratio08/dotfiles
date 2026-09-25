import {
  PiExtension,
  type PiRegistrationContext,
  type PiRegistrationError,
  type PiServices,
  type PiStableServices,
} from '@eratio08/pi-effect'
import { Effect, Layer } from 'effect'
import {
  GPT5_HIGH_CONTEXT_WINDOW,
  type GptContextMode,
  parseGptContextCommand,
  restoreGptContextMode,
} from './src/core.ts'
import {
  type GptContextModeError,
  GptContextModeLayer,
  GptContextModeService,
  GptContextModeState,
} from './src/effects.ts'

type GptContextModeServices = GptContextModeService | GptContextModeState
type GptContextModeEventEffect = Effect.Effect<undefined, GptContextModeError, GptContextModeServices | PiServices>

const gptContextModePlugin = PiExtension.define<GptContextModeServices, GptContextModeError>({
  id: 'gpt-context-mode',
  layer: Layer.mergeAll(GptContextModeLayer, GptContextModeState.layer),
  effect: (
    registrations: PiRegistrationContext<GptContextModeServices, GptContextModeError>,
  ): Effect.Effect<void, GptContextModeError | PiRegistrationError, GptContextModeServices | PiStableServices> =>
    Effect.gen(function* () {
      const service = yield* GptContextModeService
      yield* registrations.commands.register('gpt-context-mode', {
        description: 'Switch supported GPT models between default and long context windows',
        handler: (args: string): ReturnType<GptContextModeService['Service']['handleCommand']> =>
          service.handleCommand(args),
      })
      yield* registrations.events.on(
        'session_start',
        (): GptContextModeEventEffect => service.restore().pipe(Effect.as(undefined)),
      )
      yield* registrations.events.on(
        'session_tree',
        (): GptContextModeEventEffect => service.restore().pipe(Effect.as(undefined)),
      )
      yield* registrations.events.on(
        'model_select',
        (event): GptContextModeEventEffect => service.applyModel(event.model).pipe(Effect.as(undefined)),
      )
      yield* registrations.events.on(
        'session_shutdown',
        (): GptContextModeEventEffect => service.shutdown().pipe(Effect.as(undefined)),
      )
    }),
})

const gptContextModeExtension = PiExtension.install(gptContextModePlugin)

export {
  GPT5_HIGH_CONTEXT_WINDOW,
  type GptContextMode,
  gptContextModeExtension as default,
  parseGptContextCommand,
  restoreGptContextMode,
}
