import { describe, test } from 'bun:test'
import { strict as assert } from 'node:assert'
import { Effect, Layer } from 'effect'
import { SkillTogglePlanner, SkillTogglePlannerLive } from '../../src/apply/planner.ts'
import { SimpleFrontmatterCodec } from '../../src/frontmatter/parser.ts'
import { MinimalFrontmatterPatcher } from '../../src/frontmatter/patcher.ts'
import { MemoryFileSystem } from '../../src/testing/memory-fs.ts'
import type { SkillRecord } from '../../src/types.ts'

const codec = new SimpleFrontmatterCodec()
const patcher = new MinimalFrontmatterPatcher()

function run<A, E>(fs: MemoryFileSystem, effect: Effect.Effect<A, E, SkillTogglePlanner>): Promise<A> {
  const layer = SkillTogglePlannerLive(codec, patcher).pipe(Layer.provide(fs.layer))
  return Effect.runPromise(effect.pipe(Effect.provide(layer)))
}

describe('SkillTogglePlanner', () => {
  test('plans a normalization change for duplicated disable-model-invocation keys even if the mode is unchanged', async () => {
    //given
    const filePath = '/skills/handoff/SKILL.md'
    const raw = [
      '---',
      'name: handoff',
      'description: Compact the conversation.',
      'disable-model-invocation: true',
      'argument-hint: What next?',
      'disable-model-invocation: true',
      '---',
      '',
      '# Handoff',
      '',
    ].join('\n')
    const fs = new MemoryFileSystem(new Map([[filePath, raw]]))
    const record = skillRecord(filePath, 'manual-only')

    //when
    const changes = await run(
      fs,
      SkillTogglePlanner.use((planner) => planner.plan([record], [{ skill: record, desiredMode: 'manual-only' }])),
    )

    //then
    assert.equal(changes.length, 1)
    assert.equal(changes[0]?.from, 'manual-only')
    assert.equal(changes[0]?.to, 'manual-only')
    assert.equal((changes[0]?.patch.newText.match(/^disable-model-invocation\s*:/gm) ?? []).length, 1)
  })
})

function skillRecord(filePath: string, mode: SkillRecord['mode']): SkillRecord {
  return {
    id: filePath,
    name: 'handoff',
    description: 'Compact the conversation.',
    filePath,
    baseDir: '/skills/handoff',
    source: { kind: 'user', root: '/skills' },
    editable: true,
    mode,
    diagnostics: [],
  }
}
