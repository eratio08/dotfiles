import { PiExtension } from '@eratio08/pi-effect'
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

const gptContextModePlugin = PiExtension.define<GptContextModeService | GptContextModeState, GptContextModeError>({
  id: 'gpt-context-mode',
  layer: Layer.mergeAll(GptContextModeLayer, GptContextModeState.layer),
  effect: (registrations) =>
    Effect.gen(function* () {
      const service = yield* GptContextModeService
      yield* registrations.commands.register('gpt-context-mode', {
        description: 'Switch GPT-5.6 between default and long context windows',
        handler: (args) => service.handleCommand(args),
      })
      yield* registrations.events.on('session_start', () => service.restore().pipe(Effect.as(undefined)))
      yield* registrations.events.on('session_tree', () => service.restore().pipe(Effect.as(undefined)))
      yield* registrations.events.on('model_select', (event) =>
        service.applyModel(event.model).pipe(Effect.as(undefined)),
      )
      yield* registrations.events.on('session_shutdown', () => service.shutdown().pipe(Effect.as(undefined)))
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
