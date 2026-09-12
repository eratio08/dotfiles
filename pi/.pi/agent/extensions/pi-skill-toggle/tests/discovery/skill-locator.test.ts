import { afterEach, beforeEach, describe, test } from 'bun:test'
import { strict as assert } from 'node:assert'
import { Effect, Layer } from 'effect'
import { SkillLocator, SkillLocatorLive } from '../../src/discovery/skill-locator.ts'
import { MemoryFileSystem } from '../../src/testing/memory-fs.ts'

const originalHome = process.env.HOME
const originalAgentDir = process.env.PI_CODING_AGENT_DIR

function run<A, E>(fs: MemoryFileSystem, effect: Effect.Effect<A, E, SkillLocator>): Promise<A> {
  const layer = SkillLocatorLive.pipe(Layer.provide(fs.layer))
  return Effect.runPromise(effect.pipe(Effect.provide(layer)))
}

describe('SkillLocator', () => {
  beforeEach(() => {
    process.env.HOME = '/home/tester'
    process.env.PI_CODING_AGENT_DIR = '/home/tester/.pi/agent'
  })

  afterEach(() => {
    restoreEnv('HOME', originalHome)
    restoreEnv('PI_CODING_AGENT_DIR', originalAgentDir)
  })

  test('finds global, user, and project skills with Pi root markdown discovery rules', async () => {
    //given
    const fs = new MemoryFileSystem([
      '/home/tester/.pi/agent/skills/user-root.md',
      '/home/tester/.agents/skills/ignored-global-root.md',
      '/home/tester/.agents/skills/global-skill/SKILL.md',
      '/repo/.pi/skills/project-root.md',
      '/repo/.agents/skills/ignored-project-legacy-root.md',
      '/repo/.agents/skills/project-legacy-skill/SKILL.md',
    ])
    //when
    const files = await run(
      fs,
      SkillLocator.use((locator) => locator.findSkillFiles('/repo')),
    )

    //then
    const byPath = new Map(files.map((file) => [file.filePath, file]))
    assert.equal(byPath.get('/home/tester/.pi/agent/skills/user-root.md')?.source.kind, 'user')
    assert.equal(byPath.get('/home/tester/.agents/skills/global-skill/SKILL.md')?.source.kind, 'global')
    assert.equal(byPath.get('/repo/.pi/skills/project-root.md')?.source.kind, 'project')
    assert.equal(byPath.get('/repo/.agents/skills/project-legacy-skill/SKILL.md')?.source.kind, 'project-legacy')
    assert.equal(byPath.has('/home/tester/.agents/skills/ignored-global-root.md'), false)
    assert.equal(byPath.has('/repo/.agents/skills/ignored-project-legacy-root.md'), false)
  })

  test('deduplicates global and project skill roots that resolve to the same directory', async () => {
    //given
    const canonicalSkillRoot = '/home/tester/.dotfiles/home/.agents/skills'
    const fs = new MemoryFileSystem(
      ['/home/tester/.agents/skills/code-review/SKILL.md', `${canonicalSkillRoot}/code-review/SKILL.md`],
      new Map([
        ['/home/tester/.agents/skills', canonicalSkillRoot],
        [canonicalSkillRoot, canonicalSkillRoot],
      ]),
    )
    //when
    const files = await run(
      fs,
      SkillLocator.use((locator) => locator.findSkillFiles('/home/tester/.dotfiles/home')),
    )

    //then
    assert.equal(files.length, 1)
    assert.equal(files[0]?.source.kind, 'global')
  })
})

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
