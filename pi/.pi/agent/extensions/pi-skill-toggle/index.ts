import { PiExtension, type PiExtensionError, type PiRegistrationContext } from '@eratio08/pi-effect'
import { Effect, Layer } from 'effect'
import { type SkillTogglePlanner, SkillTogglePlannerLive } from './src/apply/planner.ts'
import { type SkillChangeWriter, SkillChangeWriterLive } from './src/apply/writer.ts'
import { runToggleSkillsCommand } from './src/command.ts'
import type { SkillLocator } from './src/discovery/skill-locator.ts'
import { SkillLocatorLive } from './src/discovery/skill-locator.ts'
import { SimpleFrontmatterCodec } from './src/frontmatter/parser.ts'
import { MinimalFrontmatterPatcher } from './src/frontmatter/patcher.ts'
import { type SkillInventory, SkillInventoryLive } from './src/inventory/loader.ts'
import type { FileSystem } from './src/ports/fs.ts'
import { FileSystemLive } from './src/ports/fs.ts'

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
