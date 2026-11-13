import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream no-manual-tag-comparison examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-effect-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  try {
    if (!installedRoot) {
      for (const file of ['no-manual-tag-comparison.ts', 'shared.ts', 'tagged-values.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({
          root: true,
          plugins: ['./no-manual-tag-comparison.ts'],
          linter: { rules: { preset: 'none' } },
        }),
      )
    }
    const cases: Array<[string, number]> = [
      ['Predicate.isTagged("Ready")(value);', 0],
      ['Match.value(value).pipe(Match.tag("Ready", handleReady));', 0],
      ['if (value.status === "Ready") handleReady(value);', 0],
      ['Effect.catch((error) => error._tag === "NotFound" ? recover : fail);', 0],
      ['value._tag === "Ready";', 1],
      ['"Ready" !== value["_tag"];', 1],
      ['switch (value._tag) { case "Ready": handleReady(value); }', 1],
      ['Effect.catch(error => error.reason["_tag"] !== "Bad");', 0],
      ['Effect.catchTag("X", error => error._tag === "Bad");', 1],
      ['x._tag === other;', 0],
    ]
    await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'Use Match.')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
