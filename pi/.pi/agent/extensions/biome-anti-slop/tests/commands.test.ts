import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ExecOptions, ExecResult } from '@earendil-works/pi-coding-agent'
import { createFakeExtensionContext, installFakePlugin } from '@eratio/pi-effect/testing'

test('should install generic rules given an approved command and an Effect dependency', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'anti-slop-command-'))
  const project = join(temp, 'project')
  const bundle = join(temp, 'extension')
  try {
    await mkdir(project)
    await mkdir(bundle)
    for (const name of ['index.ts', 'src', 'assets']) await cp(resolve(name), join(bundle, name), { recursive: true })
    await mkdir(join(bundle, 'node_modules'))
    for (const name of ['@earendil-works', 'typebox', 'jsonc-parser', 'yaml']) {
      await symlink(resolve('node_modules', name), join(bundle, 'node_modules', name))
    }
    await mkdir(join(project, 'node_modules/@biomejs'), { recursive: true })
    await mkdir(join(project, 'node_modules/.bin'))
    await symlink(resolve('node_modules/@biomejs/biome'), join(project, 'node_modules/@biomejs/biome'))
    await symlink(resolve('node_modules/.bin/biome'), join(project, 'node_modules/.bin/biome'))
    await writeFile(join(project, '.gitignore'), 'node_modules/\n')
    await writeFile(join(project, 'package.json'), '{"dependencies":{"effect":"^3"}}')
    expect(spawnSync('git', ['init', '-q', project]).status).toBe(0)
    const factory = (await import(join(bundle, 'index.ts'))).default
    const extension = await installFakePlugin(factory)
    expect(extension.tools.has('biome_anti_slop')).toBe(false)
    extension.api.exec = async (command: string, args: string[], options?: ExecOptions): Promise<ExecResult> => {
      const result = spawnSync(command, args, { cwd: options?.cwd, encoding: 'utf8' })
      return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.status ?? -1, killed: false }
    }
    const context = createFakeExtensionContext(project)
    context.hasUI = true
    let preview = ''
    context.ui.confirm = async (_title: string, message: string): Promise<boolean> => {
      preview = message
      return true
    }
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(preview).toContain('Effect rules: disabled')
    expect(preview).toContain('require-safety-comment-for-type-assertion')
    expect(await readFile(join(project, 'biome.json'), 'utf8')).toContain('anti-slop.ts')
    await expect(readFile(join(project, 'tools/biome/anti-slop/rules/no-manual-effect-error-tag.ts'))).rejects.toThrow()

    let notification = ''
    context.ui.notify = (message: string): void => {
      notification = message
    }
    const entrypoint = join(project, 'tools/biome/anti-slop/rules/anti-slop.ts')
    const disabled = (await readFile(entrypoint, 'utf8')).replace("export * from './no-reflect-get.ts'\n", '')
    await writeFile(entrypoint, disabled)
    const localOnly = join(project, 'tools/biome/anti-slop/rules/local-rule.ts')
    await writeFile(localOnly, 'local policy')
    const localRule = join(project, 'tools/biome/anti-slop/rules/no-reflect-apply.ts')
    const incomingRule = join(bundle, 'assets/anti-slop/no-reflect-apply.ts')
    const originalIncoming = await readFile(incomingRule, 'utf8')
    await writeFile(localRule, `${originalIncoming}\\n// local change\\n`)
    await writeFile(incomingRule, `${originalIncoming}\\n// incoming change\\n`)
    let updateMessage = ''
    context.ui.confirm = async (_title: string, message: string): Promise<boolean> => {
      updateMessage = message
      return false
    }
    await extension.invokeCommand('anti-slop-update', '', context)
    expect(updateMessage).toContain('no-reflect-apply')
    expect(updateMessage).toContain('replaces')
    expect(await readFile(localRule, 'utf8')).toContain('// local change')
    context.hasUI = false
    await extension.invokeCommand('anti-slop-update', '', context)
    expect(await readFile(localRule, 'utf8')).toContain('// local change')
    context.hasUI = true
    const snapshot = join(project, 'tools/biome/anti-slop/port-base.snapshot')
    const originalSnapshot = await readFile(snapshot, 'utf8')
    await writeFile(snapshot, '{}')
    await extension.invokeCommand('anti-slop-update', '', context)
    expect(notification).toContain('ownership is unknown')
    await writeFile(snapshot, originalSnapshot)
    context.ui.confirm = async (): Promise<boolean> => {
      await writeFile(incomingRule, `${originalIncoming}\\n// changed during approval\\n`)
      return true
    }
    await extension.invokeCommand('anti-slop-update', '', context)
    expect(notification).toContain('changed during approval')
    expect(await readFile(localRule, 'utf8')).toContain('// local change')
    await writeFile(incomingRule, `${originalIncoming}\\n// incoming change\\n`)
    context.ui.confirm = async (): Promise<boolean> => true
    await extension.invokeCommand('anti-slop-update', '', context)
    expect(await readFile(localRule, 'utf8')).toContain('// incoming change')
    expect(await readFile(entrypoint, 'utf8')).toBe(disabled)
    expect(await readFile(localOnly, 'utf8')).toBe('local policy')
    await expect(readFile(join(project, 'tools/biome/anti-slop/backups/manifest.backup'))).rejects.toThrow()
    await writeFile(incomingRule, originalIncoming)

    await writeFile(localRule, 'local rule')
    context.ui.confirm = async (_title: string, message: string): Promise<boolean> => {
      preview = message
      return false
    }
    await extension.invokeCommand('anti-slop-remove', '', context)
    expect(preview).toContain('local-rule.ts')
    expect(preview).toContain('no-reflect-apply.ts')
    expect(await readFile(localRule, 'utf8')).toBe('local rule')
    context.ui.confirm = async (): Promise<boolean> => true
    await extension.invokeCommand('anti-slop-remove', '', context)
    expect(await readFile(localRule, 'utf8')).toBe('local rule')
    expect(await readFile(localOnly, 'utf8')).toBe('local policy')
    expect(await readFile(join(project, 'biome.json'), 'utf8')).not.toContain('anti-slop.ts')
    await expect(readFile(join(project, 'tools/biome/anti-slop/rules/no-runtime-typeof.ts'))).rejects.toThrow()

    await rm(join(project, 'tools'), { recursive: true })
    await rm(join(project, 'biome.json'))
    const json = '{"root":true}'
    const jsonc =
      '{\n  // local policy\n  "root": true,\n  "plugins": [\n    {"path":"./local.ts","resolutionKind":"config"}, // local plugin\n  ]\n}\n'
    await writeFile(join(project, 'biome.json'), json)
    await writeFile(join(project, 'biome.jsonc'), jsonc)
    await writeFile(join(project, 'local.ts'), 'export {}\n')
    let confirmations = 0
    context.ui.confirm = async (): Promise<boolean> => {
      confirmations++
      return false
    }
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(notification).toContain('Both Biome configuration files exist')
    expect(confirmations).toBe(0)
    await extension.invokeCommand('anti-slop-install', '--config biome.jsonc --effect', context)
    expect(confirmations).toBe(1)
    expect(await readFile(join(project, 'biome.jsonc'), 'utf8')).toBe(jsonc)
    await extension.invokeCommand('anti-slop-install', `--config "${join(project, 'biome.jsonc')}"`, context)
    expect(confirmations).toBe(2)

    context.hasUI = false
    await extension.invokeCommand('anti-slop-install', '--config biome.jsonc --effect', context)
    expect(confirmations).toBe(2)
    context.hasUI = true
    context.isProjectTrusted = (): boolean => false
    await extension.invokeCommand('anti-slop-install', '--config biome.jsonc --effect', context)
    expect(notification).toContain('trust')
    context.isProjectTrusted = (): boolean => true
    context.ui.confirm = async (): Promise<boolean> => {
      await writeFile(join(project, 'biome.jsonc'), `${jsonc}\\n`)
      return true
    }
    await extension.invokeCommand('anti-slop-install', '--config biome.jsonc --effect', context)
    expect(notification).toContain('changed during approval')
    await expect(readFile(join(project, 'tools/biome/anti-slop/rules/anti-slop.ts'))).rejects.toThrow()
    await writeFile(join(project, 'biome.jsonc'), jsonc)
    context.ui.confirm = async (_title: string, message: string): Promise<boolean> => {
      preview = message
      return true
    }
    await extension.invokeCommand('anti-slop-install', '--config biome.jsonc --effect', context)
    expect(preview).toContain('Effect rules: enabled')
    expect(await readFile(join(project, 'biome.json'), 'utf8')).toBe(json)
    expect(await readFile(join(project, 'biome.jsonc'), 'utf8')).toContain('// local policy')
    expect(await readFile(join(project, 'biome.jsonc'), 'utf8')).toContain('./local.ts')
    const effectRule = join(project, 'tools/biome/anti-slop/rules/no-manual-effect-error-tag.ts')
    expect(await readFile(effectRule, 'utf8')).toContain('defineRule')
    const effectAsset = join(bundle, 'assets/anti-slop/no-manual-effect-error-tag.ts')
    const originalEffect = await readFile(effectAsset, 'utf8')
    await writeFile(effectAsset, `${originalEffect}\\n// incoming Effect rule\\n`)
    context.ui.confirm = async (_title: string, message: string): Promise<boolean> => {
      preview = message
      return true
    }
    await extension.invokeCommand('anti-slop-update', '--config biome.jsonc', context)
    expect(preview).toContain('Effect rules: enabled')
    expect(await readFile(effectRule, 'utf8')).toContain('// incoming Effect rule')
    expect(await readFile(join(project, 'biome.jsonc'), 'utf8')).toContain('// local policy')
    await writeFile(effectAsset, originalEffect)

    const configured = await readFile(join(project, 'biome.jsonc'), 'utf8')
    const beforeRemoval = await readFile(effectRule, 'utf8')
    await writeFile(join(project, 'biome.json'), '{"plugins":["./tools/biome/anti-slop/rules/anti-slop.ts"]}')
    await extension.invokeCommand('anti-slop-remove', '--config biome.jsonc', context)
    expect(notification).toContain('Another Biome configuration')
    expect(await readFile(effectRule, 'utf8')).toBe(beforeRemoval)
    await writeFile(
      join(project, 'biome.json'),
      '{"overrides":[{"includes":["**"],"plugins":[{"path":"./tools/biome/anti-slop/rules/anti-slop.ts"}]}]}',
    )
    await extension.invokeCommand('anti-slop-remove', '--config biome.jsonc', context)
    expect(notification).toContain('Another Biome configuration')
    await symlink(effectRule, join(project, 'node_modules/managed-alias'))
    await writeFile(join(project, 'biome.json'), '{"plugins":["managed-alias"]}')
    await extension.invokeCommand('anti-slop-remove', '--config biome.jsonc', context)
    expect(notification).toContain('Another Biome configuration')
    await rm(join(project, 'node_modules/managed-alias'))
    await writeFile(join(project, 'biome.json'), json)
    const overrideConfig = configured.replace(
      '"overrides": [',
      '"overrides": [{"includes":["**"],"plugins":[{"path":"./tools/biome/anti-slop/rules/anti-slop.ts"}]}, ',
    )
    expect(overrideConfig).not.toBe(configured)
    await writeFile(join(project, 'biome.jsonc'), overrideConfig)
    await extension.invokeCommand('anti-slop-remove', '--config biome.jsonc', context)
    expect(notification).toContain('Another plugin refers')
    await writeFile(join(project, 'biome.jsonc'), configured)
    const inherited = configured.replace('"root": true', '"root": false, "extends": "//"')
    await writeFile(join(project, 'biome.jsonc'), inherited)
    await extension.invokeCommand('anti-slop-remove', '--config biome.jsonc', context)
    expect(notification).toContain('inherited Biome configuration requires manual review')
    await writeFile(join(project, 'biome.jsonc'), configured)
    context.ui.confirm = async (): Promise<boolean> => {
      await writeFile(join(project, 'biome.json'), `${json}\n`)
      return true
    }
    await extension.invokeCommand('anti-slop-remove', '--config biome.jsonc', context)
    expect(notification).toContain('changed during approval')
    await writeFile(join(project, 'biome.json'), json)
    const retainedFiles = Array.from({ length: 4 }, (_, index) =>
      join(project, 'tools/biome/anti-slop/rules', `local-policy-retained-long-rule-${index}.ts`),
    )
    for (const path of retainedFiles) await writeFile(path, 'local')
    let removalConfirmed = false
    context.ui.confirm = async (): Promise<boolean> => {
      removalConfirmed = true
      return true
    }
    await extension.invokeCommand('anti-slop-remove', '--config biome.jsonc', context)
    expect(notification).toContain('do not fit')
    expect(removalConfirmed).toBe(false)
    expect(await readFile(effectRule, 'utf8')).toBe(beforeRemoval)
    for (const path of retainedFiles) await rm(path)
    context.hasUI = false
    await extension.invokeCommand('anti-slop-remove', '--config biome.jsonc', context)
    expect(await readFile(effectRule, 'utf8')).toBe(beforeRemoval)
    context.hasUI = true
    context.ui.confirm = async (): Promise<boolean> => false
    await extension.invokeCommand('anti-slop-remove', '--config biome.jsonc', context)
    expect(await readFile(join(project, 'biome.jsonc'), 'utf8')).toBe(configured)
    context.ui.confirm = async (): Promise<boolean> => {
      await writeFile(join(project, 'biome.jsonc'), `${configured}\n`)
      return true
    }
    await extension.invokeCommand('anti-slop-remove', '--config biome.jsonc', context)
    expect(notification).toContain('changed during approval')
    expect(await readFile(effectRule, 'utf8')).toBe(beforeRemoval)
    await writeFile(join(project, 'biome.jsonc'), configured)
    context.ui.confirm = async (): Promise<boolean> => {
      await writeFile(effectRule, `${beforeRemoval}\n`)
      return true
    }
    await extension.invokeCommand('anti-slop-remove', '--config biome.jsonc', context)
    expect(notification).toContain('changed during approval')
    expect(await readFile(join(project, 'biome.jsonc'), 'utf8')).toBe(configured)
    await writeFile(effectRule, beforeRemoval)
    context.ui.confirm = async (): Promise<boolean> => {
      context.isProjectTrusted = (): boolean => false
      return true
    }
    await extension.invokeCommand('anti-slop-remove', '--config biome.jsonc', context)
    expect(notification).toContain('trust or target changed')
    context.isProjectTrusted = (): boolean => true
    await symlink(temp, join(project, 'tools/biome/anti-slop/local-link'))
    context.ui.confirm = async (): Promise<boolean> => true
    await extension.invokeCommand('anti-slop-remove', '--config biome.jsonc', context)
    expect(notification).toContain('cannot be updated safely')
    expect(await readFile(effectRule, 'utf8')).toBe(beforeRemoval)
    await rm(join(project, 'tools/biome/anti-slop/local-link'))
    await extension.invokeCommand('anti-slop-remove', '--config biome.jsonc', context)
    const removedConfig = await readFile(join(project, 'biome.jsonc'), 'utf8')
    expect(removedConfig).toContain('// local policy')
    expect(removedConfig).toContain('// local plugin')
    expect(removedConfig).toContain('./local.ts')
    expect(removedConfig).not.toContain('anti-slop.ts')
    const inspectedConfig = spawnSync(
      join(project, 'node_modules/.bin/biome'),
      ['inspect', 'config', '--config-path', join(project, 'biome.jsonc')],
      { cwd: project, encoding: 'utf8' },
    )
    expect(inspectedConfig.status).toBe(0)
    expect(await readFile(join(project, 'tools/biome/anti-slop/biome-config.backup'), 'utf8')).toBe(jsonc)
    await expect(readFile(effectRule)).rejects.toThrow()
    await extension.invokeCommand('anti-slop-remove', '--config biome.jsonc', context)
    expect(notification).toContain('ownership is unknown')

    await rm(join(project, 'tools'), { recursive: true })
    await rm(join(project, 'biome.jsonc'))
    const child = join(project, 'packages', 'my app')
    await mkdir(child, { recursive: true })
    context.cwd = child
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(notification).toContain('Inherited configuration requires review')
    await expect(readFile(join(child, 'biome.json'))).rejects.toThrow()
    await writeFile(join(child, 'biome.jsonc'), '{"root":true}')
    context.cwd = project
    const asset = join(bundle, 'assets/anti-slop/no-reflect-apply.ts')
    const original = await readFile(asset, 'utf8')
    context.ui.confirm = async (): Promise<boolean> => {
      await writeFile(asset, `${original}\\n`)
      return true
    }
    await extension.invokeCommand('anti-slop-install', '--config "packages/my app/biome.jsonc"', context)
    expect(notification).toContain('changed during approval')
    await expect(readFile(join(child, 'tools/biome/anti-slop/rules/anti-slop.ts'))).rejects.toThrow()
    await writeFile(asset, original)
    context.ui.confirm = async (): Promise<boolean> => {
      context.isProjectTrusted = (): boolean => false
      return true
    }
    await extension.invokeCommand('anti-slop-install', '--config "packages/my app/biome.jsonc"', context)
    expect(notification).toContain('trust or target changed')
    context.isProjectTrusted = (): boolean => true
    context.ui.confirm = async (): Promise<boolean> => true
    await extension.invokeCommand('anti-slop-install', '--config "packages/my app/biome.jsonc"', context)
    expect(await readFile(join(child, 'tools/biome/anti-slop/rules/anti-slop.ts'), 'utf8')).toContain(
      'no-reflect-apply',
    )

    await rm(join(child, 'tools'), { recursive: true })
    await symlink(temp, join(child, 'tools'))
    await extension.invokeCommand('anti-slop-install', '--config "packages/my app/biome.jsonc"', context)
    expect(notification).toContain('unsafe parent')
    expect(await readFile(join(child, 'biome.jsonc'), 'utf8')).toContain('anti-slop.ts')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 120000)
