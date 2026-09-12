import { describe, test } from 'bun:test'
import { strict as assert } from 'node:assert'
import { Effect, Layer } from 'effect'
import { SkillLocator } from '../../src/discovery/skill-locator.ts'
import { SimpleFrontmatterCodec } from '../../src/frontmatter/parser.ts'
import { SkillInventory, SkillInventoryLive } from '../../src/inventory/loader.ts'
import { MemoryFileSystem } from '../../src/testing/memory-fs.ts'
import type { LocatedSkillFile } from '../../src/types.ts'

function run<A, E>(
  fs: MemoryFileSystem,
  located: LocatedSkillFile[],
  effect: Effect.Effect<A, E, SkillInventory>,
): Promise<A> {
  const locatorLayer = Layer.succeed(SkillLocator, SkillLocator.of({ findSkillFiles: () => Effect.succeed(located) }))
  const layer = SkillInventoryLive(new SimpleFrontmatterCodec()).pipe(
    Layer.provide(locatorLayer),
    Layer.provide(fs.layer),
  )
  return Effect.runPromise(effect.pipe(Effect.provide(layer)))
}

describe('SkillInventory', () => {
  test('sorts records and preserves per-file diagnostics and editability', async () => {
    //given
    const validPath = '/skills/zulu/SKILL.md'
    const noFrontmatterPath = '/skills/alpha/SKILL.md'
    const missingPath = '/skills/bravo/SKILL.md'
    const fs = new MemoryFileSystem(
      new Map([
        [validPath, '---\nname: zulu\ndescription: Zulu skill.\n---\n'],
        [noFrontmatterPath, '# Alpha\n'],
      ]),
    )
    const located: LocatedSkillFile[] = [
      { filePath: validPath, source: { kind: 'user', root: '/skills' }, editable: true },
      { filePath: missingPath, source: { kind: 'user', root: '/skills' }, editable: true },
      { filePath: noFrontmatterPath, source: { kind: 'user', root: '/skills' }, editable: true },
    ]
    //when
    const records = await run(
      fs,
      located,
      SkillInventory.use((inventory) => inventory.load('/repo')),
    )

    //then
    assert.deepEqual(
      records.map((record) => record.name),
      ['alpha', 'bravo', 'zulu'],
    )
    assert.equal(records[0]?.editable, false)
    assert.equal(records[0]?.diagnostics[0]?.message, 'Missing YAML front matter')
    assert.equal(records[1]?.editable, false)
    assert.match(records[1]?.diagnostics[0]?.message ?? '', /missing file/)
    assert.equal(records[2]?.editable, true)
    assert.equal(records[2]?.diagnostics.length, 0)
  })
})
