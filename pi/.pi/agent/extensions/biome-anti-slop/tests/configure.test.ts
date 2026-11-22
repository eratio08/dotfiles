import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ExecOptions, ExecResult } from '@earendil-works/pi-coding-agent'
import { createFakeExtensionContext, installFakePlugin } from '@eratio/pi-effect/testing'
import extensionFactory from '../index.ts'

test('should keep local files and allow direct rule edits after installation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'biome-configure-'))
  try {
    expect(spawnSync('git', ['init', '-q', root]).status).toBe(0)
    await mkdir(join(root, 'node_modules/@biomejs'), { recursive: true })
    await mkdir(join(root, 'node_modules/.bin'))
    await symlink(resolve('node_modules/@biomejs/biome'), join(root, 'node_modules/@biomejs/biome'))
    await symlink(resolve('node_modules/.bin/biome'), join(root, 'node_modules/.bin/biome'))
    await writeFile(join(root, '.gitignore'), 'node_modules/\n')
    await writeFile(join(root, 'package.json'), '{}')
    const oxlint = JSON.stringify({
      jsPlugins: [{ name: 'anti-slop', specifier: './tools/oxlint/anti-slop/index.ts' }],
      rules: { 'anti-slop/no-runtime-typeof': ['warn', { allowInTypeGuards: true }] },
    })
    await writeFile(join(root, '.oxlintrc.json'), oxlint)
    await writeFile(join(root, 'vite.config.ts'), ' '.repeat(12001))
    const extension = await installFakePlugin(extensionFactory)
    extension.api.exec = async (command: string, args: string[], options?: ExecOptions): Promise<ExecResult> => {
      const result = spawnSync(command, args, { cwd: options?.cwd, encoding: 'utf8' })
      return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.status ?? -1, killed: false }
    }
    const context = createFakeExtensionContext(root)
    context.hasUI = true
    context.ui.confirm = async (): Promise<boolean> => true
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(await readFile(join(root, '.oxlintrc.json'), 'utf8')).toBe(oxlint)
    expect(await readFile(join(root, 'vite.config.ts'), 'utf8')).toBe(' '.repeat(12001))
    const directory = join(root, 'tools/biome/anti-slop/rules')
    const plugin = join(directory, 'no-runtime-typeof.ts')
    const stateDirectory = join(root, 'tools/biome/anti-slop')
    const snapshot = await readFile(join(stateDirectory, 'port-base.snapshot'), 'utf8')
    const customized = `${await readFile(plugin, 'utf8')}\n;\n`
    await writeFile(plugin, customized)
    const input = join(root, 'input.ts')
    await writeFile(input, 'function isText(value: unknown): value is string { return typeof value === "string"; }\n')
    const biome = join(root, 'node_modules/.bin/biome')
    const lint = (): string => spawnSync(biome, ['lint', input], { cwd: root, encoding: 'utf8' }).stderr
    expect(lint()).toContain('A `typeof` check narrows')
    await writeFile(plugin, customized.replace('const allowInTypeGuards = false', 'const allowInTypeGuards = true'))
    expect(await readFile(join(stateDirectory, 'port-base.snapshot'), 'utf8')).toBe(snapshot)
    expect(lint()).not.toContain('A `typeof` check narrows')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60000)

test('should expose only the three user commands', async () => {
  const extension = await installFakePlugin(extensionFactory)
  expect([...extension.commands.keys()].sort()).toEqual(['anti-slop-install', 'anti-slop-remove', 'anti-slop-update'])
  expect(extension.tools.has('biome_anti_slop')).toBe(false)
})
