import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream symbol name examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-symbol-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  try {
    if (!installedRoot) {
      for (const file of ['no-shape-in-symbol-names.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({
          root: true,
          plugins: ['./no-shape-in-symbol-names.ts'],
          linter: { rules: { preset: 'none' } },
        }),
      )
    }
    const cases: Array<[string, number]> = [
      ['declare const schema: ExternalSchema; const field = schema.shape.id;', 0],
      ['declare const outer: External; const value = outer.inner.shape;', 0],
      ["declare const schema: ExternalSchema; schema.shape.id.parse('x');", 0],
      ['const owner = { id: 1 }; const value = owner.id;', 0],
      ['const shape = 1;', 1],
      ['function shapeOf() {}', 1],
      ['type PayloadShape = { id: string };', 1],
      ['type Payload = { shape: string };', 1],
      ["declare const owner: External; const shape = 'field'; const value = owner[shape];", 2],
    ]
    cases.push(
      ['class X { #shape = 1; read() { return this.#shape; } }', 1],
      ['declare const owner: External; owner.shape = 1;', 0],
      ['const owner = { "shape": 1 };', 0],
      ['const owner = { shape: 1 };', 1],
      ['const element = <Shape shape={item} />;', 2],
      [String.raw`const sh\u0061pe = 1;`, 1],
    )

    cases.push(
      ['import { shape as data } from "pkg";', 1],
      ['export { data as shape };', 1],
      ['enum Shape { shape }', 2],
      ['enum Kind { "shape" }', 0],
      ['shape: for (;;) { break shape; }', 2],
    )

    await expectBiomeCases(
      biome,
      installedRoot ?? temp,
      temp,
      cases,
      'describes structure rather than ownership',
      'tsx',
    )
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
