import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('should load formatted plugin sources without semicolons', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'biome-format-plugin-'))
  const assets = join(temp, 'anti-slop')
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  try {
    await cp(resolve('assets/anti-slop'), assets, { recursive: true })
    const formatterConfig = join(temp, 'formatter.json')
    await writeFile(
      formatterConfig,
      JSON.stringify({
        root: true,
        javascript: { formatter: { semicolons: 'asNeeded' } },
      }),
    )
    const files = (await readdir(assets)).filter((name) => name.endsWith('.ts')).map((name) => join(assets, name))
    const format = spawnSync(biome, ['format', '--write', '--config-path', formatterConfig, ...files], {
      encoding: 'utf8',
    })
    expect(format.status).toBe(0)
    const pluginNames = (await readdir(assets)).filter(
      (name) => name.startsWith('no-') || name === 'prefer-effect-match.ts',
    )
    await writeFile(
      join(temp, 'biome.json'),
      JSON.stringify({
        root: true,
        plugins: pluginNames.map((name) => `./anti-slop/${name}`),
        linter: { rules: { preset: 'none' } },
      }),
    )
    const input = join(temp, 'input.ts')
    await writeFile(input, 'Reflect.apply(operation, null, []);\n')
    const lint = spawnSync(biome, ['lint', '--config-path', temp, input], { encoding: 'utf8' })
    expect(lint.status).toBe(1)
    expect(lint.stderr).toContain('Replace `Reflect.apply`')
    expect(lint.stderr).not.toContain('Failed to compile the JS plugin')
    expect(lint.stderr).not.toMatch(/Rule .+ errored:/)
    const env: NodeJS.ProcessEnv = { ...process.env, ANTI_SLOP_BIOME: biome }
    delete env.ANTI_SLOP_INSTALLED_ROOT
    const result = spawnSync('bun', ['test', join(assets, 'tests')], { encoding: 'utf8', env })
    expect(result.error).toBeUndefined()
    expect(result.stderr).not.toContain('Failed to compile the JS plugin')
    expect(result.status).toBe(0)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 30000)
