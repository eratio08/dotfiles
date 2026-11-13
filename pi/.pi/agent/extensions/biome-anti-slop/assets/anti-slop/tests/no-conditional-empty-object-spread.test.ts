import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream no-conditional-empty-object-spread examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-syntax-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  try {
    if (!installedRoot) {
      for (const file of ['no-conditional-empty-object-spread.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({
          root: true,
          plugins: ['./no-conditional-empty-object-spread.ts'],
          linter: { rules: { preset: 'none' } },
        }),
      )
    }
    const cases: Array<[string, number]> = [
      ['const result = { value };', 0],
      ['const result = { ...values };', 0],
      ['const result = condition ? { value } : {};', 0],
      ['const result = { ...(value !== undefined ? { value } : {}) };', 1],
      ['const result = { ...(condition ? {} : { value }) };', 1],
      ['const a = [...(condition ? {} : {x: 1})];', 0],
      ['const a = { ...((condition ? {} : {x:1})) };', 1],
      ['const a = { ...(condition ? {x:1} : {y:2}) };', 0],
      ['const a = { ...(condition ? { /* comment */ } : {x:1}) };', 1],
    ]
    await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'This conditional spread hides')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
