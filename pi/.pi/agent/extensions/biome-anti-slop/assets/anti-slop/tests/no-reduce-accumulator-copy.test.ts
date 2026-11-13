import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream reducer copy examples given the vendored Biome plugin', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-reducer-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')

  try {
    if (!installedRoot) {
      for (const file of ['no-reduce-accumulator-copy.ts', 'reducer.ts', 'array-method.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({
          root: true,
          plugins: ['./no-reduce-accumulator-copy.ts'],
          linter: { rules: { preset: 'none' } },
        }),
      )
    }

    const cases: Array<[string, boolean]> = [
      ['items.reduce((acc, item) => { acc.push(item); return acc; }, []);', false],
      ['items.reduce((acc, item) => Object.assign(acc, item), {});', false],
      ['items.reduce((acc, item) => Object.assign(acc, acc, item), {});', false],
      ['items.reduce((acc, item) => { acc[item.id] = { ...item }; return acc; }, {});', false],
      ['items.reduce((acc, item) => { acc.push(Object.assign({}, item)); return acc; }, []);', false],
      ['items.reduce((acc, item) => { acc.push(item.slice()); return acc; }, []);', false],
      ["items.reduce((acc, item) => acc.concat(item), '');", false],
      ['items.reduce((acc, item) => acc.concat(item), customCollection);', false],
      ['function copy(acc) { return Object.assign({}, acc); }', false],
      ['items.map((acc, item) => Object.assign({}, acc));', false],
      ['items.reduce(initial, (acc, item) => Object.assign({}, acc, item));', false],
      ['items.reduce(wrap((acc, item) => Object.assign({}, acc, item)), {});', false],
      [
        'items.reduce((acc, item) => { function copy(acc) { return Object.assign({}, acc); } return acc; }, {});',
        false,
      ],
      ['items.reduce((acc, item) => { const snapshot = () => Object.assign({}, acc); return acc; }, {});', false],
      ['items.reduce((acc, item) => { { const acc = {}; Object.assign({}, acc); } return acc; }, {});', false],
      ['const Object = custom; items.reduce((acc, item) => Object.assign({}, acc), {});', false],
      ['function run(Object) { return items.reduce((acc, item) => Object.assign({}, acc), {}); }', false],
      ['const Array = custom; items.reduce((acc, item) => Array.from(acc), []);', false],
      ['items.reduce((acc, item) => { let alias = acc; alias = item; return Object.assign({}, alias); }, {});', false],
      ['items.reduce((acc, item) => [...acc, item], []);', false],
      ['items.reduce((acc, item) => ({ ...acc, [item.id]: item }), {});', false],
      ['items.reduce((acc, item) => Object.assign({}, acc, { [item.id]: item }), {});', true],
      ['items.reduceRight((acc, item) => Object.assign({}, acc, item), {});', true],
      ['items.reduce((acc, item, index, array) => Object.assign({}, acc, item), {});', true],
      ['items.reduce(acc => Object.assign({}, acc), {});', true],
      ['items.reduce(function (acc, item) { return Object.assign({}, item, acc); }, {});', true],
      ["items['reduce'](((acc, item) => Object['assign']({}, acc, item)), {});", true],
      ['items.reduce((acc = {}, item) => Object.assign({}, acc, item), {});', true],
      ['items.reduce((acc, item) => { const alias = acc; return Object.assign({}, alias, item); }, {});', true],
      ['items.reduce((acc, item) => Object.assign({}, acc as State, item), {});', true],
      [
        'items.reduce((acc, item) => { const next = Object.assign({}, acc); next[item.id] = item; return next; }, {});',
        true,
      ],
      ['items.reduce((acc, item) => acc.concat([item]), []);', true],
      ["items.reduceRight((acc, item, index) => acc['concat']([item]), [] as Item[]);", true],
      ['items.reduce((acc, item) => { const next = acc.slice(); next.push(item); return next; }, []);', true],
      ['items.reduce((acc, item) => { const alias = acc; return alias.concat(item); }, []);', true],
      ['const initial = []; items.reduce((acc, item) => acc.concat(item), initial);', true],
      ['items.reduce((acc, item) => { const next = Array.from(acc); next.push(item); return next; }, []);', true],
      ['items.reduce((acc, item) => acc.toSpliced(acc.length, 0, item), []);', true],
      ['items.reduce((acc, item) => acc.toSorted(), []);', true],
      ['items.reduce((acc, item) => acc.toReversed(), []);', true],
      ['items.reduce((acc, item) => acc.with(0, item), []);', true],
    ]

    await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'Do not copy the reducer accumulator')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
