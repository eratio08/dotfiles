import { expect, test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream no-unknown-parameters examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-parameter-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  try {
    if (!installedRoot) {
      for (const file of ['no-unknown-parameters.ts', 'parameter-contract.ts', 'widening-types.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({ root: true, plugins: ['./no-unknown-parameters.ts'], linter: { rules: { preset: 'none' } } }),
      )
    }
    const cases: Array<[string, number]> = [
      ['function enrich(cause: unknown): void {}', 0],
      ['function enrich(cause: Error | unknown): void {}', 0],
      ['function isString(value: unknown): value is string { return true; }', 0],
      ['const isString = (value: unknown): value is string => true;', 0],
      ['function assertString(value: unknown): asserts value is string {}', 0],
      ['type Guard = (value: unknown) => value is string;', 0],
      ['declare function isString(value: unknown): value is string;', 0],
      ['type Guards = { isString(value: unknown): value is string };', 0],
      ['function parse(value: string | number): void {}', 0],
      ['function parse(value: unknown): void {}', 1],
      ['function parse(value: string | unknown): void {}', 1],
      ['function parse(value: string | (number | unknown)): void {}', 1],
      ['function isString(value: unknown, context: unknown): value is string { return true; }', 1],
      ['export function parse({ value }: unknown = {}): void {}', 1],
    ]
    cases.push(
      ['function assertValue(value: unknown): asserts value {}', 0],
      ['class X { constructor(private cause: unknown) {} }', 0],
      ['type Alias = unknown; function f(value: Alias): void {}', 0],
      ['function f(...values: unknown): void {}', 1],
    )

    const messages = await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'leaves input unparsed')
    for (const [source] of cases) {
      if (source.includes('{ value }:')) expect(messages.get(source)).toContain('Parameter `{ value }`')
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
