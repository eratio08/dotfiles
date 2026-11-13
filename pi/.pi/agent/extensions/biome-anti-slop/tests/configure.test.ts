import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ExecOptions, ExecResult, ExtensionToolContext } from '@earendil-works/pi-coding-agent'
import { createFakeExtensionContext, installFakePlugin } from '@eratio/pi-effect/testing'
import extensionFactory from '../index.ts'
import { inspectTypeofConfiguration } from '../src/update.ts'

test('should configure the type guard option after review without losing local changes', async () => {
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
    const context = createFakeExtensionContext(root) as ExtensionToolContext
    context.hasUI = true
    context.ui.confirm = async (): Promise<boolean> => true
    const invoke = async (
      operation: string,
      allowInTypeGuards?: boolean,
      previewHash?: string,
    ): Promise<{
      details: {
        status: string
        message: string
        preview: {
          hash: string
          issues: string[]
          gaps: string[]
          repositoryFiles: { path: string; content: string }[]
        }
        backup?: string
        focusedTests?: { status: string }[]
      }
    }> =>
      (await extension.invokeTool(
        'biome_anti_slop',
        'configure',
        { operation, allowInTypeGuards, previewHash },
        context,
      )) as never
    const install = await invoke('inspect')
    expect(install.details.preview.repositoryFiles.some((file) => file.path.endsWith('.oxlintrc.json'))).toBe(false)
    expect(install.details.preview.issues).toEqual([])
    expect(install.details.preview.gaps.some((gap) => gap.includes('migration'))).toBe(false)
    expect((await invoke('install', undefined, install.details.preview.hash)).details.status).toBe('installed')
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
    const preview = await invoke('inspect-configure', true)
    expect(preview.details.preview.issues).toEqual([])
    expect(await readFile(plugin, 'utf8')).toBe(customized)
    context.hasUI = false
    expect((await invoke('configure', true, preview.details.preview.hash)).details.status).toBe('blocked')
    context.hasUI = true
    const helper = join(directory, 'shared.ts')
    const shared = await readFile(helper, 'utf8')
    context.ui.confirm = async (): Promise<boolean> => {
      await writeFile(helper, `${shared}\n`)
      return true
    }
    expect((await invoke('configure', true, preview.details.preview.hash)).details.status).toBe('blocked')
    await writeFile(helper, shared)
    context.ui.confirm = async (): Promise<boolean> => true
    const fresh = await invoke('inspect-configure', true)
    const configured = await invoke('configure', true, fresh.details.preview.hash)
    expect(configured.details.status).toBe('configured')
    expect(configured.details.focusedTests?.map((check) => check.status)).toEqual(['passed'])
    expect(await readFile(plugin, 'utf8')).toBe(
      customized.replace('const allowInTypeGuards = false', 'const allowInTypeGuards = true'),
    )
    expect(await readFile(join(stateDirectory, 'port-base.snapshot'), 'utf8')).toBe(snapshot)
    expect(lint()).not.toContain('A `typeof` check narrows')
    expect(await readFile(join(configured.details.backup ?? '', '0.before'), 'utf8')).toBe(customized)
    const previousExec = extension.api.exec
    extension.api.exec = async (command: string, args: string[], options?: ExecOptions): Promise<ExecResult> => {
      if (command.endsWith('/biome') && args[0] === 'lint') {
        const backups = join(stateDirectory, 'backups')
        for (const name of await readdir(backups)) {
          const path = join(backups, name, 'verification.backup')
          if (!(await Bun.file(path).exists())) await writeFile(path, 'occupied', { flag: 'wx' })
        }
      }
      return previousExec(command, args, options)
    }
    const recoveryPreview = await invoke('inspect-configure', false)
    const recovery = await invoke('configure', false, recoveryPreview.details.preview.hash)
    expect(recovery.details.status).toBe('partial')
    expect(recovery.details.message).toContain('Files changed, but verification could not be recorded')
    expect(recovery.details.backup).toBeDefined()
    expect(await readFile(join(recovery.details.backup ?? '', 'verification.backup'), 'utf8')).toBe('occupied')
    expect(await readFile(plugin, 'utf8')).toBe(customized)
    extension.api.exec = previousExec
    await writeFile(plugin, `// local prefix\n${await readFile(plugin, 'utf8')}`)
    expect((await invoke('inspect-configure', false)).details.preview.issues.length).toBeGreaterThan(0)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 60000)

test('should identify the type guard option with or without a semicolon', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'biome-configure-marker-')))
  const directory = join(root, 'tools/biome/anti-slop/rules')
  try {
    await mkdir(directory, { recursive: true })
    for (const semicolon of ['', ';']) {
      const source = `const allowInTypeGuards = false${semicolon}\n`
      await writeFile(join(directory, 'no-runtime-typeof.ts'), source)
      const incoming = new Map([['no-runtime-typeof.ts', Buffer.from(source)]])
      const preview = await inspectTypeofConfiguration(root, incoming, true)
      expect(preview.issues).toEqual([])
      expect(preview.changes).toHaveLength(1)
      expect(Buffer.from(preview.changes[0]?.after ?? '', 'base64').toString('utf8')).toBe(
        `const allowInTypeGuards = true${semicolon}\n`,
      )
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
