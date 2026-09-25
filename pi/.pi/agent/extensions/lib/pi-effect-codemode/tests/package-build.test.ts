import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename } from 'node:path'

test('should resolve the package entry point given a CommonJS consumer', () => {
  //given
  const packageRequire = createRequire(import.meta.url)

  //when
  const entryName = basename(packageRequire.resolve('@eratio/pi-effect-codemode'))

  //then
  assert.equal(entryName, 'index.js')
})

test('should install Pi Effect transitively and bundle code-mode core given the published package', async () => {
  //given
  const [bundle, declarations, worker, packageJson] = await Promise.all([
    readFile(new URL('../dist/index.js', import.meta.url), 'utf8'),
    readFile(new URL('../dist/index.d.ts', import.meta.url), 'utf8'),
    readFile(new URL('../dist/worker.js', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ])
  const manifest = JSON.parse(packageJson) as {
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }
  const bundleText = `${bundle}\n${declarations}`
  const unbundledCoreImports = /(?:from\s+|import\s*\(\s*)['"]@eratio\/pi-codemode-core(?:\/[^'"]*)?['"]/.test(
    bundleText,
  )
  const piEffectImports = /(?:from\s+|import\s*\(\s*)['"]@eratio\/pi-effect(?:\/[^'"]*)?['"]/.test(bundleText)

  //when
  const installedPiEffect = manifest.dependencies?.['@eratio/pi-effect']

  //then
  assert.equal(unbundledCoreImports, false)
  assert.equal(piEffectImports, true)
  assert.equal(installedPiEffect, '^0.1.0')
  assert.equal(manifest.peerDependencies?.['@eratio/pi-effect'], undefined)
  assert.notEqual(worker.length, 0)
})
