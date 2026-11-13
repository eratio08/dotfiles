import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream no-reflect-get examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-syntax-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  try {
    if (!installedRoot) {
      for (const file of ['no-reflect-get.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({ root: true, plugins: ['./no-reflect-get.ts'], linter: { rules: { preset: 'none' } } }),
      )
    }
    const cases: Array<[string, number]> = [
      ['const value = owner.property;', 0],
      ['const value = owner[key];', 0],
      ['Reflect.set(owner, key, value);', 0],
      ['const Reflect = { get() { return 1; } }; Reflect.get();', 0],
      ['function read(Reflect: { get(): number }) { return Reflect.get(); }', 0],
      ['const value = Reflect.get(owner, key);', 1],
      ["const value = Reflect['get'](owner, key);", 1],
      ["(Reflect['g\\u0065t'])(owner, key);", 1],
      ['function f(Reflect: any) { return Reflect.get(a,b); }', 0],
      ['Reflect[key](a,b);', 0],
    ]
    await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'Replace `Reflect.get`')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
