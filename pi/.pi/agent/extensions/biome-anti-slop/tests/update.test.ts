import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ExecOptions, ExecResult, ExtensionToolContext } from '@earendil-works/pi-coding-agent'
import { createFakeExtensionContext, installFakePlugin } from '@eratio/pi-effect/testing'
import { inspectPortUpdate, makePortSnapshot, type UpdateDecisions } from '../src/update.ts'

test('should preserve local policy and record a partial approved update', async () => {
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
    const context = createFakeExtensionContext(root) as ExtensionToolContext
    context.hasUI = true
    context.ui.confirm = async (): Promise<boolean> => true
    type Preview = {
      hash: string
      baseAvailable?: boolean
      baseRevision?: string
      incomingRevision?: string
      effectEnabled?: boolean
      pending?: string[]
      comparisons?: { name: string; base: string | null; local: string | null; incoming: string | null }[]
      issues: string[]
      changes?: { path: string }[]
    }
    const invoke = async (
      operation: string,
      previewHash?: string,
      decisions?: UpdateDecisions,
    ): Promise<{
      details: {
        status: string
        preview: Preview
        backup?: string
        verification?: { status: string }
        focusedTests?: { status: string }[]
      }
    }> =>
      (await extension.invokeTool(
        'biome_anti_slop',
        'update-test',
        { operation, previewHash, decisions },
        context,
      )) as never

    const installation = await invoke('inspect')
    expect((await invoke('install', installation.details.preview.hash)).details.status).toBe('installed')
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
    config.plugins = config.plugins.filter((path) => !path.endsWith('/no-reflect-get.ts'))
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

    const preview = await invoke('inspect-update')
    expect(preview.details.preview.issues).toEqual([])
    expect(preview.details.preview.baseAvailable).toBe(true)
    expect(preview.details.preview.effectEnabled).toBe(false)
    expect(preview.details.preview.pending?.some((item) => item.includes('no-runtime-typeof.ts'))).toBe(true)
    const conflict = preview.details.preview.comparisons?.find((item) => item.name === 'no-runtime-typeof.ts')
    expect(conflict?.base).toContain('const allowInTypeGuards = false')
    expect(conflict?.local).toContain('const allowInTypeGuards = true')
    expect(conflict?.incoming).toContain('const allowInTypeGuards = false')
    expect(preview.details.preview.changes?.some((item) => item.path.endsWith('/no-reflect-apply.ts'))).toBe(true)
    expect(await readFile(snapshot, 'utf8')).toBe(originalBase)
    context.hasUI = false
    expect((await invoke('update', preview.details.preview.hash)).details.status).toBe('blocked')
    context.hasUI = true
    context.ui.confirm = async (): Promise<boolean> => {
      await writeFile(runtime, `${localRuntime}\n`)
      return true
    }
    expect((await invoke('update', preview.details.preview.hash)).details.status).toBe('blocked')
    await writeFile(runtime, localRuntime)
    context.ui.confirm = async (): Promise<boolean> => true
    const partialPreview = await invoke('inspect-update')
    const partial = await invoke('update', partialPreview.details.preview.hash)
    expect(partial.details.status).toBe('partial')
    expect(partial.details.backup).toBeDefined()
    expect(await readFile(snapshot, 'utf8')).toBe(originalBase)
    expect(await readFile(runtime, 'utf8')).toBe(localRuntime)
    expect(await readFile(configPath, 'utf8')).toBe(customConfig)
    expect(await readFile(join(destination, 'local-rule.ts'), 'utf8')).toBe('export const local = 1;\n')
    expect(await readFile(join(partial.details.backup ?? '', 'verification.backup'), 'utf8')).toContain('checks')
    const manifest = JSON.parse(await readFile(join(partial.details.backup ?? '', 'manifest.backup'), 'utf8')) as {
      changes: { path: string }[]
    }
    const applyBackup = manifest.changes.findIndex((change) => change.path.endsWith('/no-reflect-apply.ts'))
    expect(applyBackup).toBeGreaterThanOrEqual(0)
    expect(await readFile(join(partial.details.backup ?? '', `${applyBackup}.before`), 'utf8')).toBe(originalApply)

    const decisions = { conflicts: { 'no-runtime-typeof.ts': 'local' } } satisfies UpdateDecisions
    const resolved = await invoke('inspect-update', undefined, decisions)
    expect(resolved.details.preview.pending).toEqual([])
    const updated = await invoke('update', resolved.details.preview.hash, decisions)
    expect(updated.details.status).toBe('updated')
    expect(await readFile(runtime, 'utf8')).toBe(localRuntime)
    expect(await readFile(configPath, 'utf8')).toBe(customConfig)
    expect(await readFile(snapshot, 'utf8')).toContain('prototype-19')

    const fullBase = JSON.parse(await readFile(snapshot, 'utf8')) as {
      files: Record<string, string>
      plugins: string[]
    }
    const omitted = ['no-reflect-get.ts']
    const priorFiles = new Map(
      Object.entries(fullBase.files)
        .filter(([name]) => !omitted.includes(name))
        .map(([name, data]) => [name, Buffer.from(data, 'base64')]),
    )
    await writeFile(
      snapshot,
      makePortSnapshot(
        priorFiles,
        false,
        fullBase.plugins.filter((path) => !path.endsWith('/no-reflect-get.ts')),
      ),
    )
    for (const name of omitted) await rm(join(destination, name))
    const newRule = await invoke('inspect-update')
    expect(
      newRule.details.preview.pending?.some((item) => item.includes('enable the new rule: no-reflect-get.ts')),
    ).toBe(true)
    const added = await invoke('update', newRule.details.preview.hash)
    expect(added.details.status).toBe('partial')
    expect(await readFile(configPath, 'utf8')).toBe(customConfig)
    expect(await readFile(join(destination, 'no-reflect-get.ts'), 'utf8')).toContain('noReflectGet')
    const ruleDecision = { rules: { 'no-reflect-get.ts': 'enable' } } satisfies UpdateDecisions
    const enablePreview = await invoke('inspect-update', undefined, ruleDecision)
    expect(enablePreview.details.preview.pending).toEqual([])
    expect((await invoke('update', enablePreview.details.preview.hash, ruleDecision)).details.status).toBe('updated')
    expect(await readFile(configPath, 'utf8')).toContain('./tools/biome/anti-slop/rules/no-reflect-get.ts')
    expect(await readFile(configPath, 'utf8')).toContain('// local configuration')

    await symlink(join(destination, 'no-reflect-get.ts'), join(root, 'reflection-rule.ts'))
    const aliasedConfig = (await readFile(configPath, 'utf8')).replace(
      './tools/biome/anti-slop/rules/no-reflect-get.ts',
      './reflection-rule.ts',
    )
    await writeFile(configPath, aliasedConfig)
    const currentBase = JSON.parse(await readFile(snapshot, 'utf8')) as {
      files: Record<string, string>
      plugins: string[]
    }
    const incomingFiles = new Map(
      Object.entries(currentBase.files).map(([name, data]) => [name, Buffer.from(data, 'base64')]),
    )
    incomingFiles.delete('no-reflect-get.ts')
    incomingFiles.delete('no-runtime-typeof.ts')
    const remaining = [...incomingFiles.keys()]
    const incomingPlugins = currentBase.plugins.filter(
      (path) => !path.endsWith('/no-reflect-get.ts') && !path.endsWith('/no-runtime-typeof.ts'),
    )
    const deletion = await inspectPortUpdate(await realpath(root), incomingFiles, remaining, [], incomingPlugins)
    expect(deletion.pending.some((item) => item.includes('removed rule') && item.includes('no-reflect-get.ts'))).toBe(
      true,
    )
    expect(
      deletion.pending.some((item) => item.includes('removed rule') && item.includes('no-runtime-typeof.ts')),
    ).toBe(true)
    expect(
      deletion.changes.some(
        (change) => change.path.endsWith('/no-reflect-get.ts') || change.path.endsWith('/no-runtime-typeof.ts'),
      ),
    ).toBe(false)
    const keepDeleted = await inspectPortUpdate(await realpath(root), incomingFiles, remaining, [], incomingPlugins, {
      conflicts: { 'no-runtime-typeof.ts': 'local' },
    })
    expect(keepDeleted.pending.some((item) => item.includes('no-runtime-typeof.ts'))).toBe(false)

    await writeFile(configPath, JSON.stringify({ root: true, plugins: ['unresolved-plugin-package'] }))
    const unknownPlugin = await inspectPortUpdate(await realpath(root), incomingFiles, remaining, [], incomingPlugins)
    expect(
      unknownPlugin.pending.some((item) => item.includes('removed rule') && item.includes('no-reflect-get.ts')),
    ).toBe(true)
    expect(unknownPlugin.changes.some((change) => change.path.endsWith('/no-reflect-get.ts'))).toBe(false)
    await writeFile(configPath, aliasedConfig)

    expect(await readdir(destination)).not.toContain('tests')
    const unknownBase = '{"invalid":true}\n'
    await writeFile(snapshot, unknownBase)
    const applyFile = join(destination, 'no-reflect-apply.ts')
    const localApply = `${await readFile(applyFile, 'utf8')}\n;\n`
    await writeFile(applyFile, localApply)
    const getFile = join(destination, 'no-reflect-get.ts')
    await writeFile(getFile, `${await readFile(getFile, 'utf8')}\n;\n`)
    const unknown = await invoke('inspect-update')
    expect(unknown.details.preview.baseAvailable).toBe(false)
    expect(unknown.details.preview.issues).toEqual([])
    expect(unknown.details.preview.pending?.some((item) => item.includes('no-reflect-apply.ts'))).toBe(true)
    expect(unknown.details.preview.changes).toEqual([])
    const unknownDecision = {
      conflicts: { 'no-reflect-apply.ts': 'incoming', 'no-reflect-get.ts': 'incoming' },
    } satisfies UpdateDecisions
    const unknownPreview = await invoke('inspect-update', undefined, unknownDecision)
    const adopted = await invoke('update', unknownPreview.details.preview.hash, unknownDecision)
    expect(adopted.details.status).toBe('partial')
    expect(adopted.details.focusedTests?.map((check) => check.status)).toEqual(['passed', 'passed'])
    expect(await readFile(snapshot, 'utf8')).toBe(unknownBase)
    expect(await readFile(join(adopted.details.backup ?? '', 'previous-base.backup'), 'utf8')).toBe(unknownBase)
    expect(await readFile(join(adopted.details.backup ?? '', 'focused-tests.backup'), 'utf8')).toContain('passed')
    expect(await readFile(configPath, 'utf8')).toContain('// local configuration')
    expect(await readdir(destination)).not.toContain('tests')
    expect(await readFile(runtime, 'utf8')).toBe(localRuntime)

    const adoptedSource = await readFile(applyFile, 'utf8')
    await writeFile(join(source, 'no-reflect-apply.ts'), `${adoptedSource}\nthis is not valid TypeScript!\n`)
    const invalidPreview = await invoke('inspect-update', undefined, unknownDecision)
    const rejected = await invoke('update', invalidPreview.details.preview.hash, unknownDecision)
    expect(rejected.details.status).toBe('blocked')
    expect(rejected.details.focusedTests?.[0]?.status).toBe('failed')
    expect(await readFile(applyFile, 'utf8')).toBe(adoptedSource)
    expect(await readFile(snapshot, 'utf8')).toBe(unknownBase)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 120000)

test('should reject malformed installed snapshots before planning an update', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'biome-invalid-base-')))
  const directory = join(root, 'tools/biome/anti-slop')
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(join(root, 'biome.json'), '{"root":true}')
    const incoming = new Map([
      ['UPSTREAM.md', Buffer.from('The upstream revision is `upstream`.\nThe port revision is `port`.\n')],
    ])
    const snapshot = makePortSnapshot(incoming, false, [])
    await writeFile(join(directory, 'port-base.snapshot'), snapshot)
    expect((await inspectPortUpdate(root, incoming, ['UPSTREAM.md'], [], [])).baseAvailable).toBe(true)

    const { digest, ...base } = JSON.parse(snapshot) as { digest: string }
    expect(digest).toBeTruthy()
    for (const invalid of [
      { ...base, effectEnabled: 'true' },
      { ...base, plugins: [1] },
      { ...base, files: [] },
      { ...base, files: { '../outside': 'dGVzdA==' } },
      { ...base, files: { 'rule.ts': 'not-base64' } },
    ]) {
      const checksum = createHash('sha256').update(JSON.stringify(invalid)).digest('hex')
      await writeFile(join(directory, 'port-base.snapshot'), JSON.stringify({ ...invalid, digest: checksum }))
      expect((await inspectPortUpdate(root, incoming, ['UPSTREAM.md'], [], [])).baseAvailable).toBe(false)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
