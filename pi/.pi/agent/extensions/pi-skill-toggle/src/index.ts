import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Layer, ManagedRuntime } from 'effect'
import { SkillTogglePlannerLive } from './apply/planner.ts'
import { SkillChangeWriterLive } from './apply/writer.ts'
import { runToggleSkillsCommand } from './command.ts'
import { SkillLocatorLive } from './discovery/skill-locator.ts'
import { SimpleFrontmatterCodec } from './frontmatter/parser.ts'
import { MinimalFrontmatterPatcher } from './frontmatter/patcher.ts'
import { SkillInventoryLive } from './inventory/loader.ts'
import { FileSystemLive } from './ports/fs.ts'

export default function piSkillToggle(pi: ExtensionAPI): void {
  const codec = new SimpleFrontmatterCodec()
  const locatorLayer = SkillLocatorLive
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      locatorLayer,
      SkillInventoryLive(codec).pipe(Layer.provide(locatorLayer)),
      SkillTogglePlannerLive(codec, new MinimalFrontmatterPatcher()),
      SkillChangeWriterLive,
    ).pipe(Layer.provide(FileSystemLive)),
  )
  let shuttingDown = false

  pi.registerCommand('toggle-skills', {
    description: 'Toggle whether skills are agent-invocable or manual-only',
    handler: async (_args, ctx) => {
      if (shuttingDown) return
      await runToggleSkillsCommand(ctx, runtime)
    },
  })

  pi.on('session_shutdown', async () => {
    if (shuttingDown) return
    shuttingDown = true
    await runtime.dispose()
  })
}
