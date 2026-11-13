import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream no-chained-type-assertions examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-syntax-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  try {
    if (!installedRoot) {
      for (const file of ['no-chained-type-assertions.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({
          root: true,
          plugins: ['./no-chained-type-assertions.ts'],
          linter: { rules: { preset: 'none' } },
        }),
      )
    }
    const cases: Array<[string, number]> = [
      ['const value = input as User;', 0],
      ['const value = (input as User);', 0],
      ['const value = ({ id: 1 } as const) as const;', 0],
      ['const value = input as unknown as User;', 1],
      ['const value = (input as unknown) as User;', 1],
      ['const value = <User>(<unknown>input);', 1],
      ['const value = ({ id: 1 } as const) as User;', 1],
      ['const a = (((x as unknown))) as Foo as Bar;', 1],
      ['const a = (({x:1} as const) as const) as const;', 0],
      ['const a = <Foo>(<unknown>x);', 1],
    ]
    await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'This assertion chain discards')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
