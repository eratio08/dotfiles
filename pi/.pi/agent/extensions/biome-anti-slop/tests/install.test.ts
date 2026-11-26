import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ExecOptions, ExecResult } from '@earendil-works/pi-coding-agent'
import { createFakeExtensionContext, installFakePlugin } from '@eratio/pi-effect/testing'

test('should accept Biome versions at or above the minimum given a target configuration', async () => {
  const project = await mkdtemp(join(tmpdir(), 'biome-anti-slop-version-'))

  try {
    await mkdir(join(project, 'node_modules/@biomejs/biome'), { recursive: true })
    await mkdir(join(project, 'node_modules/.bin'))
    await symlink(resolve('node_modules/.bin/biome'), join(project, 'node_modules/.bin/biome'))
    await writeFile(join(project, '.gitignore'), 'node_modules/\n')
    await writeFile(join(project, 'biome.json'), '{"root":true}\n')
    expect(spawnSync('git', ['init', '-q', project]).status).toBe(0)
    expect(spawnSync('git', ['add', '.gitignore', 'biome.json'], { cwd: project }).status).toBe(0)

    const factory = (await import('../index.ts')).default
    const extension = await installFakePlugin(factory)
    let inspected = false
    extension.api.exec = async (command: string, args: string[], options?: ExecOptions): Promise<ExecResult> => {
      if (args[0] === 'inspect' && args[1] === 'config') inspected = true
      const result = spawnSync(command, args, { cwd: options?.cwd, encoding: 'utf8' })
      return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.status ?? -1, killed: false }
    }
    const context = createFakeExtensionContext(project)
    context.hasUI = true
    context.ui.confirm = async (): Promise<boolean> => false
    let notification = ''
    context.ui.notify = (message: string): void => {
      notification = message
    }

    for (const [version, supported] of [
      ['2.6.3', false],
      ['2.6.4-rc.1', false],
      ['2.6.5-rc.01', false],
      ['02.6.4', false],
      ['2.6.4', true],
      ['2.6.4+build.1', true],
      ['2.6.5-rc.1', true],
      ['2.6.5', true],
      ['2.10.0', true],
      ['3.0.0', true],
      ['invalid', false],
    ] as const) {
      inspected = false
      notification = ''
      await writeFile(join(project, 'node_modules/@biomejs/biome/package.json'), JSON.stringify({ version }))
      await extension.invokeCommand('anti-slop-install', '', context)
      expect(inspected).toBe(supported)
      expect(notification).toContain(supported ? 'No files changed.' : 'Biome 2.6.4')
    }

    await writeFile(join(project, 'node_modules/@biomejs/biome/package.json'), '{"version":"2.6.5"}')
    await rm(join(project, 'node_modules/.bin/biome'))
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(notification).toContain('The target Biome executable is unavailable.')
  } finally {
    await rm(project, { recursive: true, force: true })
  }
}, 30000)

test('should install approved rules given a simple repository', async () => {
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
    const context = createFakeExtensionContext(project)
    context.hasUI = true
    let notification = ''
    let confirmation = ''
    context.ui.notify = (message: string): void => {
      notification = message
    }
    context.ui.confirm = async (_title: string, message: string): Promise<boolean> => {
      confirmation = message
      return true
    }
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(notification).toBe('Biome anti-slop rules were installed. Run Biome.')
    expect(confirmation).toContain('require-safety-comment-for-type-assertion')
    expect(confirmation).toContain('Effect rules: disabled')
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
      plugins: string[]
    }
    expect(installedConfig.plugins).toEqual(['./tools/biome/anti-slop/rules/anti-slop.ts'])
    const entrypoint = await readFile(join(project, 'tools/biome/anti-slop/rules/anti-slop.ts'), 'utf8')
    expect(entrypoint).toContain("export * from './no-runtime-typeof.ts'")
    expect(entrypoint).not.toContain('no-service-constructor-imports')
    expect(installedConfig.files.includes).toEqual(['**', '!**/tools/biome/anti-slop'])
    const installedLint = spawnSync(join(project, 'node_modules/.bin/biome'), ['lint', 'bad.ts'], {
      cwd: project,
      encoding: 'utf8',
    })
    expect(installedLint.stderr).toContain('Replace `Reflect.apply`')
    expect(installedLint.stderr).toContain('A `typeof` check narrows')
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
    await extension.invokeCommand(
      'anti-slop-install',
      `--config ${join(await realpath(existing), 'biome.jsonc')}`,
      context,
    )
    expect(notification).toContain('trust')
    context.cwd = existing
    expect(spawnSync('git', ['add', 'biome.jsonc'], { cwd: existing }).status).toBe(0)
    await writeFile(join(existing, 'ignored.ts'), 'Reflect.apply(fn, null, []);\n')
    await mkdir(join(existing, 'excluded'))
    await writeFile(join(existing, 'excluded/skip.ts'), 'Reflect.apply(fn, null, []);\n')
    await mkdir(join(existing, 'tools/biome/anti-slop'), { recursive: true })
    await writeFile(join(existing, 'tools/biome/anti-slop/keep.txt'), 'local customization')
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(notification).toContain('destination already exists')
    expect(await readFile(join(existing, 'tools/biome/anti-slop/keep.txt'), 'utf8')).toBe('local customization')
    await rm(join(existing, 'tools/biome'), { recursive: true })
    context.ui.confirm = async (): Promise<boolean> => {
      await writeFile(join(existing, 'biome.jsonc'), `${existingConfig}// User edit\n`)
      return true
    }
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(notification).toContain('changed during approval')
    const dirtyConfig = `${existingConfig}// User edit\n`
    expect(await readFile(join(existing, 'biome.jsonc'), 'utf8')).toBe(dirtyConfig)
    context.hasUI = false
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(notification).toContain('confirmation dialog')
    context.hasUI = true
    context.ui.confirm = async (): Promise<boolean> => false
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(notification).toContain('No files changed')
    context.ui.confirm = async (): Promise<boolean> => true
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(notification).toContain('were installed')
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
    context.cwd = child
    context.hasUI = false
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(notification).toContain('confirmation dialog')
    context.hasUI = true
    context.ui.confirm = async (): Promise<boolean> => true
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(notification).toContain('were installed')
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
    context.cwd = missing
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(notification).toContain('Biome 2.6.4 or newer is not installed')
    await expect(readFile(join(missing, 'biome.json'))).rejects.toThrow()
    await mkdir(join(missing, 'node_modules/@biomejs/biome'), { recursive: true })
    await writeFile(join(missing, 'node_modules/@biomejs/biome/package.json'), '{"version":"2.5.0"}')
    await extension.invokeCommand('anti-slop-install', '', context)
    expect(notification).toContain('Biome 2.6.4 or newer is required')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 360000)
