import { Context, Effect, Layer } from 'effect'
import { FileSystem } from '../ports/fs.ts'
import type { ApplyResult, SkillChange } from '../types.ts'

export class SkillChangeWriter extends Context.Service<
  SkillChangeWriter,
  {
    readonly apply: (changes: SkillChange[]) => Effect.Effect<ApplyResult>
  }
>()('pi-skill-toggle/apply/SkillChangeWriter') {}

type ChangeAttempt =
  | { readonly _tag: 'applied' }
  | { readonly _tag: 'conflict' }
  | { readonly _tag: 'error'; readonly error: unknown }

function applyChange(fs: FileSystem['Service'], change: SkillChange): Effect.Effect<ChangeAttempt, never> {
  return Effect.match(
    Effect.gen(function* () {
      const current = yield* fs.readFile(change.filePath)
      if (current !== change.patch.oldText) return { _tag: 'conflict' as const }
      yield* fs.writeFileAtomic(change.filePath, change.patch.newText)
      return { _tag: 'applied' as const }
    }),
    {
      onFailure: (error) => ({ _tag: 'error' as const, error }),
      onSuccess: (attempt) => attempt,
    },
  )
}

const apply = Effect.fn('SkillChangeWriter.apply')(function* (
  fs: FileSystem['Service'],
  changes: SkillChange[],
): Effect.fn.Return<ApplyResult> {
  const result: ApplyResult = { applied: [], skipped: [], errors: [] }

  for (const change of changes) {
    const attempt = yield* applyChange(fs, change)
    if (attempt._tag === 'applied') {
      result.applied.push(change)
      continue
    }
    if (attempt._tag === 'conflict') {
      result.errors.push({
        skill: change.skill,
        message: `${change.skill.name}: file changed while dialog was open; skipped`,
      })
      continue
    }
    result.errors.push({
      skill: change.skill,
      message: `${change.skill.name}: ${attempt.error instanceof Error ? attempt.error.message : String(attempt.error)}`,
    })
  }

  return result
})

export const SkillChangeWriterLive: Layer.Layer<SkillChangeWriter, never, FileSystem> = Layer.effect(
  SkillChangeWriter,
  Effect.gen(function* () {
    const fs = yield* FileSystem
    return SkillChangeWriter.of({ apply: (changes) => apply(fs, changes) })
  }),
)
