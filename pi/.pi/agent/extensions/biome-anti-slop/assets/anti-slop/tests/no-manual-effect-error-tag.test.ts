import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream no-manual-effect-error-tag examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-effect-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  try {
    if (!installedRoot) {
      for (const file of ['no-manual-effect-error-tag.ts', 'shared.ts', 'tagged-values.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({
          root: true,
          plugins: ['./no-manual-effect-error-tag.ts'],
          linter: { rules: { preset: 'none' } },
        }),
      )
    }
    const cases: Array<[string, number]> = [
      ['error._tag === "NotFound";', 0],
      ['Effect.catchTag("NotFound", recover);', 0],
      ['Effect.catchTag("Wrapper", (error) => error.reason._tag === "Timeout" ? retry : fail);', 0],
      ['Effect.catch((error) => error._tag === "NotFound" ? recover : fail);', 1],
      ['Effect.catchAll(function (error) { return error.reason._tag === "Timeout" ? retry : fail; });', 1],
      ['Effect.catchIf(predicate, (error) => { switch (error._tag) { case "NotFound": return recover; } });', 1],
      ['Effect.catch(error => { function nested() { return error._tag === "Bad"; } return nested(); });', 1],
      ['Effect.catchTag("X", error => error._tag === "Bad");', 0],
      ['Effect["catch"](error => error._tag === "Bad");', 0],
    ]
    await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'instead of manually discriminating')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
