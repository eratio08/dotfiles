import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { ExecOptions, ExecResult, ExtensionToolContext } from '@earendil-works/pi-coding-agent'
import { createFakeExtensionContext, installFakePlugin } from '@eratio/pi-effect/testing'

test('should install an approved partial port given a simple repository', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'biome-anti-slop-install-'))
  const project = join(temp, 'project')
  const extensionDir = join(temp, 'extension')

  try {
    await mkdir(project)
    await mkdir(extensionDir)
    for (const name of ['index.ts', 'src', 'assets']) {
      await cp(resolve(name), join(extensionDir, name), { recursive: true })
    }
    await mkdir(join(extensionDir, 'node_modules'))
    for (const name of ['@earendil-works', 'typebox', 'jsonc-parser', 'yaml']) {
      await symlink(resolve('node_modules', name), join(extensionDir, 'node_modules', name))
    }
    await mkdir(join(project, 'node_modules/@biomejs'), { recursive: true })
    await mkdir(join(project, 'node_modules/.bin'))
    await symlink(resolve('node_modules/@biomejs/biome'), join(project, 'node_modules/@biomejs/biome'))
    await symlink(resolve('node_modules/.bin/biome'), join(project, 'node_modules/.bin/biome'))
    await writeFile(join(project, '.gitignore'), 'node_modules/\nbun.lock\n')
    await writeFile(join(project, 'bad.ts'), 'Reflect.apply(fn, null, []); typeof input === "number";\n')
    expect(spawnSync('git', ['init', '-q', project]).status).toBe(0)

    const factory = (await import(join(extensionDir, 'index.ts'))).default
    const extension = await installFakePlugin(factory)
    extension.api.exec = async (command: string, args: string[], options?: ExecOptions): Promise<ExecResult> => {
      const result = spawnSync(command, args, { cwd: options?.cwd, encoding: 'utf8' })
      return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.status ?? -1, killed: false }
    }
    const context = createFakeExtensionContext(project) as ExtensionToolContext
    const invoke = async (
      operation: 'inspect' | 'install',
      previewHash?: string,
      root?: string,
      signal?: AbortSignal,
    ): Promise<{
      details: {
        status: string
        preview: {
          hash: string
          missingRules: string[]
          issues: string[]
          packageManager: string | null
          biomeVersion: string | null
        }
      }
    }> => {
      context.cwd = root ?? project
      return (await extension.invokeTool(
        'biome_anti_slop',
        'test',
        { operation, previewHash, root },
        context,
        signal,
      )) as {
        details: {
          status: string
          preview: {
            hash: string
            missingRules: string[]
            issues: string[]
            packageManager: string | null
            biomeVersion: string | null
          }
        }
      }
    }

    const preview = await invoke('inspect')
    expect(preview.details.preview.issues).toEqual([])
    expect(preview.details.preview.missingRules).toHaveLength(2)
    context.isProjectTrusted = (): boolean => false
    const untrusted = await invoke('inspect')
    expect(untrusted.details.status).toBe('blocked')
    context.isProjectTrusted = (): boolean => true
    context.hasUI = false
    expect((await invoke('install', preview.details.preview.hash)).details.status).toBe('blocked')
    context.hasUI = true
    let confirmation = ''
    context.ui.confirm = async (_title: string, message: string): Promise<boolean> => {
      confirmation = message
      return false
    }
    expect((await invoke('install', preview.details.preview.hash)).details.status).toBe('declined')
    expect(confirmation).toContain('- no-reflect-apply')
    expect(confirmation).toContain('require-safety-comment-for-type-assertion')
    expect(confirmation).not.toContain('./tools/biome/anti-slop/rules/no-reflect-apply.ts')
    expect(confirmation).not.toContain(join(project, 'tools/biome/anti-slop'))
    expect(confirmation).not.toContain('repositoryFiles')
    expect(confirmation).not.toContain('copy rules, tests')
    await expect(readFile(join(project, 'biome.json'))).rejects.toThrow()

    const bundledRule = join(extensionDir, 'assets/anti-slop/no-reflect-apply.ts')
    const originalRule = await readFile(bundledRule, 'utf8')
    context.ui.confirm = async (): Promise<boolean> => {
      await writeFile(bundledRule, `${originalRule}\n`)
      return true
    }
    expect((await invoke('install', preview.details.preview.hash)).details.status).toBe('blocked')
    await writeFile(bundledRule, originalRule)
    await expect(readFile(join(project, 'biome.json'))).rejects.toThrow()

    const outside = join(temp, 'outside')
    await mkdir(outside)
    await symlink(outside, join(project, 'tools'))
    expect((await invoke('install', preview.details.preview.hash)).details.status).toBe('blocked')
    await rm(join(project, 'tools'))

    context.ui.confirm = async (): Promise<boolean> => {
      await writeFile(join(project, 'bun.lock'), 'local lockfile')
      return true
    }
    expect((await invoke('install', preview.details.preview.hash)).details.status).toBe('blocked')
    expect(await readFile(join(project, 'bun.lock'), 'utf8')).toBe('local lockfile')
    await rm(join(project, 'bun.lock'))

    const cancellation = new AbortController()
    context.ui.confirm = async (): Promise<boolean> => {
      cancellation.abort()
      return true
    }
    await expect(invoke('install', preview.details.preview.hash, undefined, cancellation.signal)).rejects.toThrow(
      'Created paths: none',
    )
    await expect(readFile(join(project, 'biome.json'))).rejects.toThrow()
    context.ui.confirm = async (): Promise<boolean> => true
    expect((await invoke('install', preview.details.preview.hash)).details.status).toBe('installed')
    expect((await readdir(join(project, 'tools/biome/anti-slop/rules'))).every((name) => name.endsWith('.ts'))).toBe(
      true,
    )
    expect(await readdir(join(project, 'tools/biome/anti-slop'))).toContain('LICENSE')
    expect(await readdir(join(project, 'tools/biome/anti-slop'))).not.toContain('tests')
    const stateCheck = spawnSync(
      join(project, 'node_modules/.bin/biome'),
      ['check', 'tools/biome/anti-slop', '--no-errors-on-unmatched'],
      {
        cwd: project,
        encoding: 'utf8',
      },
    )
    expect(stateCheck.status).toBe(0)
    const installedConfig = JSON.parse(await readFile(join(project, 'biome.json'), 'utf8')) as {
      files: { includes: string[] }
    }
    expect(installedConfig.files.includes).toEqual(['**', '!**/tools/biome/anti-slop'])
    const installedLint = spawnSync(join(project, 'node_modules/.bin/biome'), ['lint', 'bad.ts'], {
      cwd: project,
      encoding: 'utf8',
    })
    expect(installedLint.stderr).toContain('Replace `Reflect.apply`')
    expect(installedLint.stderr).not.toContain('Failed to compile the JS plugin')

    const existing = join(temp, 'existing')
    await mkdir(existing)
    await mkdir(join(existing, 'node_modules/@biomejs'), { recursive: true })
    await mkdir(join(existing, 'node_modules/.bin'))
    await symlink(resolve('node_modules/@biomejs/biome'), join(existing, 'node_modules/@biomejs/biome'))
    await symlink(resolve('node_modules/.bin/biome'), join(existing, 'node_modules/.bin/biome'))
    await mkdir(join(existing, 'tools'))
    await writeFile(join(existing, 'tools/keep.txt'), 'keep')
    await writeFile(join(existing, '.gitignore'), 'node_modules/\n')
    await writeFile(join(existing, 'base.json'), '{"plugins":["./base.ts"]}')
    await writeFile(
      join(existing, 'base.ts'),
      "import {ast,defineRule,registerDiagnostic} from '@biomejs/runtime/plugin'; const base=defineRule({query:ast('JS_DEBUGGER_STATEMENT'),run(n){registerDiagnostic(n,'error','BASE_PLUGIN_FINDING');}});export {base};",
    )
    await writeFile(
      join(existing, 'local.ts'),
      "import {ast,defineRule,registerDiagnostic} from '@biomejs/runtime/plugin'; const local=defineRule({query:ast('JS_DEBUGGER_STATEMENT'),run(n){registerDiagnostic(n,'error','LOCAL_PLUGIN_FINDING');}});export {local};",
    )
    const existingConfig =
      '{\n  // Project policy\n  "root": true,\n  "extends": ["./base.json"],\n  "plugins": [\n    "./local.ts", // Local rule\n  ],\n  "linter": { "rules": { "preset": "none" } },\n  "files": { "includes": ["**", "!**/excluded/**"] },\n  "overrides": [{ "includes": ["**/ignored.ts"], "linter": { "enabled": false } }],\n}\n'.replaceAll(
        '\\"',
        '"',
      )
    await writeFile(join(existing, 'biome.jsonc'), existingConfig)
    await writeFile(join(existing, 'bad.ts'), 'debugger; Reflect.apply(fn, null, []);\n')
    expect(spawnSync('git', ['init', '-q', existing]).status).toBe(0)
    const foreign = (await extension.invokeTool(
      'biome_anti_slop',
      'foreign',
      { operation: 'inspect', root: existing },
      context,
    )) as { details: { status: string } }
    expect(foreign.details.status).toBe('blocked')
    expect(spawnSync('git', ['add', 'biome.jsonc'], { cwd: existing }).status).toBe(0)
    await writeFile(join(existing, 'ignored.ts'), 'Reflect.apply(fn, null, []);\n')
    await mkdir(join(existing, 'excluded'))
    await writeFile(join(existing, 'excluded/skip.ts'), 'Reflect.apply(fn, null, []);\n')
    await mkdir(join(existing, 'tools/biome/anti-slop'), { recursive: true })
    await writeFile(join(existing, 'tools/biome/anti-slop/keep.txt'), 'local customization')
    const collision = await invoke('inspect', undefined, existing)
    expect(collision.details.preview.issues).toContain('The destination already exists.')
    expect((await invoke('install', collision.details.preview.hash, existing)).details.status).toBe('blocked')
    expect(await readFile(join(existing, 'tools/biome/anti-slop/keep.txt'), 'utf8')).toBe('local customization')
    await rm(join(existing, 'tools/biome'), { recursive: true })
    const stale = await invoke('inspect', undefined, existing)
    context.ui.confirm = async (): Promise<boolean> => {
      await writeFile(join(existing, 'biome.jsonc'), `${existingConfig}// User edit\n`)
      return true
    }
    expect((await invoke('install', stale.details.preview.hash, existing)).details.status).toBe('blocked')
    const dirtyConfig = `${existingConfig}// User edit\n`
    expect(await readFile(join(existing, 'biome.jsonc'), 'utf8')).toBe(dirtyConfig)
    const existingPreview = await invoke('inspect', undefined, existing)
    expect(existingPreview.details.preview.issues).toEqual([])
    context.hasUI = false
    context.sessionManager.getBranch = (): ReturnType<typeof context.sessionManager.getBranch> => [
      {
        type: 'message',
        id: '1',
        parentId: null,
        timestamp: new Date().toISOString(),
        message: {
          role: 'user',
          content: `approve biome-anti-slop install ${existingPreview.details.preview.hash}`,
          timestamp: Date.now(),
        },
      },
    ]
    expect((await invoke('install', existingPreview.details.preview.hash, existing)).details.status).toBe('installed')
    context.hasUI = true
    const updatedConfig = await readFile(join(existing, 'biome.jsonc'), 'utf8')
    expect(updatedConfig).toContain('"./local.ts", // Local rule')
    expect(updatedConfig).toContain('// Project policy')
    expect(updatedConfig).toContain('// User edit')
    expect(await readFile(join(existing, 'tools/biome/anti-slop/biome-config.backup'), 'utf8')).toBe(dirtyConfig)
    expect(await readFile(join(existing, 'tools/keep.txt'), 'utf8')).toBe('keep')
    const existingLint = spawnSync(join(existing, 'node_modules/.bin/biome'), ['lint', 'bad.ts'], {
      cwd: existing,
      encoding: 'utf8',
    })
    expect(existingLint.stderr).toContain('BASE_PLUGIN_FINDING')
    expect(existingLint.stderr).toContain('LOCAL_PLUGIN_FINDING')
    expect(existingLint.stderr).toContain('Replace `Reflect.apply`')
    const installedRule = join(existing, 'tools/biome/anti-slop/rules/no-reflect-apply.ts')
    const installedRuleBefore = await readFile(installedRule, 'utf8')
    const assetCheck = spawnSync(
      join(existing, 'node_modules/.bin/biome'),
      ['check', '--write', installedRule, '--no-errors-on-unmatched'],
      { cwd: existing, encoding: 'utf8' },
    )
    expect(assetCheck.status).toBe(0)
    expect(await readFile(installedRule, 'utf8')).toBe(installedRuleBefore)
    const ignored = spawnSync(
      join(existing, 'node_modules/.bin/biome'),
      ['lint', 'ignored.ts', '--no-errors-on-unmatched'],
      { cwd: existing, encoding: 'utf8' },
    )
    expect(ignored.stderr).not.toContain('Replace `Reflect.apply`')
    const excluded = spawnSync(
      join(existing, 'node_modules/.bin/biome'),
      ['lint', 'excluded/skip.ts', '--no-errors-on-unmatched'],
      { cwd: existing, encoding: 'utf8' },
    )
    expect(excluded.stderr).not.toContain('Replace `Reflect.apply`')

    const workspace = join(temp, 'workspace')
    const child = join(workspace, 'packages/app')
    await mkdir(child, { recursive: true })
    await symlink(join(existing, 'node_modules'), join(workspace, 'node_modules'))
    await writeFile(join(workspace, '.gitignore'), 'node_modules/\n')
    await writeFile(
      join(workspace, 'package.json'),
      '{"private":true,"packageManager":"bun@1.2.0","workspaces":["packages/*"]}',
    )
    await writeFile(join(workspace, 'AGENTS.md'), 'Workspace instruction.\n')
    await writeFile(
      join(workspace, 'biome.json'),
      '{"root":true,"plugins":["./base.ts"],"linter":{"rules":{"preset":"none"}}}',
    )
    await writeFile(join(workspace, 'base.ts'), await readFile(join(existing, 'base.ts')))
    await writeFile(join(child, 'biome.jsonc'), '{\n  "root": false,\n  "extends": "//", // Workspace policy\n}\n')
    await writeFile(join(child, 'bad.ts'), 'debugger; Reflect.apply(fn, null, []);\n')
    expect(spawnSync('git', ['init', '-q', workspace]).status).toBe(0)
    const workspacePreview = await invoke('inspect', undefined, child)
    expect(workspacePreview.details.preview.issues).toEqual([])
    expect(workspacePreview.details.preview.packageManager).toBe('bun@1.2.0')
    expect(workspacePreview.details.preview.biomeVersion).toBe('2.6.4')
    context.hasUI = false
    expect((await invoke('install', workspacePreview.details.preview.hash, child)).details.status).toBe('blocked')
    context.sessionManager.getBranch = (): ReturnType<typeof context.sessionManager.getBranch> => [
      {
        type: 'message',
        id: 'invalid',
        parentId: null,
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: { text: 'approval' } as never, timestamp: Date.now() },
      },
    ]
    expect((await invoke('install', workspacePreview.details.preview.hash, child)).details.status).toBe('blocked')
    context.sessionManager.getBranch = (): ReturnType<typeof context.sessionManager.getBranch> => [
      {
        type: 'message',
        id: '2',
        parentId: null,
        timestamp: new Date().toISOString(),
        message: {
          role: 'user',
          content: `approve biome-anti-slop install ${workspacePreview.details.preview.hash}`,
          timestamp: Date.now(),
        },
      },
    ]
    expect((await invoke('install', workspacePreview.details.preview.hash, child)).details.status).toBe('installed')
    expect(await readFile(join(child, 'biome.jsonc'), 'utf8')).toContain('// Workspace policy')
    const workspaceLint = spawnSync(join(workspace, 'node_modules/.bin/biome'), ['lint', 'bad.ts'], {
      cwd: child,
      encoding: 'utf8',
    })
    expect(workspaceLint.stderr).toContain('BASE_PLUGIN_FINDING')
    expect(workspaceLint.stderr).toContain('Replace `Reflect.apply`')

    context.cwd = project
    await rename(join(extensionDir, 'assets'), join(extensionDir, 'unavailable-assets'))
    await writeFile(join(project, 'arrays.ts'), 'const users = []; users.filter(active).map(email);\n')
    const arrayFinding = spawnSync(join(project, 'node_modules/.bin/biome'), ['lint', 'arrays.ts'], {
      cwd: project,
      encoding: 'utf8',
    })
    expect(arrayFinding.stderr).toContain('Avoid consecutive array')
    await writeFile(join(project, 'arrays.ts'), 'function collect(users) { return users.filter(active).map(email); }\n')
    const unknownArray = spawnSync(join(project, 'node_modules/.bin/biome'), ['lint', 'arrays.ts'], {
      cwd: project,
      encoding: 'utf8',
    })
    expect(unknownArray.stderr).not.toContain('Avoid consecutive array')
    await writeFile(join(project, 'reducer.ts'), 'items.reduce((acc, item) => acc.concat(item), []);\n')
    const reducerFinding = spawnSync(join(project, 'node_modules/.bin/biome'), ['lint', 'reducer.ts'], {
      cwd: project,
      encoding: 'utf8',
    })
    expect(reducerFinding.stderr).toContain('Do not copy the reducer accumulator')
    await writeFile(join(project, 'spread.ts'), 'let acc = []; for (const item of items) { acc = [...acc, item]; }\n')
    const spreadFinding = spawnSync(join(project, 'node_modules/.bin/biome'), ['lint', 'spread.ts'], {
      cwd: project,
      encoding: 'utf8',
    })
    expect(spreadFinding.stderr).toContain('Do not spread accumulators in loops')
    await writeFile(
      join(project, 'widen.ts'),
      'const source = {}; const value: unknown = source; const parsed = value as { id: string };\n',
    )
    const widenFinding = spawnSync(join(project, 'node_modules/.bin/biome'), ['lint', 'widen.ts'], {
      cwd: project,
      encoding: 'utf8',
    })
    expect(widenFinding.stderr).toContain('discards type evidence')
    await writeFile(
      join(project, 'known.ts'),
      'type Index<T> = Record<string, T>; const value: Index<number> = { n: 1 };\n',
    )
    const knownFinding = spawnSync(join(project, 'node_modules/.bin/biome'), ['lint', 'known.ts'], {
      cwd: project,
      encoding: 'utf8',
    })
    expect(knownFinding.stderr).toContain('discards known type evidence')
    await writeFile(join(project, 'dictionary.ts'), 'type Unsafe = Record<string, unknown>;\n')
    const dictionaryFinding = spawnSync(join(project, 'node_modules/.bin/biome'), ['lint', 'dictionary.ts'], {
      cwd: project,
      encoding: 'utf8',
    })
    expect(dictionaryFinding.stderr).toContain("dictionary's unknown value type")
    await writeFile(join(project, 'contracts.ts'), 'function parse(value: object): unknown { return value; }\n')
    const contractsFinding = spawnSync(join(project, 'node_modules/.bin/biome'), ['lint', 'contracts.ts'], {
      cwd: project,
      encoding: 'utf8',
    })
    expect(contractsFinding.stderr).toContain('uses the broad `object` type')
    expect(contractsFinding.stderr).toContain('This function exposes `unknown`')
    await writeFile(join(project, 'mocking.ts'), 'vi.mock("./module");\n')
    const mockingFinding = spawnSync(join(project, 'node_modules/.bin/biome'), ['lint', 'mocking.ts'], {
      cwd: project,
      encoding: 'utf8',
    })
    expect(mockingFinding.stderr).toContain('Replace module mocking')
    const typeofRule = join(project, 'tools/biome/anti-slop/rules/no-runtime-typeof.ts')
    const typeofSource = await readFile(typeofRule, 'utf8')
    await writeFile(
      join(project, 'guard.ts'),
      'function isString(value: unknown): value is string { return typeof value === "string"; }\n',
    )
    const defaultGuard = spawnSync(join(project, 'node_modules/.bin/biome'), ['lint', 'guard.ts'], {
      cwd: project,
      encoding: 'utf8',
    })
    expect(defaultGuard.stderr).toContain('A `typeof` check narrows a representation')
    await writeFile(
      typeofRule,
      typeofSource.replace('const allowInTypeGuards = false', 'const allowInTypeGuards = true'),
    )
    const allowedGuard = spawnSync(join(project, 'node_modules/.bin/biome'), ['lint', 'guard.ts'], {
      cwd: project,
      encoding: 'utf8',
    })
    expect(allowedGuard.stderr).not.toContain('A `typeof` check narrows a representation')
    await rename(join(extensionDir, 'unavailable-assets'), join(extensionDir, 'assets'))
    const verify = async (
      signal?: AbortSignal,
    ): Promise<{ details: { status: string; checks: { check: string; status: string; fullOutputPath?: string }[] } }> =>
      (await extension.invokeTool('biome_anti_slop', 'verify', { operation: 'check' }, context, signal)) as {
        details: { status: string; checks: { check: string; status: string; fullOutputPath?: string }[] }
      }
    const badBefore = await readFile(join(project, 'bad.ts'), 'utf8')
    const check = await verify()
    expect(await readFile(join(project, 'bad.ts'), 'utf8')).toBe(badBefore)
    expect(check.details.checks.find((item) => item.check === 'Biome lint')?.status).toBe('findings')
    expect(check.details.checks.find((item) => item.check === 'target typecheck')?.status).toBe('unavailable')
    const copiedRule = join(project, 'tools/biome/anti-slop/rules/no-reflect-apply.ts')
    const copiedSource = await readFile(copiedRule, 'utf8')
    await writeFile(copiedRule, 'invalid plugin "')
    const failedCheck = await verify()
    expect(failedCheck.details.checks.find((item) => item.check === 'Biome lint')?.status).toBe('plugin-load-error')
    await writeFile(
      copiedRule,
      copiedSource +
        "\nimport { ast as crashQuery, defineRule as defineCrash } from '@biomejs/runtime/plugin'; export const runtimeCrash = defineCrash({query: crashQuery('JS_DEBUGGER_STATEMENT'), run() { throw new Error('test runtime failure'); }});\n",
    )
    await writeFile(join(project, 'runtime-crash.ts'), 'debugger;\n')
    const crashedCheck = await verify()
    expect(crashedCheck.details.checks.find((item) => item.check === 'Biome lint')?.status).toBe('failed')
    await rm(join(project, 'runtime-crash.ts'))
    await writeFile(copiedRule, copiedSource)
    context.isProjectTrusted = (): boolean => false
    expect((await verify()).details.status).toBe('blocked')
    context.isProjectTrusted = (): boolean => true
    const aborted = new AbortController()
    aborted.abort()
    expect((await verify(aborted.signal)).details.checks.find((item) => item.check === 'Biome lint')?.status).toBe(
      'cancelled',
    )

    await writeFile(
      join(project, 'package.json'),
      JSON.stringify({ scripts: { lint: 'biome lint .', typecheck: 'tsc --noEmit' } }),
    )
    await symlink(resolve('node_modules/.bin/tsc'), join(project, 'node_modules/.bin/tsc'))
    await writeFile(
      join(project, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { noEmit: true, skipLibCheck: true }, files: ['good.ts'] }),
    )
    await writeFile(join(project, 'good.ts'), 'const value: number = 1;\n')
    expect((await verify()).details.checks.find((item) => item.check === 'target typecheck')?.status).toBe('passed')
    const execute = extension.api.exec
    extension.api.exec = async (command: string, args: string[], options?: ExecOptions): Promise<ExecResult> => {
      if (command.endsWith('/tsc')) return { stdout: 'x'.repeat(16000), stderr: '', code: 0, killed: false }
      return execute(command, args, options)
    }
    const large = (await verify()).details.checks.find((item) => item.check === 'target typecheck')
    expect(large?.status).toBe('passed')
    const outputPath = large?.fullOutputPath
    expect(outputPath).toBeDefined()
    if (!outputPath) throw new Error('Verification did not save its full output.')
    expect((await readFile(outputPath, 'utf8')).includes('x'.repeat(16000))).toBe(true)
    await rm(dirname(outputPath), { recursive: true, force: true })
    extension.api.exec = execute
    const lint = spawnSync(join(project, 'node_modules/.bin/biome'), ['lint', 'bad.ts'], {
      cwd: project,
      encoding: 'utf8',
    })
    expect(lint.status).toBe(1)
    expect(lint.stderr).toContain('Replace `Reflect.apply`')
    expect(lint.stderr).toContain('A `typeof` check narrows a representation')

    const missing = join(temp, 'missing-biome')
    await mkdir(missing)
    expect(spawnSync('git', ['init', '-q', missing]).status).toBe(0)
    const missingPreview = await invoke('inspect', undefined, missing)
    expect(missingPreview.details.preview.issues).toContain('Biome 2.6.4 is not installed in the target or workspace.')
    expect((await invoke('install', missingPreview.details.preview.hash, missing)).details.status).toBe('blocked')
    await expect(readFile(join(missing, 'biome.json'))).rejects.toThrow()
    const missingCheck = (await extension.invokeTool(
      'biome_anti_slop',
      'missing',
      { operation: 'check' },
      context,
    )) as { details: { checks: { check: string; status: string }[] } }
    expect(missingCheck.details.checks.find((item) => item.check === 'Biome lint')?.status).toBe('unavailable')
    await mkdir(join(missing, 'node_modules/@biomejs/biome'), { recursive: true })
    await writeFile(join(missing, 'node_modules/@biomejs/biome/package.json'), '{"version":"2.5.0"}')
    const incompatible = await invoke('inspect', undefined, missing)
    expect(incompatible.details.preview.issues).toContain('Biome 2.6.4 is required; found 2.5.0.')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 360000)
