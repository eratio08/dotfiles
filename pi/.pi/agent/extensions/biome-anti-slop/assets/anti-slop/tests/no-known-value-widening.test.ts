import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream known-value widening examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-known-widen-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')

  try {
    if (!installedRoot) {
      for (const file of ['no-known-value-widening.ts', 'widening-types.ts', 'array-method.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({
          root: true,
          plugins: ['./no-known-value-widening.ts'],
          linter: { rules: { preset: 'none' } },
        }),
      )
    }

    const cases: Array<[string, number]> = [
      [
        'type Fields = Record<string, string>; function parse(): Fields { const fields: Fields = {}; fields.name = "x"; return fields; }',
        0,
      ],
      ['function parse(): unknown { const value: string = "x"; return value; }', 1],
      [
        'type Fields<T> = Record<string, T>; function parse(): Fields<unknown> { const value: Fields<string> = {}; return value; }',
        1,
      ],
      [
        'type Fields = unknown; function parse(): Fields { type Fields = string; const value: Fields = "x"; return value; }',
        1,
      ],
      [
        'type Fields = Record<string, string>; function parse(): Fields { const fields: Fields = { name: "x" }; return fields; }',
        1,
      ],
      ['type Command = () => void; const startCommand = () => {}; const commands: Record<string, Command> = {};', 0],
      [
        'type Command = () => void; const startCommand = () => {}; type Index<T> = Record<string, T>; const commands: Index<Command> = {};',
        0,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; class Registry { commands: Record<string, Command> = {}; }',
        0,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; class Registry { accessor commands: Record<string, Command> = {}; }',
        0,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; let commands: Record<string, Command>; commands = {};',
        0,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; function create(): Record<string, Command> { return {}; }',
        0,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; const create = (): Record<string, Command> => ({});',
        0,
      ],
      ['type Command = () => void; const startCommand = () => {}; const commands = {} as Record<string, Command>;', 0],
      ['type Command = () => void; const startCommand = () => {}; const commands = <Record<string, Command>>{};', 0],
      ['type Command = () => void; const startCommand = () => {}; const commands = { start: startCommand };', 0],
      [
        'type Command = () => void; const startCommand = () => {}; const commands = { start: startCommand } as const;',
        0,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; const commands = { start: startCommand } satisfies Record<string, Command>;',
        0,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; type Commands = Record<string, Command>; const commands = { start: startCommand } as const satisfies Commands;',
        0,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; interface Commands { readonly start: Command } const commands: Commands = { start: startCommand };',
        0,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; type Commands = { readonly start: Command }; const commands: Commands = { start: startCommand };',
        0,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; type PermissionLevels = { readonly [Level in Permission]: number }; const levels: PermissionLevels = { admin: 1 };',
        0,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; function create() { return { start: startCommand }; }',
        0,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; interface Commands { readonly start: Command } function create(): Commands { return { start: startCommand }; }',
        0,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; declare function make(): Record<string, Command>; const commands: Record<string, Command> = make();',
        0,
      ],
      [
        "type Command = () => void; const startCommand = () => {}; import { Commands } from './types'; const commands: Commands = { start: startCommand };",
        0,
      ],
      [
        "type Command = () => void; const startCommand = () => {}; type Diet = 'vegan' | 'omnivore'; const labels: Record<Diet, string> = { vegan: 'V', omnivore: 'O' };",
        0,
      ],
      [
        "type Command = () => void; const startCommand = () => {}; type Diet = 'vegan' | 'omnivore'; type Labels = Record<Diet, string>; const labels: Labels = { vegan: 'V', omnivore: 'O' };",
        0,
      ],
      [
        "type Command = () => void; const startCommand = () => {}; type Diet = 'vegan' | 'omnivore'; const labels: Readonly<Record<Diet, string>> = { vegan: 'V', omnivore: 'O' };",
        0,
      ],
      [
        "type Command = () => void; const startCommand = () => {}; const labels: Record<'a' | 'b', number> = { a: 1, b: 2 };",
        0,
      ],
      [
        "type Command = () => void; const startCommand = () => {}; type Index<Key extends PropertyKey, Value> = Record<Key, Value>; const commands: Index<'start', Command> = { start: startCommand };",
        0,
      ],
      [
        'function isString(value: unknown): value is string { return true; } declare const input: unknown; isString(input);',
        0,
      ],
      [
        'function isString(value: string | unknown): value is string { return true; } declare const input: string | unknown; isString(input);',
        0,
      ],
      [
        'function isString(value: unknown): value is string { return true; } declare function readInput(): unknown; isString(readInput());',
        0,
      ],
      ['const value: unknown = {};', 1],
      ['const value: object = {};', 1],
      ['let value: unknown; value = {};', 1],
      ['function create(): unknown { return {}; }', 1],
      [
        'type Command = () => void; const startCommand = () => {}; const commands: Record<string, Command> = { start: startCommand };',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; const commands: { [key: string]: Command } = { start: startCommand };',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; const commands: { [K in string]: Command } = { start: startCommand };',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; const commands: { start: Command } = { start: startCommand };',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; const commands = { start: startCommand } as Record<string, Command>;',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; const commands = ({ start: startCommand } as Record<string, Command>) as object;',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; class Registry { commands: Record<string, Command> = { start: startCommand }; }',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; let commands: Record<string, Command>; commands = { start: startCommand };',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; function create(): Record<string, Command> { return { start: startCommand }; }',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; function create(): { start: Command } { return { start: startCommand }; }',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; const source = { start: startCommand }; const commands: Record<string, Command> = source;',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; type Open = Record<string, Command>; const source = { start: startCommand }; const commands: Open = source;',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; type Open = { [key: string]: Command }; const source = { start: startCommand }; const commands: Open = source;',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; type Open = { [key in string]: Command }; const source = { start: startCommand }; const commands: Open = source;',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; type Open = Readonly<Record<string, Command>>; const source = { start: startCommand }; const commands: Open = source;',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; function outer() { type Open = Record<string, Command>; const commands: Open = { start: startCommand }; }',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; type Index<T> = Record<string, T>; const commands: Index<Command> = { start: startCommand };',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; type Identity<T> = T; const commands: Identity<Record<string, Command>> = { start: startCommand };',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; type Index<T> = Record<string, T>; type CommandsByName = Index<Command>; const commands: CommandsByName = { start: startCommand };',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; type Index<T = Command> = Record<string, T>; const commands: Index = { start: startCommand };',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; type Key = string; const commands: Record<Key, Command> = { start: startCommand };',
        1,
      ],
      [
        'type Command = () => void; const startCommand = () => {}; const commands: Record<PropertyKey, Command> = { start: startCommand };',
        1,
      ],
      [
        "type Command = () => void; const startCommand = () => {}; const commands: Record<string | 'start', Command> = { start: startCommand };",
        1,
      ],
      ['const value: unknown = 1;', 1],
      ['const value: object = [];', 1],
      ["function isString(value: unknown): value is string { return true; } isString('known');", 1],
      [
        "function isString(value: unknown): value is string { return true; } const known = 'known'; isString(known);",
        1,
      ],
      ["function isString(value: string | unknown): value is string { return true; } isString('known');", 1],
      [
        'function isString(value: unknown): value is string { return true; } function check(known: string): boolean { return isString(known); }',
        1,
      ],
      [
        'const isString = (value: unknown): value is string => true; const known: string = getValue(); isString(known);',
        1,
      ],
      [
        "type User = { readonly id: string }; function isUser(value: unknown): value is User { return true; } function parse(): User { return { id: 'known' }; } const user = parse(); isUser(user);",
        1,
      ],
    ]

    cases.push(
      ['type Record<K, V> = { value: V }; const x: Record<string, number> = { value: 1 };', 0],
      ['type T = Record<string, number>; function f() { type T = { value: number }; const x: T = { value: 1 }; }', 0],
      ['type T = { value: number }; function f() { type T = Record<string, number>; const x: T = { value: 1 }; }', 1],
      ["type Key = 'a' | 'b'; const x: Record<Key, number> = { a: 1, b: 2 };", 0],
      [
        'interface Empty {} declare const value: Empty; function guard(v: unknown): v is number { return true; } guard(value);',
        0,
      ],
      [
        'type Empty = { value?: never }; declare const value: Empty; function guard(v: unknown): v is number { return true; } guard(value);',
        0,
      ],
      [
        'type Top = any; declare const value: Top & number; function guard(v: unknown): v is number { return true; } guard(value);',
        0,
      ],
      ['function outer(): unknown { const x = { get item() { return {}; } }; return input; }', 0],
      ['function outer(): unknown { const x = { get item(): unknown { return {}; } }; return input; }', 1],
    )

    cases.push(
      [
        'interface Info {} interface Info { id: string } declare const value: Info; function guard(v: unknown): v is number { return true; } guard(value);',
        1,
      ],
      [
        'interface Info { id: string } interface Info {} declare const value: Info; function guard(v: unknown): v is number { return true; } guard(value);',
        1,
      ],
    )

    await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'discards known type evidence')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 20000)
