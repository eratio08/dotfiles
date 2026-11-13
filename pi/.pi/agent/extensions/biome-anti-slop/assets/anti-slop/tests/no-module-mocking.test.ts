import { test } from 'bun:test'
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expectBiomeCases } from './run-biome-cases.ts'

test('should match upstream no-module-mocking examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-syntax-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  try {
    if (!installedRoot) {
      for (const file of ['no-module-mocking.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({ root: true, plugins: ['./no-module-mocking.ts'], linter: { rules: { preset: 'none' } } }),
      )
    }
    const cases: Array<[string, number]> = [
      ['const store = new InMemoryUserStore();', 0],
      ["vi.spyOn(store, 'save');", 0],
      ['const vi = { mock() {} }; vi.mock();', 0],
      ['function test(jest: { mock(): void }) { jest.mock(); }', 0],
      ["import { vi as localVi } from './helpers'; localVi.mock('./module');", 0],
      ["vi.mock('./user-store');", 1],
      ["jest.mock('./user-store');", 1],
      ["vi['doMock']('./user-store');", 1],
      ["jest.unstable_mockModule('./user-store');", 1],
      ["import { vi } from 'vitest'; vi.mock('./user-store');", 1],
      ["import { vi as testApi } from 'vitest'; testApi.mock('./user-store');", 1],
      ["import { jest } from '@jest/globals'; jest.mock('./user-store');", 1],
      ["import Default, { vi as testApi } from 'vitest'; testApi.doMock('x');", 1],
      ["import { jest as api } from '@jest/globals'; api['unstable_mockModule']('x');", 1],
      ["import { vi as api } from 'other'; api.mock('x');", 0],
      ["const vi = { mock() {} }; vi.mock('x');", 0],
      ["vi.spyOn(obj, 'm');", 0],
    ]
    await expectBiomeCases(biome, installedRoot ?? temp, temp, cases, 'Replace module mocking')
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
