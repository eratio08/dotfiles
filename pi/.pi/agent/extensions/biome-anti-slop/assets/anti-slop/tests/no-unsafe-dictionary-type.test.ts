import { expect, test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream unsafe dictionary examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-dictionary-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')

  try {
    if (!installedRoot) {
      for (const file of ['no-unsafe-dictionary-type.ts', 'widening-types.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({
          root: true,
          plugins: ['./no-unsafe-dictionary-type.ts'],
          linter: { rules: { preset: 'none' } },
        }),
      )
    }

    const cases: Array<[string, number]> = [
      ['type Commands = Record<string, Command>;', 0],
      ['type Metadata = Record<PropertyKey, JsonValue>;', 0],
      ['type PermissionLevels = Record<Permission, number>;', 0],
      ['type Indexed = { [key: string]: Command };', 0],
      ['type CompatibleIndexes = { [index: number]: Command; [key: string]: Command | OtherCommand };', 0],
      ['type Exhaustive = { [K in Permission]: number };', 0],
      ['type Allowed = Record<string, { payload: unknown }>;', 0],
      ['type AlsoAllowed = Record<string, Result<Data, unknown>>;', 0],
      ['type Index<T> = Record<string, T>; type EntityIndex<T extends Entity> = Record<string, T>;', 0],
      ['type Safe = Index<Command>; type Index<T> = Record<string, T>;', 0],
      ['type A = Map<string, unknown>; type B = ReadonlyMap<string, unknown>; type C = WeakMap<object, unknown>;', 0],
      ["import { Record } from './local'; type A = Record<string, unknown>;", 0],
      ['type Record<K, V> = { key: K; value: V }; type A = Record<string, unknown>;', 0],
      ['type Readonly<T> = { value: T }; type A = Record<string, Readonly<unknown>>;', 0],
      ['type NonNullable<T> = { value: T }; type A = Record<string, NonNullable<unknown>>;', 0],
      ['type Value<T> = T; type Index<T = Command, U = Value<T>> = Record<string, U>; type A = Index;', 0],
      ['interface Owner { readonly id: string } type A = Record<string, unknown & Owner>;', 0],
      ['interface Owner { readonly id: string } interface Child extends Owner {} type A = Record<string, Child>;', 0],
      [
        'interface Owner { readonly id: string } interface Child extends Owner { readonly __brand?: never } type A = Record<string, Child>;',
        0,
      ],
      ['interface Escape {} interface Escape { readonly id: string } type A = Record<string, Escape>;', 0],
      ['interface Escape { readonly id: string } interface Escape {} type A = Record<string, Escape>;', 0],
      ['interface Owner { readonly id: string } type A = Record<string, object & Owner>;', 0],
      [
        'type Wrap<T> = { readonly wrapped: T }; type Inner<T, U> = { readonly value: T } & Wrap<U>; type Outer<T, U> = Record<string, Inner<T, U>>; declare function f<T, U>(): Outer<T, U>;',
        0,
      ],
      ['type WithSchema<T extends Record<string, unknown>> = (schema: T) => void;', 0],
      ['function run<T extends Record<string, unknown>>(input: T): T { return input; }', 0],
      ['declare class Store<T extends Record<string, unknown>> { read(): T }', 0],
      ['type Deep<T extends Readonly<Record<string, unknown>>> = T;', 0],
      ['type A = Record<string, unknown>;', 1],
      ['type A = { [key: string]: any };', 1],
      ['type A = { [index: number]: Command; [key: string]: unknown | Command };', 1],
      ['type A = { [K in PropertyKey]: object };', 1],
      ['type A = { [K in PropertyKey]: NonNullable<unknown> };', 1],
      ['type A = { [key: string]: NonNullable<unknown> };', 1],
      ['type A = Record<string, {}>;', 1],
      ['interface Escape {} type A = Record<string, Escape>;', 1],
      ['interface Escape { readonly __brand?: never } type A = Record<string, Escape>;', 1],
      ['type Escape = { readonly __brand?: never }; type A = Record<string, Escape>;', 1],
      ['type A = Record<string, { readonly __brand?: never }>;', 1],
      ['type A = Record<string, string | unknown>;', 1],
      ['interface Escape {} type A = Record<string, string | Escape>;', 1],
      ['type A = Record<string, unknown & {}>;', 1],
      ['interface Owner { readonly id: string } type A = Record<string, any & Owner>;', 1],
      ['type Escape = unknown; type A = Record<string, Escape>;', 1],
      ['type Dict = Record<string, unknown>;', 1],
      ['type A = Readonly<Partial<Required<(Record<string, unknown>)>>>;', 1],
      ['type A = { readonly [key: string]: unknown };', 1],
      ['type A = { readonly [K in string]: unknown };', 1],
      ['type Source = Record<string, unknown>; type A = Pick<Source, string>;', 2],
      ['type Source = Record<string, unknown>; type A = Omit<Source, never>;', 2],
      ['type Index<T> = Record<string, T>; type A = Index<unknown>;', 1],
      ['interface A { [key: string]: unknown }', 1],
      ['type A = Readonly<Record<string, unknown>>;', 1],
      ['type A = Record<string, Readonly<unknown>>;', 1],
      ['type A = Record<string, Partial<unknown>>;', 1],
      ['type A = Record<string, Required<unknown>>;', 1],
      ['type Escape = Readonly<unknown>; type A = Record<string, Escape>;', 1],
      ['type Wrapped<T> = Readonly<T>; type A = Record<string, Wrapped<unknown>>;', 1],
      ['type A = Record<string, NonNullable<unknown>>;', 1],
      ['type Escape = NonNullable<unknown>; type A = Record<string, Escape>;', 1],
      ['type Unsafe = Record<string, unknown>; const x: Unsafe = {}; const y: Unsafe = {};', 1],
      ['type Unsafe = Record<string, unknown>; type AlsoUnsafe = Unsafe; const x: Unsafe = {};', 2],
      ['type Index<T = unknown> = Record<string, T>; type A = Index;', 1],
      ['type Index<T, U = T> = Record<string, U>; type A = Index<string, unknown>;', 1],
      ['type Index<T, U = T> = Record<string, U>; type A = Index<unknown>;', 1],
      ['type Value<T> = T; type Index<T, U = Value<T>> = Record<string, U>; type A = Index<unknown>;', 1],
      [
        'type Marker<T> = { readonly __brand?: never }; type Index<T, U = Marker<T>> = Record<string, U>; type A = Index<Item>;',
        1,
      ],
      ['function outer() { type Identity<T> = T; type A = Record<string, Identity<unknown>>; }', 1],
      [
        'function local() { type Record<K, V> = { key: K; value: V }; type A = Record<string, unknown>; } function global() { type A = Record<string, unknown>; }',
        1,
      ],
    ]

    cases.push(
      ["type A = Record<'a' | 'b', unknown>;", 1],
      ['class Store { [key: string]: unknown }', 1],
      ['function f<T extends { [key: string]: unknown }>(input: T) { return input; }', 0],
      ['type Unsafe = Record<string, unknown>; type X = Record<string, Unsafe>;', 2],
      ['type Nested = Record<string, Record<string, unknown>>;', 1],
    )

    const messages = await expectBiomeCases(
      biome,
      installedRoot ?? temp,
      temp,
      cases,
      'value type gives callers no concrete value contract',
    )
    const values = {
      'type A = Record<string, unknown>;': 'unknown',
      'type A = { [key: string]: any };': 'any',
      'type A = Record<string, {}>;': 'empty-object',
      'type A = { [K in PropertyKey]: object };': 'object',
      'type A = Record<string, string | unknown>;': 'union',
    }
    for (const [source, value] of Object.entries(values)) {
      expect(messages.get(source)).toContain(`dictionary's ${value} value type`)
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 20000)
