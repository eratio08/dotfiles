import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

test('should match upstream Effect constructor import examples', async () => {
  const installedRoot = process.env.ANTI_SLOP_INSTALLED_ROOT
  const temp = await mkdtemp(join(installedRoot ?? tmpdir(), 'biome-effect-rule-'))
  const biome = process.env.ANTI_SLOP_BIOME ?? resolve('node_modules/.bin/biome')
  try {
    if (!installedRoot) {
      for (const file of ['no-service-constructor-imports.ts', 'shared.ts']) {
        await cp(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(temp, file))
      }
      await writeFile(
        join(temp, 'biome.json'),
        JSON.stringify({
          root: true,
          plugins: ['./no-service-constructor-imports.ts'],
          linter: { rules: { preset: 'none' } },
        }),
      )
    }
    const cases: Array<[string, string, number]> = [
      ['src/issue-service.test.ts', 'import { makeIssueService } from "./issue-service.ts";', 0],
      ['src/issue-service.spec.tsx', 'import { makeIssueService } from "../issue-service.ts";', 0],
      ['src/runtime.ts', 'import { makeExecutionMemo } from "alchemy/Runtime/ExecutionMemo";', 0],
      ['src/runtime.ts', 'import { issueServiceLayer } from "./issue-service.ts";\nWorkspaceName.make("name");', 0],
      ['src/runtime.ts', 'import { makeissueService } from "./issue-service.ts";', 0],
      ['src/runtime.ts', 'import { makeIssueService } from "./issue-service.ts";', 1],
      ['src/runtime.ts', 'import { makeIssueService as createIssueService } from "../issue-service.ts";', 1],
      ['src/runtime.ts', "import { makeIssueService } from '@app/issue-service';", 0],
      ['src/example.test.mts', "import { makeIssueService } from './service';", 0],
    ]
    for (const [filename, source, findings] of cases) {
      const file = join(temp, filename)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, source)
      const result = spawnSync(
        biome,
        ['lint', '--reporter=json', '--max-diagnostics=none', '--config-path', installedRoot ?? temp, file],
        { encoding: 'utf8' },
      )
      expect(result.error).toBeUndefined()
      const report = JSON.parse(result.stdout) as { diagnostics: { category?: string; message?: string }[] }
      expect(
        report.diagnostics.filter(
          (item) => item.category?.startsWith('parse') || /^Rule .+ errored:/.test(item.message ?? ''),
        ),
      ).toEqual([])
      expect([
        source,
        report.diagnostics.filter((item) => item.message?.includes('Do not import Effect service constructor')).length,
      ]).toEqual([source, findings])
      if (!installedRoot) expect(result.status).toBe(findings ? 1 : 0)
    }
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}, 15000)
