import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ExecOptions, ExecResult } from '@earendil-works/pi-coding-agent'
import { createFakeExtensionContext, installFakePlugin } from '@eratio/pi-effect/testing'

test('should disclose collisions and preserve local policy given an update', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'biome-update-'))
  const root = join(temp, 'project')
  const bundle = join(temp, 'extension')
  try {
    await mkdir(root)
    await mkdir(bundle)
    for (const name of ['index.ts', 'src', 'assets']) await cp(resolve(name), join(bundle, name), { recursive: true })
    await mkdir(join(bundle, 'node_modules'))
    for (const name of ['@earendil-works', 'typebox', 'jsonc-parser', 'yaml']) {
      await symlink(resolve('node_modules', name), join(bundle, 'node_modules', name))
    }
    await mkdir(join(root, 'node_modules/@biomejs'), { recursive: true })
    await mkdir(join(root, 'node_modules/.bin'))
    await symlink(resolve('node_modules/@biomejs/biome'), join(root, 'node_modules/@biomejs/biome'))
    await symlink(resolve('node_modules/.bin/biome'), join(root, 'node_modules/.bin/biome'))
    await writeFile(join(root, '.gitignore'), 'node_modules/\n')
    await writeFile(join(root, 'package.json'), '{}')
    expect(spawnSync('git', ['init', '-q', root]).status).toBe(0)
    const factory = (await import(join(bundle, 'index.ts'))).default
    const extension = await installFakePlugin(factory)
    extension.api.exec = async (command: string, args: string[], options?: ExecOptions): Promise<ExecResult> => {
      const result = spawnSync(command, args, { cwd: options?.cwd, encoding: 'utf8' })
      return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.status ?? -1, killed: false }
    }
    const context = createFakeExtensionContext(root)
    context.hasUI = true
    let notification = ''
    let confirmation = ''
    context.ui.notify = (message: string): void => {
      notification = message
    }
    context.ui.confirm = async (): Promise<boolean> => true
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(notification).toContain('were installed')

    const destination = join(root, 'tools/biome/anti-slop/rules')
    const snapshot = join(root, 'tools/biome/anti-slop/port-base.snapshot')
    const originalBase = await readFile(snapshot, 'utf8')
    const originalApply = await readFile(join(destination, 'no-reflect-apply.ts'), 'utf8')
    const runtime = join(destination, 'no-runtime-typeof.ts')
    const localRuntime = (await readFile(runtime, 'utf8')).replace(
      'const allowInTypeGuards = false',
      'const allowInTypeGuards = true',
    )
    await writeFile(runtime, localRuntime)
    const configPath = join(root, 'biome.jsonc')
    await rename(join(root, 'biome.json'), configPath)
    const config = JSON.parse(await readFile(configPath, 'utf8')) as { plugins: string[] }
    const entrypoint = join(destination, 'anti-slop.ts')
    await writeFile(
      entrypoint,
      (await readFile(entrypoint, 'utf8')).replace("export * from './no-reflect-get.ts'\n", ''),
    )
    const customEntrypoint = await readFile(entrypoint, 'utf8')
    await writeFile(configPath, `// local configuration\n${JSON.stringify(config, null, 2)}`)
    const customConfig = await readFile(configPath, 'utf8')
    await writeFile(join(destination, 'local-rule.ts'), 'export const local = 1;\n')
    await writeFile(join(root, 'package.json'), '{"dependencies":{"effect":"^3"}}')

    const source = join(bundle, 'assets/anti-slop')
    for (const name of ['no-reflect-apply.ts', 'no-runtime-typeof.ts']) {
      const path = join(source, name)
      await writeFile(path, `${await readFile(path, 'utf8')}\n;\n`)
    }
    const provenance = join(source, 'UPSTREAM.md')
    await writeFile(provenance, (await readFile(provenance, 'utf8')).replace('prototype-18', 'prototype-19'))
    context.hasUI = false
    await extension.invokeCommand('anti-slop-update', '', context)
    expect(notification).toContain('confirmation dialog')
    expect(await readFile(snapshot, 'utf8')).toBe(originalBase)
    context.hasUI = true
    context.ui.confirm = async (_title: string, message: string): Promise<boolean> => {
      confirmation = message
      return false
    }
    await extension.invokeCommand('anti-slop-update', '', context)
    expect(confirmation).toContain('no-runtime-typeof.ts')
    expect(confirmation).toContain('replaces')
    expect(confirmation).toContain('Effect rules: disabled')
    expect(await readFile(runtime, 'utf8')).toBe(localRuntime)
    const extraCollisions = ['no-reflect-get.ts', 'no-shape-in-symbol-names.ts', 'no-object-parameters.ts']
    const originals = await Promise.all(
      extraCollisions.map(async (name) => ({
        name,
        local: await readFile(join(destination, name), 'utf8'),
        incoming: await readFile(join(source, name), 'utf8'),
      })),
    )
    for (const item of originals) {
      await writeFile(join(destination, item.name), `${item.local}\n;\n`)
      await writeFile(join(source, item.name), `${item.incoming}\n;\n;\n`)
    }
    let approved = false
    context.ui.confirm = async (): Promise<boolean> => {
      approved = true
      return true
    }
    await extension.invokeCommand('anti-slop-update', '', context)
    expect(notification).toContain('details do not fit')
    expect(approved).toBe(false)
    expect(await readFile(snapshot, 'utf8')).toBe(originalBase)
    for (const item of originals) {
      expect(await readFile(join(destination, item.name), 'utf8')).toBe(`${item.local}\n;\n`)
      await writeFile(join(destination, item.name), item.local)
      await writeFile(join(source, item.name), item.incoming)
    }
    context.ui.confirm = async (): Promise<boolean> => {
      await writeFile(entrypoint, `${customEntrypoint}// Local edit\n`)
      return true
    }
    await extension.invokeCommand('anti-slop-update', '', context)
    expect(notification).toContain('changed during approval')
    expect(await readFile(snapshot, 'utf8')).toBe(originalBase)
    await writeFile(entrypoint, customEntrypoint)
    context.ui.confirm = async (): Promise<boolean> => true
    await extension.invokeCommand('anti-slop-update', '', context)
    expect(notification).toContain('were updated')
    expect(await readFile(runtime, 'utf8')).toContain('const allowInTypeGuards = false')
    expect(await readFile(join(destination, 'no-reflect-apply.ts'), 'utf8')).not.toBe(originalApply)
    expect(await readFile(configPath, 'utf8')).toBe(customConfig)
    expect(await readFile(entrypoint, 'utf8')).toBe(customEntrypoint)
    expect(await readFile(join(destination, 'local-rule.ts'), 'utf8')).toBe('export const local = 1;\n')
    expect(await readFile(snapshot, 'utf8')).toContain('prototype-19')
    expect(await readdir(join(root, 'tools/biome/anti-slop'))).not.toContain('backups')
    expect(await readdir(destination)).not.toContain('tests')

    await writeFile(entrypoint, `${customEntrypoint}export const invalid = 1\n`)
    await extension.invokeCommand('anti-slop-update', '', context)
    expect(notification).toContain('entry point requires manual review')
    await writeFile(entrypoint, customEntrypoint)

    const { digest: _digest, ...prior } = JSON.parse(await readFile(snapshot, 'utf8')) as {
      digest: string
      files: Record<string, string>
      plugins: string[]
    }
    delete prior.files['no-reflect-get.ts']
    prior.plugins = prior.plugins.filter((path) => !path.endsWith('/no-reflect-get.ts'))
    const checksum = createHash('sha256').update(JSON.stringify(prior)).digest('hex')
    await writeFile(snapshot, JSON.stringify({ ...prior, digest: checksum }))
    await rm(join(destination, 'no-reflect-get.ts'))
    context.ui.confirm = async (_title: string, message: string): Promise<boolean> => {
      confirmation = message
      return true
    }
    await extension.invokeCommand('anti-slop-update', '', context)
    expect(confirmation).toContain('New rules: 1')
    expect(await readFile(join(destination, 'no-reflect-get.ts'), 'utf8')).toContain('noReflectGet')
    expect(await readFile(entrypoint, 'utf8')).toContain("export * from './no-reflect-get.ts'")
    expect(await readFile(configPath, 'utf8')).toContain('// local configuration')

    const { digest, ...base } = JSON.parse(await readFile(snapshot, 'utf8')) as {
      digest: string
      files: Record<string, string>
      plugins: string[]
      effectEnabled: boolean
    }
    expect(digest).toBeTruthy()
    for (const invalid of [
      { ...base, effectEnabled: 'true' },
      { ...base, plugins: [1] },
      { ...base, files: [] },
      { ...base, files: { '../outside': 'dGVzdA==' } },
      { ...base, files: { 'rule.ts': 'not-base64' } },
    ]) {
      const invalidDigest = createHash('sha256').update(JSON.stringify(invalid)).digest('hex')
      const invalidSnapshot = JSON.stringify({ ...invalid, digest: invalidDigest })
      await writeFile(snapshot, invalidSnapshot)
      const before = await readFile(runtime, 'utf8')
      await extension.invokeCommand('anti-slop-update', '', context)
      expect(notification).toContain('ownership is unknown')
      expect(await readFile(snapshot, 'utf8')).toBe(invalidSnapshot)
      expect(await readFile(runtime, 'utf8')).toBe(before)
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 120000)
