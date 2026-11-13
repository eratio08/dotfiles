import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream no-manual-tagged-construction examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-effect-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  try {
    if (!installedRoot) {
      for (const file of ['no-manual-tagged-construction.ts', 'shared.ts', 'tagged-values.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({
          root: true,
          plugins: ['./no-manual-tagged-construction.ts'],
          linter: { rules: { preset: 'none' } },
        }),
      )
    }
    const cases: Array<[string, number]> = [
      ['Match.when({ _tag: "Ready" }, handleReady);', 0],
      ['Match.not({ "_tag": "Pending" });', 0],
      ['Ready.make({ value });', 0],
      ['new NotFound({ id });', 0],
      ['({ _tag: tag, value });', 0],
      ['const value = { _tag: "Ready", payload };', 1],
      ['const value = { ["_tag"]: "Ready" };', 1],
      ['const x = { _tag: 1 };', 0],
      ['Match.when({ _tag: "Ready" }, action);', 0],
      ['const x = { _tag: "Ready", value: { _tag: "Inner" } };', 2],
    ]
    await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'instead of writing a literal')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
