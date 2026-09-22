import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { Effect, Layer } from 'effect'
import { installPiPlugin } from './adapter.ts'
import type { PiExtensionError, PiRegistrationError } from './errors.ts'
import type { PiRegistrationContext } from './registries.ts'
import type { PiHost, PiStableServices } from './services.ts'

type PiPluginWithLayer<Services, Failure = PiExtensionError> = {
  readonly id: string
  readonly layer: Layer.Layer<Services, Failure, PiHost | PiStableServices>
  readonly effect: (
    context: PiRegistrationContext<Services, Failure>,
  ) => Effect.Effect<void, Failure | PiRegistrationError, Services | PiStableServices>
}

type PiPluginWithoutLayer<Failure = PiExtensionError> = {
  readonly id: string
  readonly layer?: undefined
  readonly effect: (
    context: PiRegistrationContext<never, Failure>,
  ) => Effect.Effect<void, Failure | PiRegistrationError, PiStableServices>
}

type PiPluginDefinition<Services, Failure = PiExtensionError> =
  | PiPluginWithLayer<Services, Failure>
  | PiPluginWithoutLayer<Failure>

type PiPlugin<Services, Failure = PiExtensionError> =
  | PiPluginWithLayer<Services, Failure>
  | PiPluginWithoutLayer<Failure>

function definePlugin<Services, Failure = PiExtensionError>(
  definition: PiPluginWithLayer<Services, Failure>,
): PiPluginWithLayer<Services, Failure>
function definePlugin<Failure = PiExtensionError>(
  definition: PiPluginWithoutLayer<Failure>,
): PiPluginWithoutLayer<Failure>
function definePlugin<Services, Failure = PiExtensionError>(
  definition: PiPluginWithLayer<Services, Failure> | PiPluginWithoutLayer<Failure>,
): PiPlugin<Services, Failure> {
  return definition
}

const PiExtension = {
  define: definePlugin,
  install<Services, Failure = PiExtensionError>(plugin: PiPlugin<Services, Failure>): ExtensionFactory {
    return installPiPlugin(plugin)
  },
}

export { PiExtension, type PiPlugin, type PiPluginDefinition }
