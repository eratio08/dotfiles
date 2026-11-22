import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ExecOptions, ExecResult } from '@earendil-works/pi-coding-agent'
import { createFakeExtensionContext, installFakePlugin } from '@eratio/pi-effect/testing'
import extensionFactory from '../index.ts'

test('should enable Effect rules only with the explicit command flag', async () => {
  const root = await mkdtemp(join(tmpdir(), 'biome-effect-install-'))
  try {
    expect(spawnSync('git', ['init', '-q', root]).status).toBe(0)
    await mkdir(join(root, 'node_modules/@biomejs'), { recursive: true })
    await mkdir(join(root, 'node_modules/.bin'))
    await symlink(resolve('node_modules/@biomejs/biome'), join(root, 'node_modules/@biomejs/biome'))
    await symlink(resolve('node_modules/.bin/biome'), join(root, 'node_modules/.bin/biome'))
    await writeFile(join(root, '.gitignore'), 'node_modules/\n')
    await writeFile(join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*', '!packages/excluded'] }))
    await writeFile(join(root, 'bun.lock'), 'effect is transitive here')
    await mkdir(join(root, 'packages/app'), { recursive: true })
    await mkdir(join(root, 'packages/excluded'))
    await writeFile(join(root, 'packages/app/package.json'), '{}')
    await writeFile(join(root, 'packages/excluded/package.json'), '{"dependencies":{"effect":"1"}}')

    const extension = await installFakePlugin(extensionFactory)
    extension.api.exec = async (command: string, args: string[], options?: ExecOptions): Promise<ExecResult> => {
      const result = spawnSync(command, args, { cwd: options?.cwd, encoding: 'utf8' })
      return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.status ?? -1, killed: false }
    }
    const context = createFakeExtensionContext(root)
    context.hasUI = true
    context.ui.confirm = async (): Promise<boolean> => true
    await writeFile(join(root, 'packages/app/package.json'), '{"devDependencies":{"effect":"^3"}}')
    let confirmation = ''
    let notification = ''
    context.ui.notify = (message: string): void => {
      notification = message
    }
    context.ui.confirm = async (_title: string, message: string): Promise<boolean> => {
      confirmation = message
      return false
    }
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(confirmation).toContain('Effect rules: disabled')
    await extension.invokeCommand('anti-slop-install', '--effect', context)
    expect(confirmation).toContain('Effect rules: enabled')
    context.ui.confirm = async (): Promise<boolean> => {
      await writeFile(join(root, 'packages/app/package.json'), '{}')
      return true
    }
    await extension.invokeCommand('anti-slop-install', '--effect', context)
    expect(notification).toContain('changed during approval')
    await writeFile(join(root, 'packages/app/package.json'), '{"devDependencies":{"effect":"^3"}}')
    context.ui.confirm = async (_title: string, message: string): Promise<boolean> => {
      confirmation = message
      return true
    }
    await extension.invokeCommand('anti-slop-install', '--effect', context)
    expect(confirmation).toContain('Effect rules: enabled')
    expect(notification).toContain('were installed')
    await writeFile(join(root, 'packages/app/package.json'), '{}')
    await extension.invokeCommand('anti-slop-update', '', context)
    expect(confirmation).toContain('Effect rules: enabled')
    const config = await readFile(join(root, 'biome.json'), 'utf8')
    expect((JSON.parse(config) as { plugins: string[] }).plugins).toEqual([
      './tools/biome/anti-slop/rules/anti-slop.ts',
    ])
    const entrypoint = await readFile(join(root, 'tools/biome/anti-slop/rules/anti-slop.ts'), 'utf8')
    expect(entrypoint).toContain("export * from './no-service-constructor-imports.ts'")
    expect(entrypoint).toContain("export * from './no-reflect-apply.ts'")
    await writeFile(join(root, 'runtime.ts'), 'import { makeService } from "./service";\n')
    await writeFile(join(root, 'runtime.test.ts'), 'import { makeService } from "./service";\n')
    const biome = join(root, 'node_modules/.bin/biome')
    const normal = spawnSync(biome, ['lint', 'runtime.ts'], { cwd: root, encoding: 'utf8' })
    const testFile = spawnSync(biome, ['lint', 'runtime.test.ts'], { cwd: root, encoding: 'utf8' })
    expect(normal.stderr).toContain('Do not import Effect service constructor')
    expect(testFile.stderr).not.toContain('Do not import Effect service constructor')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}, 30000)
