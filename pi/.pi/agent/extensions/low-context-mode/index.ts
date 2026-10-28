import {
  PiExtension,
  type PiRegistrationContext,
  type PiRegistrationError,
  type PiServices,
  type PiStableServices,
} from '@eratio08/pi-effect'
import { Effect, Layer } from 'effect'
import {
  LOW_CONTEXT_WINDOW,
  type LowContextMode,
  type LowContextModeError,
  LowContextModeLayer,
  LowContextModeService,
  LowContextModeState,
  parseLowContextCommand,
  restoreLowContextMode,
} from './src/extension.ts'

type LowContextModeServices = LowContextModeService | LowContextModeState
type LowContextModeEventEffect = Effect.Effect<undefined, LowContextModeError, LowContextModeServices | PiServices>

const lowContextModePlugin = PiExtension.define<LowContextModeServices, LowContextModeError>({
  id: 'low-context-mode',
  layer: Layer.mergeAll(LowContextModeLayer, LowContextModeState.layer),
  effect: (
    registrations: PiRegistrationContext<LowContextModeServices, LowContextModeError>,
  ): Effect.Effect<void, LowContextModeError | PiRegistrationError, LowContextModeServices | PiStableServices> =>
    Effect.gen(function* () {
      const service = yield* LowContextModeService
      yield* registrations.commands.register('low-context-mode', {
        description: 'Toggle the 272,000-token context window limit',
        handler: (args: string): ReturnType<LowContextModeService['Service']['handleCommand']> =>
          service.handleCommand(args),
      })
      yield* registrations.events.on(
        'session_start',
        (): LowContextModeEventEffect => service.restore().pipe(Effect.as(undefined)),
      )
      yield* registrations.events.on(
        'session_tree',
        (): LowContextModeEventEffect => service.restore().pipe(Effect.as(undefined)),
      )
      yield* registrations.events.on(
        'model_select',
        (event): LowContextModeEventEffect => service.applyModel(event.model).pipe(Effect.as(undefined)),
      )
      yield* registrations.events.on(
        'session_shutdown',
        (): LowContextModeEventEffect => service.shutdown().pipe(Effect.as(undefined)),
      )
    }),
})

const lowContextModeExtension = PiExtension.install(lowContextModePlugin)

export {
  LOW_CONTEXT_WINDOW,
  type LowContextMode,
  lowContextModeExtension as default,
  parseLowContextCommand,
  restoreLowContextMode,
}
