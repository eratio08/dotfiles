import { describe, test } from 'bun:test'
import { strict as assert } from 'node:assert'
import { Effect, Layer } from 'effect'
import { SkillChangeWriter, SkillChangeWriterLive } from '../../src/apply/writer.ts'
import { MemoryFileSystem } from '../../src/testing/memory-fs.ts'
import type { SkillChange, SkillRecord } from '../../src/types.ts'

function run<A, E>(fs: MemoryFileSystem, effect: Effect.Effect<A, E, SkillChangeWriter>): Promise<A> {
  const layer = SkillChangeWriterLive.pipe(Layer.provide(fs.layer))
  return Effect.runPromise(effect.pipe(Effect.provide(layer)))
}

describe('SkillChangeWriter', () => {
  test('applies independent changes and reports conflicts and filesystem errors', async () => {
    //given
    const first = skillChange('/skills/first/SKILL.md', 'first', 'old', 'new')
    const conflict = skillChange('/skills/conflict/SKILL.md', 'conflict', 'old', 'new')
    const missing = skillChange('/skills/missing/SKILL.md', 'missing', 'old', 'new')
    const fs = new MemoryFileSystem(
      new Map([
        [first.filePath, first.patch.oldText],
        [conflict.filePath, 'changed'],
      ]),
    )
    //when
    const result = await run(
      fs,
      SkillChangeWriter.use((writer) => writer.apply([first, conflict, missing])),
    )

    //then
    assert.deepEqual(
      result.applied.map((change) => change.skill.name),
      ['first'],
    )
    assert.equal(result.errors.length, 2)
    assert.equal(result.errors[0]?.message, 'conflict: file changed while dialog was open; skipped')
    assert.match(result.errors[1]?.message ?? '', /^missing: missing file:/)
    assert.equal(fs.content(first.filePath), 'new')
    assert.equal(fs.content(conflict.filePath), 'changed')
  })
})

function skillChange(filePath: string, name: string, oldText: string, newText: string): SkillChange {
  const skill: SkillRecord = {
    id: filePath,
    name,
    description: '',
    filePath,
    baseDir: '/skills',
    source: { kind: 'user', root: '/skills' },
    editable: true,
    mode: 'agent-invocable',
    diagnostics: [],
  }
  return {
    skill,
    filePath,
    from: 'agent-invocable',
    to: 'manual-only',
    patch: { oldText, newText },
  }
}
