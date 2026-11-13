import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream prefer-effect-match examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-effect-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  try {
    if (!installedRoot) {
      for (const file of ['prefer-effect-match.ts', 'shared.ts', 'tagged-values.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({ root: true, plugins: ['./prefer-effect-match.ts'], linter: { rules: { preset: 'none' } } }),
      )
    }
    const cases: Array<[string, number]> = [
      ['kind === "a" ? first : fallback;', 0],
      ['kind === "a" ? first : other === "b" ? second : fallback;', 0],
      ['condition ? first : otherCondition ? second : fallback;', 0],
      ['kind === "a" ? first : kind === "b" ? second : fallback;', 1],
      ['kind === "a" ? first : kind === "b" ? second : kind === "c" ? third : fallback;', 1],
      ['kind === "a" ? first : kind === "b" ? second : other === "c" ? third : fallback;', 0],
      ['`a` !== kind ? first : `b` === kind ? second : fallback;', 1],
      ['value === 1 ? a : value === 2 ? b : c;', 1],
      ['value === `a$' + '{x}` ? a : value === "b" ? b : c;', 0],
      ['value === "a" ? a : (value === "b" ? b : c);', 0],
    ]
    await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'Use Match from Effect instead')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
