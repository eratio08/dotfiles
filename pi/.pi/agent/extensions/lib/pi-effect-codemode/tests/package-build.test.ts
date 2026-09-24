import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

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
