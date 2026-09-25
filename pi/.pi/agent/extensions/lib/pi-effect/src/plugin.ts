import type { ExtensionFactory } from '@earendil-works/pi-coding-agent'
import type { Effect, Layer } from 'effect'
import { installPiPlugin } from './adapter.ts'
import type { PiExtensionError, PiRegistrationError } from './errors.ts'
import type { PiRegistrationContext } from './registries.ts'
import type { PiHostService, PiStableServices } from './services.ts'

type PiPluginWithLayer<Services, Failure = PiExtensionError> = {
  /** Stable identifier used by Pi when installing this plugin. */
  readonly id: string
  /** Layer that provides the plugin's additional services and can fail with `Failure`. */
  readonly layer: Layer.Layer<Services, Failure, PiHostService | PiStableServices>
  /** Setup Effect that registers callbacks and requires the plugin and stable services. */
  readonly effect: (
    context: PiRegistrationContext<Services, Failure>,
  ) => Effect.Effect<void, Failure | PiRegistrationError, Services | PiStableServices>
}

type PiPluginWithoutLayer<Failure = PiExtensionError> = {
  /** Stable identifier used by Pi when installing this plugin. */
  readonly id: string
  /** No extra service layer is provided for this plugin. */
  readonly layer?: undefined
  /** Setup Effect that registers callbacks using the stable Pi services. */
  readonly effect: (
    context: PiRegistrationContext<never, Failure>,
  ) => Effect.Effect<void, Failure | PiRegistrationError, PiStableServices>
}

/** Plugin definition accepted by `PiExtension.define` and `PiExtension.install`. */
type PiPluginDefinition<Services, Failure = PiExtensionError> =
  | PiPluginWithLayer<Services, Failure>
  | PiPluginWithoutLayer<Failure>

/** Plugin setup program and its optional service layer. Use `PiPluginDefinition` for the same union type. */
type PiPlugin<Services, Failure = PiExtensionError> =
  | PiPluginWithLayer<Services, Failure>
  | PiPluginWithoutLayer<Failure>

// This identity helper gives inline definitions contextual types and preserves layer-specific service inference.
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

/** Entry point for defining a Pi Effect plugin and installing it as a Pi extension. */
const PiExtension: {
  define: typeof definePlugin
  install<Services, Failure = PiExtensionError>(plugin: PiPlugin<Services, Failure>): ExtensionFactory
} = {
  /**
   * Adds contextual types to a plugin definition and preserves its layer service types.
   * @param definition Plugin definition to type.
   * @returns The same definition with its inferred service and failure types.
   */
  define: definePlugin,
  /** Creates the Pi extension factory that owns the plugin runtime and installs its registrations.
   * @param plugin Plugin definition with its setup Effect and optional service layer.
   * @returns An extension factory that Pi can load.
   */
  install<Services, Failure = PiExtensionError>(plugin: PiPlugin<Services, Failure>): ExtensionFactory {
    return installPiPlugin(plugin)
  },
}

export { PiExtension, type PiPlugin, type PiPluginDefinition }
