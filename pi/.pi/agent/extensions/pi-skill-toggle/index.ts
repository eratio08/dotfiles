import { PiExtension, type PiExtensionError, type PiRegistrationContext } from '@eratio08/pi-effect'
import { Effect, Layer } from 'effect'
import {
  type FileSystem,
  FileSystemLive,
  MinimalFrontmatterPatcher,
  runToggleSkillsCommand,
  SimpleFrontmatterCodec,
  type SkillChangeWriter,
  SkillChangeWriterLive,
  type SkillInventory,
  SkillInventoryLive,
  type SkillLocator,
  SkillLocatorLive,
  type SkillTogglePlanner,
  SkillTogglePlannerLive,
} from './src/extension.ts'

const codec = new SimpleFrontmatterCodec()
const locatorLayer: Layer.Layer<SkillLocator, never, FileSystem> = SkillLocatorLive
const skillLayer = Layer.mergeAll(
  locatorLayer,
  SkillInventoryLive(codec).pipe(Layer.provide(locatorLayer)),
  SkillTogglePlannerLive(codec, new MinimalFrontmatterPatcher()),
  SkillChangeWriterLive,
).pipe(Layer.provide(FileSystemLive))

type SkillToggleServices = SkillInventory | SkillTogglePlanner | SkillChangeWriter

const piSkillTogglePlugin = PiExtension.define<SkillToggleServices>({
  id: 'pi-skill-toggle',
  layer: skillLayer,
  effect: (registrations: PiRegistrationContext<SkillToggleServices, PiExtensionError>) =>
    Effect.gen(function* () {
      yield* registrations.commands.register('toggle-skills', {
        description: 'Toggle whether skills are agent-invocable or manual-only',
        handler: () => runToggleSkillsCommand(),
      })
    }),
})

const piSkillToggle = PiExtension.install(piSkillTogglePlugin)

export { piSkillToggle as default }
