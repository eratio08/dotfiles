import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('should expose plugin severity, suppression, and comment limits given Biome 2.6.4', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'biome-anti-slop-capabilities-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  const config = async (plugins: string[]): Promise<void> => {
    await writeFile(
      join(temp, 'biome.json'),
      JSON.stringify({ root: true, plugins, linter: { rules: { preset: 'none' } } }),
    )
  }
  const lint = async (source: string): Promise<{ severity: string; message: string }[]> => {
    await writeFile(join(temp, 'input.ts'), source)
    const result = spawnSync(biome, ['lint', '--config-path', temp, join(temp, 'input.ts'), '--reporter=json'], {
      encoding: 'utf8',
    })
    expect(result.error).toBeUndefined()
    return (JSON.parse(result.stdout) as { diagnostics: { severity: string; message: string }[] }).diagnostics
  }

  try {
    await cp(resolve('assets/anti-slop/no-reflect-apply.ts'), join(temp, 'reflect.ts'))
    await cp(resolve('assets/anti-slop/shared.ts'), join(temp, 'shared.ts'))
    await writeFile(
      join(temp, 'debugger.ts'),
      "import {ast,defineRule,registerDiagnostic} from '@biomejs/runtime/plugin'; const debuggerRule=defineRule({query:ast('JS_DEBUGGER_STATEMENT'),run(n){registerDiagnostic(n,'warning','DEBUGGER_RULE');}});export {debuggerRule};",
    )
    await config(['./reflect.ts', './debugger.ts'])
    const both = await lint('debugger; Reflect.apply(fn, null, []);')
    expect(both.find((item) => item.message === 'DEBUGGER_RULE')?.severity).toBe('warning')
    expect(both.find((item) => item.message.startsWith('Replace `Reflect.apply`'))?.severity).toBe('error')

    await config(['./reflect.ts'])
    expect(
      (await lint('debugger; Reflect.apply(fn, null, []);')).some((item) => item.message === 'DEBUGGER_RULE'),
    ).toBe(false)
    expect(await lint('// biome-ignore lint/plugin: reviewed\nReflect.apply(fn, null, []);')).toEqual([])
    expect(
      (await lint('// biome-ignore lint/plugin/reflect: reviewed\nReflect.apply(fn, null, []);')).some((item) =>
        item.message.startsWith('Replace `Reflect.apply`'),
      ),
    ).toBe(true)

    const exportProbe = join(temp, 'export-probe.ts')
    const exportSource =
      "import {ast,defineRule,registerDiagnostic} from '@biomejs/runtime/plugin'; const rule=defineRule({query:ast('JS_DEBUGGER_STATEMENT'),run(n){registerDiagnostic(n,'error','EXPORT_PROBE');}});export {rule}\n"
    await writeFile(exportProbe, exportSource)
    await config(['./export-probe.ts'])
    const exportError = spawnSync(biome, ['lint', '--config-path', temp, join(temp, 'input.ts')], { encoding: 'utf8' })
    expect(exportError.stderr).toContain('SyntaxError: abrupt end')
    await writeFile(exportProbe, `${exportSource}void 0\n`)
    expect((await lint('debugger;')).some((item) => item.message === 'EXPORT_PROBE')).toBe(true)

    await writeFile(
      join(temp, 'comment-probe.ts'),
      "import {ast,defineRule,registerDiagnostic} from '@biomejs/runtime/plugin'; const commentProbe=defineRule({query:ast('TS_AS_EXPRESSION'),run(n){const a=n.ancestors();registerDiagnostic(n,'error',a[a.length-1].text.startsWith('// SAFETY:')?'LEADING_TRIVIA_VISIBLE':'LEADING_TRIVIA_UNAVAILABLE');}});export {commentProbe};",
    )
    await config(['./comment-probe.ts'])
    expect(
      (await lint('// SAFETY: The caller parsed this value.\nconst value = input as User;')).some(
        (item) => item.message === 'LEADING_TRIVIA_UNAVAILABLE',
      ),
    ).toBe(true)
    await writeFile(
      join(temp, 'spacing-probe.ts'),
      "import {ast,defineRule,registerDiagnostic,createMutation,factory} from '@biomejs/runtime/plugin'; export const spacingProbe=defineRule({query:ast('JS_RETURN_STATEMENT'),run(n){const token=n.token('returnToken');const mutation=createMutation(n);mutation.replaceToken(token,factory.token('RETURN_KW','\\nreturn'));registerDiagnostic(n,'error','spacing',{kind:'safe',message:'add blank',mutation});}});",
    )
    await config(['./spacing-probe.ts'])
    const source = 'function f() {\nconst value = 1;\nreturn value;\n}\n'
    const input = join(temp, 'input.ts')
    await writeFile(input, source)
    const fix = spawnSync(biome, ['lint', '--write', '--config-path', temp, input], { encoding: 'utf8' })
    expect(fix.error).toBeUndefined()
    expect(fix.status).toBe(0)
    expect(fix.stderr).toContain('factory.token() requires the spelling')
    expect(await readFile(input, 'utf8')).toBe(source)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
})
