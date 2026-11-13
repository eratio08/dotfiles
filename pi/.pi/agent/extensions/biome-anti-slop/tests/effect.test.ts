import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ExecOptions, ExecResult, ExtensionToolContext } from '@earendil-works/pi-coding-agent'
import { createFakeExtensionContext, installFakePlugin } from '@eratio/pi-effect/testing'
import extensionFactory from '../index.ts'

test('should select Effect from direct workspace dependencies or an explicit choice', async () => {
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
    const context = createFakeExtensionContext(root) as ExtensionToolContext
    context.hasUI = true
    context.ui.confirm = async (): Promise<boolean> => true
    const invoke = async (
      operation: 'inspect' | 'install' | 'inspect-update',
      effect?: boolean,
      previewHash?: string,
    ): Promise<{
      details: {
        status: string
        preview: {
          hash: string
          effectEnabled: boolean
          effectSelection: string
          effectManifests: string[]
          issues: string[]
          gaps: string[]
        }
      }
    }> =>
      (await extension.invokeTool('biome_anti_slop', 'effect', { operation, effect, previewHash }, context)) as never

    const noDirect = await invoke('inspect')
    expect(noDirect.details.preview.effectEnabled).toBe(false)
    expect(noDirect.details.preview.effectManifests).toEqual([])
    const forced = await invoke('inspect', true)
    expect(forced.details.preview.effectEnabled).toBe(true)
    expect((await invoke('install', false, forced.details.preview.hash)).details.status).toBe('blocked')
    await writeFile(join(root, 'package.json'), '{"workspaces":[12]}')
    expect(
      (await invoke('inspect')).details.preview.issues.some((issue) => issue.includes('workspace configuration')),
    ).toBe(true)
    await writeFile(join(root, 'package.json'), JSON.stringify({ workspaces: ['packages/*', '!packages/excluded'] }))
    await writeFile(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/app'\n")
    expect((await invoke('inspect')).details.preview.effectEnabled).toBe(false)
    await writeFile(join(root, 'pnpm-workspace.yaml'), 'packages: [broken\n')
    expect(
      (await invoke('inspect')).details.preview.issues.some((issue) => issue.includes('workspace configuration')),
    ).toBe(true)
    await writeFile(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/app'\n")
    await writeFile(join(root, 'packages/app/package.json'), '{"devDependencies":{"effect":"^3"}}')
    const direct = await invoke('inspect')
    expect(direct.details.preview.issues).toEqual([])
    expect(direct.details.preview.effectEnabled).toBe(true)
    expect(direct.details.preview.effectManifests).toEqual([await realpath(join(root, 'packages/app/package.json'))])
    expect((await invoke('inspect', false)).details.preview.effectEnabled).toBe(false)
    expect(direct.details.preview.gaps.some((gap) => gap.includes('package aliases'))).toBe(true)

    context.ui.confirm = async (): Promise<boolean> => {
      await writeFile(join(root, 'packages/app/package.json'), '{}')
      return true
    }
    expect((await invoke('install', undefined, direct.details.preview.hash)).details.status).toBe('blocked')
    await writeFile(join(root, 'packages/app/package.json'), '{"devDependencies":{"effect":"^3"}}')
    let confirmation = ''
    context.ui.confirm = async (_title: string, message: string): Promise<boolean> => {
      confirmation = message
      return true
    }
    const current = await invoke('inspect')
    expect((await invoke('install', undefined, current.details.preview.hash)).details.status).toBe('installed')
    expect(confirmation).toContain('- no-service-constructor-imports')
    expect(confirmation).not.toContain('./tools/biome/anti-slop/rules/no-service-constructor-imports.ts')
    await writeFile(join(root, 'packages/app/package.json'), '{}')
    expect((await invoke('inspect-update')).details.preview.effectEnabled).toBe(true)
    const config = await readFile(join(root, 'biome.json'), 'utf8')
    expect(config).toContain('no-service-constructor-imports.ts')
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
