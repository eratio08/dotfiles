import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream no-unknown-returns examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-return-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  try {
    if (!installedRoot) {
      for (const file of ['no-unknown-returns.ts', 'widening-types.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({ root: true, plugins: ['./no-unknown-returns.ts'], linter: { rules: { preset: 'none' } } }),
      )
    }
    const cases: Array<[string, number]> = [
      ['type ImportedValue = unknown;', 0],
      ['function parse(): ImportedValue { return input; }', 0],
      ['function parse(): User { return user; }', 0],
      ['function infer() { return input; }', 0],
      ['function generic<Value>(): Value { return value; }', 0],
      ['type Value = unknown; function generic<Value>(): Value { return value; }', 0],
      ['type Key = unknown; type Mapped<Input> = { [Key in keyof Input]: () => Key };', 0],
      ['type Item = unknown; type Unpacked<Input> = Input extends Promise<infer Item> ? () => Item : never;', 0],
      ['function cause(): { cause: unknown } { return { cause: input }; }', 0],
      ['type Result = { value: unknown }; function load(): Result { return result; }', 0],
      ['function load(): Promise<User> { return promise; }', 0],
      ['type Identity<T> = T; function load(): Identity<User> { return user; }', 0],
      ['type Value = unknown; function outer() { type Value = User; function load(): Value { return user; } }', 0],
      ['function load(): unknown { return input; }', 1],
      ['const load = (): unknown => input;', 1],
      ['type Loader = () => unknown;', 1],
      ['interface Loader { load(): unknown }', 1],
      ['declare function load(): unknown;', 1],
      ['function load(): string | unknown { return input; }', 1],
      ['function load(): Promise<unknown> { return promise; }', 1],
      ['type UnknownValue = unknown; function load(): UnknownValue { return input; }', 1],
      ['type Item = unknown; type Fallback<Input> = Input extends infer Item ? string : () => Item;', 1],
      ['function outer() { type Result = unknown; function load(): Result { return input; } }', 1],
      ['type Identity<T> = T; function load(): Identity<unknown> { return input; }', 1],
      [
        'type Identity<T> = T; type Wrapped<T> = Promise<Identity<T>>; function load(): Wrapped<unknown> { return promise; }',
        1,
      ],
    ]
    cases.push(
      ['type A = B; type B = A; function f(): A { return input; }', 0],
      ['type Box<T = unknown> = T; function f(): Box { return input; }', 1],
      ['function isString(value: unknown): value is string { return true; }', 0],
    )

    await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'This function exposes')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
