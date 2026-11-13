import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

test('should match upstream examples given the vendored Biome plugin', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'biome-anti-slop-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')

  try {
    await cp(fileURLToPath(new URL('../no-reflect-apply.ts', import.meta.url)), join(temp, 'plugin.ts'))
    await cp(fileURLToPath(new URL('../shared.ts', import.meta.url)), join(temp, 'shared.ts'))
    await writeFile(
      join(temp, 'biome.json'),
      JSON.stringify({ root: true, plugins: ['./plugin.ts'], linter: { rules: { preset: 'none' } } }),
    )

    const cases = [
      ['const value = operation.apply(owner, args);', false],
      ['Reflect.get(owner, key);', false],
      ['const Reflect = { apply() { return 1; } }; Reflect.apply();', false],
      ['function invoke(Reflect: { apply(): number }) { return Reflect.apply(); }', false],
      ['const value = Reflect.apply(operation, owner, args);', true],
      ["const value = Reflect['apply'](operation, owner, args);", true],
      ['const value = Reflect["apply"](operation, owner, args);', true],
      ['(Reflect).apply(operation, owner, args);', true],
      ['(Reflect.apply)(operation, owner, args);', true],
      ['function invoke(Reflect: { apply(): number }) { return (Reflect).apply(); }', false],
      [String.raw`Reflect['\x61pply'](operation, owner, args);`, true],
      [String.raw`Reflect['\\u0061pply'](operation, owner, args);`, false],
      [String.raw`Reflect['\u0061pply'](operation, owner, args);`, true],
    ] as const

    for (const [source, finding] of cases) {
      await writeFile(join(temp, 'input.ts'), source)
      const result = spawnSync(biome, ['lint', '--config-path', temp, join(temp, 'input.ts')], { encoding: 'utf8' })
      expect(result.error).toBeUndefined()
      expect(result.stderr.includes('Replace `Reflect.apply` with a typed function call.')).toBe(finding)
      expect(result.status).toBe(finding ? 1 : 0)
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
