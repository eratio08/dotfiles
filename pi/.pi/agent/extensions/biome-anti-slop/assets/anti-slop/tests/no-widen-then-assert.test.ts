import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should detect immutable local widen-then-assert flows', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-widen-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')

  try {
    if (!installedRoot) {
      for (const file of ['no-widen-then-assert.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({ root: true, plugins: ['./no-widen-then-assert.ts'], linter: { rules: { preset: 'none' } } }),
      )
    }

    const cases: Array<[string, number | boolean]> = [
      ["const source = { id: 'first' }; const widened: unknown = source;", false],
      ['declare const input: unknown; const parsed = input as { readonly id: string };', false],
      [
        "const source = { id: 'second' }; const widened: unknown = source; const parsed = widened as { readonly id: string };",
        true,
      ],
      ['const value: unknown = {}; const parsed = value as { id: string };', true],
      ['const value = {} as unknown; const parsed = <{ id: string }>value;', true],
      ['const value: any = []; const parsed = value as number[];', true],
      ['const value: object = []; const parsed = value as number[];', true],
      ['const value: object = []; const parsed = value as string;', false],
      ['const value: Record<string, unknown> = {}; const parsed = value as Record<string, number>;', true],
      ['const value: { [key: string]: unknown } = {}; const parsed = value as { id: number };', true],
      ['const value: Readonly<Record<string, unknown>> = {}; const parsed = value as { id: number };', true],
      ['const value: Record<string, unknown> = {}; const parsed = value as object;', false],
      ['const value: unknown = {}; const parsed = value as unknown;', false],
      ['let value: unknown = {}; const parsed = value as { id: string };', false],
      ['const value: unknown = {}; function read() { return value as { id: string }; }', false],
      ['function make() { const value: unknown = {}; return value as { id: string }; }', true],
      [
        'function make() { const source = {}; function read() { const value: unknown = source; return value as { id: string }; } }',
        false,
      ],
      ['const parsed = value as { id: string }; const value: unknown = {};', false],
      [
        'const source: { id: string } = get(); const value: unknown = source; const parsed = value as { id: string };',
        true,
      ],
      ['const source: unknown = get(); const value: unknown = source; const parsed = value as { id: string };', false],
      [
        'const source = {}; const alias = source; const value: unknown = alias; const parsed = value as { id: string };',
        true,
      ],
      [
        'let source = {}; source = other; const value: unknown = source; const parsed = value as { id: string };',
        false,
      ],
      ['const value: unknown = {}; { const value: unknown = get(); const parsed = value as { id: string }; }', false],
      ['const value: unknown = {}; const first = value as { id: string }; const second = value as { id: string };', 2],
      [
        '{ const value: unknown = {}; { const value: unknown = {}; const first = value as { id: string }; } const second = value as { id: string }; }',
        2,
      ],
      [
        'const first = value as { id: string }; const value: unknown = {}; const second = value as { id: string };',
        false,
      ],
      [
        'const value: unknown = {}; const first = value as { id: string }; { const value: unknown = {}; const second = value as { id: string }; }',
        false,
      ],
    ]

    await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'discards type evidence')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
