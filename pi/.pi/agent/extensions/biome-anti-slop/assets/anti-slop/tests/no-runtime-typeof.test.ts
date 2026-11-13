import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

test('should match upstream typeof examples and options given the vendored Biome plugin', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'biome-anti-slop-typeof-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  const plugin = fileURLToPath(new URL('../no-runtime-typeof.ts', import.meta.url))

  try {
    await cp(fileURLToPath(new URL('../shared.ts', import.meta.url)), join(temp, 'shared.ts'))
    await writeFile(
      join(temp, 'biome.json'),
      JSON.stringify({ root: true, plugins: ['./plugin.ts'], linter: { rules: { preset: 'none' } } }),
    )
    const source = await readFile(plugin, 'utf8')
    const cases = [
      ['const isServer = typeof document === "undefined";', false, false],
      ['const hasStorage = typeof localStorage !== "undefined";', false, false],
      ['if (typeof globalThis.crypto === "undefined") throw new Error("no crypto");', false, false],
      ['const missing = "undefined" === typeof process;', false, false],
      ['const value = input;', false, false],
      ['function isString(value: unknown): value is string { return typeof value === "string"; }', true, false],
      ['const isString = (value: unknown): value is string => typeof value === "string";', true, false],
      [
        'function assertString(value: unknown): asserts value is string { if (typeof value !== "string") throw new Error(); }',
        true,
        false,
      ],
      ['if (typeof input === "string") use(input);', false, true],
      ['if (typeof input === undefined) use(input);', false, true],
      ['function isString(value: unknown): value is string { return typeof value === "string"; }', false, true],
      [
        'function parse(value: unknown): string { if (typeof value !== "string") throw new Error(); return value; }',
        true,
        true,
      ],
      [
        'function isString(value: unknown): value is string { const check = () => typeof value === "string"; return check(); }',
        true,
        true,
      ],
      [String.raw`const missing = (typeof value) === '\u0075ndefined';`, false, false],
      [String.raw`const missing = (typeof value) === '\\u0075ndefined';`, false, true],
      ['const type = typeof value;', false, true],
    ] as const

    for (const [input, allow, finding] of cases) {
      await writeFile(
        join(temp, 'plugin.ts'),
        source.replace(/const allowInTypeGuards = (?:true|false);?/, `const allowInTypeGuards = ${allow};`),
      )
      await writeFile(join(temp, 'input.ts'), input)
      const result = spawnSync(biome, ['lint', '--config-path', temp, join(temp, 'input.ts')], { encoding: 'utf8' })
      expect(result.error).toBeUndefined()
      expect(result.stderr.includes('A `typeof` check narrows a representation')).toBe(finding)
      expect(result.status).toBe(finding ? 1 : 0)
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
