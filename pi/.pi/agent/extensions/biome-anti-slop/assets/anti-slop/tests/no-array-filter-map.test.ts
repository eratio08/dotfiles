import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream array pipeline examples given the vendored Biome plugin', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-array-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')

  try {
    if (!installedRoot) {
      for (const file of ['no-array-filter-map.ts', 'array-method.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({ root: true, plugins: ['./no-array-filter-map.ts'], linter: { rules: { preset: 'none' } } }),
      )
    }

    const cases: Array<[string, number]> = [
      ['const users = []; users.values().filter(active).map(email).toArray();', 0],
      ['const users = []; users.values().map(email).filter(Boolean).toArray();', 0],
      ['Iterator.from(users).filter(active).map(email).toArray();', 0],
      ['function collect(users: IteratorObject<User>) { return users.filter(active).map(email).toArray(); }', 0],
      ['const users = []; users.flatMap(user => user.active ? [user.email] : []);', 0],
      ['const users = []; users.map(email); users.filter(active);', 0],
      ['const users = []; users.map(email).map(normalize);', 0],
      ['const users = []; users.filter(active).filter(verified);', 0],
      ['const custom = { filter() { return this; }, map() {} }; custom.filter(active).map(email);', 0],
      ['function collect(unknownReceiver) { return unknownReceiver.filter(active).map(email); }', 0],
      ['const users = fetchUsers(); users.filter(active).map(email);', 0],
      ['const users = []; function collect(users) { return users.filter(active).map(email); }', 0],
      ['let users = []; users = iterator; users.filter(active).map(email);', 0],
      ['const users = []; users[method](active).map(email);', 0],
      ['const first = second; const second = first; first.filter(active).map(email);', 0],
      ['[].filter(active).map(email);', 1],
      ['[].map(user => user.active ? user.email : undefined).filter(email => email !== undefined);', 1],
      ['const users = []; users.map(email).filter(Boolean);', 1],
      ['const users = []; const alias = users; alias.filter(active).map(email);', 1],
      ['function collect(users: User[]) { return users.filter(active).map(email); }', 1],
      ['function collect(users: readonly User[]) { return users.map(email).filter(present); }', 1],
      ['function collect(users: ReadonlyArray<User>) { return users.filter(active).map(email); }', 1],
      ['function collect(users: Array<User>) { return users.filter(active).map(email); }', 1],
      ["const users = [] as const; users['filter'](active)['map'](email);", 1],
      ['const users = []; (users.filter(active)!).map(email);', 1],
      ['const users = []; users?.filter(active)?.map(email);', 1],
      ['const users = []; users.slice().filter(active).map(email);', 1],
      ['const users = []; users.filter(active).map(email).filter(Boolean);', 2],
      ['let users!: User[]; users.filter(active).map(email);', 1],
      ['function collect(users: (readonly User[])) { return users.filter(active).map(email); }', 1],
      [String.raw`const users = []; users['\x66ilter'](active).map(email);`, 1],
      ['const users: User[] = []; users = other; users.filter(active).map(email);', 0],
      [
        'function outer(users: User[]) { function inner(users: IteratorObject<User>) { return users.filter(active).map(email); } }',
        0,
      ],
    ]

    await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'Avoid consecutive array')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
