import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should detect accumulating spreads in reducers and loops', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-spread-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')

  try {
    if (!installedRoot) {
      for (const file of ['no-accumulating-spread.ts', 'reducer.ts', 'array-method.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({ root: true, plugins: ['./no-accumulating-spread.ts'], linter: { rules: { preset: 'none' } } }),
      )
    }

    const cases: Array<[string, boolean]> = [
      ['let x = { ...a }', false],
      ['let x = [ ...a ]', false],
      ['[1,2,3].map(n => ({ ...obj, n }))', false],
      ['arr.map(function (x) { return { ...obj, [x]: x } }, {})', false],
      ['[...a, ...b]', false],
      ["[...a, ...b].reduce((acc, x) => { acc['foo'] = x; return acc }, {})", false],
      ["arr.reduce((acc, x) => { acc['foo'] = x; return acc }, { ...a, ...b })", false],
      ['let x = { ...a, ...b }; arr.reduce((x, y) => x + y, 0)', false],
      ['arr.reduce((acc, x) => ({ ...x }), {})', false],
      ['arr.reduce((acc, x) => ({ ...obj }), {})', false],
      ['arr.reduce((acc, x) => { acc[x] = { ...x }; return acc }, {})', false],
      ['foo.reduce((acc, bar) => {acc.push(bar); return acc;}, [])', false],
      ['foo.reduceRight((acc, bar) => {acc.push(...bar); return acc;}, [])', false],
      ['foo.reduce((acc,value,index,array,somethingExtra) => [...acc, value], [])', false],
      ['foo.reduce((acc) => [...acc], [])', false],
      ['foo.reduce((acc, bar) => [...acc, bar], [], 123)', false],
      ['let foo = []; for (let i of [1,2,3]) { foo.push(i); }', false],
      ['let foo = {}; while (Object.keys(foo).length < 10) { foo[Object.keys(foo).length] = 0; }', false],
      [
        'function f(list) { return list.reduce((acc, each) => each.subList.flatMap(subEach => [...acc, subEach]), []) }',
        false,
      ],
      ['let foo = []; for (const i of xs) { const other = [...foo, i]; }', false],
      ['for (const i of xs) { let foo = []; foo = [...foo, i]; }', false],
      ['items.reduce(initial, (acc, item) => [...acc, item]);', true],
      ["items['reduce'](initial, ((acc, item) => [...acc, item]));", true],
      ['items.reduceRight(initial, function (acc, item) { return { ...acc, item }; });', true],
      ['items.reduce(initial, wrap((acc, item) => [...acc, item]));', true],
      ['items.reduce(wrap((acc, item) => [...acc, item]), initial);', true],
      ['items.reduceRight(initial, wrap(decorate((acc, item) => ({ ...acc, item }))));', true],
      ['items.map(initial, wrap((acc, item) => [...acc, item]));', false],
      ['items.reduce(initial, wrap((acc, item) => [...acc, item]), extra);', false],
      ['items.reduce(initial, wrap((acc, item) => () => [...acc, item]));', false],
      ['items.reduce(initial, (acc, item) => { { const acc = []; return [...acc, item]; } });', false],
      ['items.reduce(initial, ((acc, item) => [...acc, item]), extra);', false],
      ['items.reduce((acc, item) => [...acc, item], (acc, item) => [...acc, item]);', false],
      ['items.reduce(initial, (acc, item) => () => [...acc, item]);', false],
      ['let foo = []; foo = []; for (const i of xs) { foo = [...foo, i]; }', true],
      ['let foo = []; { let foo = []; for (const i of xs) { foo = [...foo, i]; } }', true],
      ['Object.keys(obj).reduce((acc, key) => ({ ...acc, [key]: obj[key] }), {})', true],
      ['Object.keys(obj).reduce((acc, key) => ({ ...acc, [key]: obj[key] }), ({} as foo))', true],
      ['Object.keys(obj).reduce((acc, key) => ({ ...acc, [key]: obj[key] }), foo)', true],
      ['arr.reduce((acc, x) => ({ ...acc, [x]: x }), {})', true],
      ['arr.reduce((differentName, x) => ({ ...differentName, [x]: x }), {})', true],
      ['a.b.arr.reduce((acc, x) => ({ ...acc, [x]: x }), (({} as baz)))', true],
      ['a.b.c.d.reduce((acc,x) => ([...acc, x]), ([] as foo))', true],
      ['get_array().reduce((acc, x) => ({ ...acc, [x]: x }), {})', true],
      ['arr.reduce(function (acc, x) { return { ...acc, [x]: x } }, {})', true],
      ['arr.reduce((acc, x) => { let temp = { ...acc, x }; return temp }, {})', true],
      ['foo.reduce((acc, bar) => [...acc, bar], [])', true],
      ['foo.reduceRight((acc, bar) => {return [...acc, ...bar];}, [])', true],
      ['foo.reduce((acc, bar) => ({...acc, ...bar}), {})', true],
      ['foo.reduceRight((acc, bar) => {return {...acc, ...bar};}, {})', true],
      ['let foo = []; for (let i = 0; i < 10; i++) { foo = [...foo, i]; }', true],
      ['let foo = []; for (const i in [1,2,3]) { foo = [...foo, i]; }', true],
      ['let foo = []; for (const i of [1,2,3]) { foo = [...foo, i]; }', true],
      ['let foo = []; while (foo.length < 10) { foo = [...foo, foo.length]; }', true],
      ['let foo = []; do { foo = [...foo, foo.length]; } while (foo.length < 10)', true],
      ['let foo = {}; for (let i = 0; i < 10; i++) { foo = { ...foo, [i]: i }; }', true],
      ['let foo = {}; for (const i in [1,2,3]) { foo = { ...foo, [i]: i }; }', true],
      ['let foo = {}; for (const i of [1,2,3]) { foo = { ...foo, [i]: i }; }', true],
      ['let foo = {}; while (Object.keys(foo).length < 10) { foo = { ...foo, x: 1 }; }', true],
    ]

    await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'Do not spread accumulators')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
