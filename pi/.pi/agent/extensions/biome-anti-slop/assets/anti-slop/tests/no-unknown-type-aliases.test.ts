import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream no-unknown-type-aliases examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-return-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  try {
    if (!installedRoot) {
      for (const file of ['no-unknown-type-aliases.ts', 'widening-types.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({
          root: true,
          plugins: ['./no-unknown-type-aliases.ts'],
          linter: { rules: { preset: 'none' } },
        }),
      )
    }
    const cases: Array<[string, number]> = [
      ['type User = { readonly id: string };', 0],
      ['type Alias = string; type UserId = Alias;', 0],
      ['type Payload = string | number;', 0],
      ['type Box<T> = { readonly value: T }; type Payload = Box<unknown>;', 0],
      ['type Alias = unknown;', 1],
      ['type Current = unknown;', 1],
      ['type UnknownValue = unknown; type Alias = UnknownValue;', 2],
      ['type Payload = string | unknown;', 1],
      ['type Payload = string | unknown; type NestedPayload = number | Payload;', 2],
      ['type Identity<T> = T; type Payload = Identity<unknown>;', 1],
      ['type Identity<T> = T; type Wrapped<T> = Identity<T>; type Payload = Wrapped<unknown>;', 1],
      ['function outer() { type Payload = unknown; }', 1],
    ]
    cases.push(
      ['type A = B; type B = A;', 0],
      ['type Box<T = unknown> = T; type Result = Box;', 1],
      ['type A = A | unknown;', 1],
    )

    await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'hides `unknown`')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
