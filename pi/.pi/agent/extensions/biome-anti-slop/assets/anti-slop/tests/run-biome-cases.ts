import { expect } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

type BiomeReport = {
  diagnostics: { category?: string; message?: string; location?: { path?: string } }[]
  summary: { changed: number; unchanged: number }
}

async function expectBiomeCases(
  biome: string,
  configPath: string,
  directory: string,
  cases: Array<[string, number | boolean]>,
  diagnostic: string,
  extension = 'ts',
): Promise<Map<string, string>> {
  const paths = cases.map((_, index) => join(directory, `case-${index}.${extension}`))
  await Promise.all(paths.map((path, index) => writeFile(path, cases[index]?.[0] ?? '')))
  const result = spawnSync(
    biome,
    ['lint', '--reporter=json', '--max-diagnostics=none', '--config-path', configPath, ...paths],
    { encoding: 'utf8', maxBuffer: 10_000_000 },
  )
  expect(result.error).toBeUndefined()
  expect(result.stderr).not.toContain('Failed to compile the JS plugin')
  expect([0, 1]).toContain(result.status ?? -1)
  if (cases.some(([, findings]) => findings)) expect(result.status).toBe(1)
  const report = JSON.parse(result.stdout) as BiomeReport
  expect(report.summary.changed + report.summary.unchanged).toBe(cases.length)
  expect(report.diagnostics.filter((item) => item.category?.startsWith('parse'))).toEqual([])
  expect(
    report.diagnostics.filter((item) => item.category === 'plugin' && /^Rule .+ errored:/.test(item.message ?? '')),
  ).toEqual([])
  const messages = new Map<string, string>()
  for (const [index, [source, findings]] of cases.entries()) {
    const file = basename(paths[index] ?? '')
    const matching = report.diagnostics.filter(
      (item) =>
        item.category === 'plugin' &&
        basename(item.location?.path ?? '') === file &&
        item.message?.includes(diagnostic),
    )
    const observed = findings === true || findings === false ? matching.length > 0 : matching.length
    expect([source, observed]).toEqual([source, findings])
    messages.set(source, matching.map((item) => item.message).join('\n'))
  }
  return messages
}

export { expectBiomeCases }
