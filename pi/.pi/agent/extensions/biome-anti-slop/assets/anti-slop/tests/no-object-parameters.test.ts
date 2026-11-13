import { expect, test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream no-object-parameters examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-parameter-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  try {
    if (!installedRoot) {
      for (const file of ['no-object-parameters.ts', 'parameter-contract.ts', 'widening-types.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({ root: true, plugins: ['./no-object-parameters.ts'], linter: { rules: { preset: 'none' } } }),
      )
    }
    const cases: Array<[string, number]> = [
      ['type Alias = object;', 0],
      ['function f(value: Alias) {}', 0],
      ['interface Owner { readonly id: string } function f(value: Owner) {}', 0],
      ['function f<Value>(value: Value) {}', 0],
      ['function f<Value extends object>(value: Value) {}', 0],
      ['function f<Value extends Owner, Owner extends { readonly id: string }>(value: Value) {}', 0],
      ['type Owner = { readonly id: string }; function f<Value extends Owner>(value: Value) {}', 0],
      ['type Alias = object; function consume<Alias>(value: Alias) {}', 0],
      ['type Alias = object; type Consumer<Alias> = (value: Alias) => void;', 0],
      ['type Alias = object; interface Consumer<Alias> { consume(value: Alias): void }', 0],
      ['type Key = object; type Mapped<Input> = { [Key in keyof Input]: (value: Key) => void };', 0],
      [
        'type Item = object; type Unpacked<Input> = Input extends Promise<infer Item> ? (value: Item) => void : never;',
        0,
      ],
      [
        'type Payload = object; function outer() { type Payload = { readonly id: string }; function consume(value: Payload) {} }',
        0,
      ],
      ['type Identity<T> = T; function consume<Identity>(value: Identity) {}', 0],
      ['function one() { type Payload = object; } function two() { function consume(value: Payload) {} }', 0],
      ['function f(value: object) {}', 1],
      ['type Alias = object; function f(value: Alias) {}', 1],
      ['type Alias = (object); function f(value: Alias) {}', 1],
      ['type Item = object; type Fallback<Input> = Input extends infer Item ? string : (value: Item) => void;', 1],
      ['function consume(value: object = {}): void {}', 1],
      ['function consume({ value }: object = {}): void {}', 1],
      ['type Bag = object; function consume({ value }: Bag): void {}', 1],
      ['function outer() { type Payload = object; function consume(value: Payload) {} }', 1],
      ['function outer() { function consume(value: Payload) {} type Payload = object; }', 1],
      ['type Identity<T> = T; function consume(value: Identity<object>) {}', 1],
      ['type Identity<T> = T; type Wrapped<T> = Identity<T>; function consume(value: Wrapped<object>) {}', 1],
    ]
    cases.push(
      ['function f(...values: object): void {}', 1],
      ['type Identity<T = object> = T; function f(value: Identity): void {}', 1],
      ['type A = B; type B = A; function f(value: A): void {}', 0],
    )

    const messages = await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'uses the broad')
    for (const [source] of cases) {
      if (source.includes('{ value }:')) expect(messages.get(source)).toContain('Parameter `{ value }`')
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
