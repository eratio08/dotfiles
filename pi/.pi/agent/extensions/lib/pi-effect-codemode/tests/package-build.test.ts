import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename } from 'node:path'

test('package entry point resolves for CommonJS consumers', () => {
  //given
  const packageRequire = createRequire(import.meta.url)

  //when
  const entryName = basename(packageRequire.resolve('@eratio/pi-effect-codemode'))

  //then
  assert.equal(entryName, 'index.js')
})

test('published bundle vendors local dependencies and includes the worker', async () => {
  //given
  const [bundle, declarations, worker] = await Promise.all([
    readFile(new URL('../dist/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../dist/index.d.ts', import.meta.url), 'utf8'),
    readFile(new URL('../dist/worker.js', import.meta.url), 'utf8'),
  ])

  //when
  const localDependencyImports =
    /(?:from\s+|import\s*\(\s*)['"]@eratio(?:08\/pi-effect|\/pi-codemode-core)(?:\/[^'"]*)?['"]/.test(
      `${bundle}\n${declarations}`,
    )

  //then
  assert.equal(localDependencyImports, false)
  assert.notEqual(worker.length, 0)
})
