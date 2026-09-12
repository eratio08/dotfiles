import { Context, Effect, Layer } from 'effect'
import type { FrontmatterCodec } from '../frontmatter/parser.ts'
import type { FrontmatterPatcher } from '../frontmatter/patcher.ts'
import { hasDuplicateDisableModelInvocation } from '../frontmatter/validation.ts'
import { classifyInvocationMode } from '../inventory/classifier.ts'
import { FileSystem, type FileSystemError } from '../ports/fs.ts'
import type { SkillChange, SkillDraft, SkillRecord } from '../types.ts'

export class SkillTogglePlanner extends Context.Service<
  SkillTogglePlanner,
  {
    readonly plan: (records: SkillRecord[], drafts: SkillDraft[]) => Effect.Effect<SkillChange[], FileSystemError>
  }
>()('pi-skill-toggle/apply/SkillTogglePlanner') {}

const plan = Effect.fn('SkillTogglePlanner.plan')(function* (
  fs: FileSystem['Service'],
  codec: FrontmatterCodec,
  patcher: FrontmatterPatcher,
  records: SkillRecord[],
  drafts: SkillDraft[],
): Effect.fn.Return<SkillChange[], FileSystemError> {
  const recordById = new Map(records.map((record) => [record.id, record]))
  const changes: SkillChange[] = []

  for (const draft of drafts) {
    const record = recordById.get(draft.skill.id)
    if (!record?.editable) continue

    const raw = yield* fs.readFile(record.filePath)
    const doc = codec.parse(raw)
    if (!doc.hasFrontmatter) continue

    const currentMode = classifyInvocationMode(doc)
    const needsNormalization = hasDuplicateDisableModelInvocation(doc)
    if (currentMode === draft.desiredMode && !needsNormalization) continue

    const patch = patcher.patchInvocationMode(doc, draft.desiredMode)
    if (patch.oldText === patch.newText) continue

    changes.push({
      skill: { ...record, mode: currentMode },
      filePath: record.filePath,
      from: currentMode,
      to: draft.desiredMode,
      patch,
    })
  }

  return changes
})

export function SkillTogglePlannerLive(
  codec: FrontmatterCodec,
  patcher: FrontmatterPatcher,
): Layer.Layer<SkillTogglePlanner, never, FileSystem> {
  return Layer.effect(
    SkillTogglePlanner,
    Effect.gen(function* () {
      const fs = yield* FileSystem
      return SkillTogglePlanner.of({ plan: (records, drafts) => plan(fs, codec, patcher, records, drafts) })
    }),
  )
}
