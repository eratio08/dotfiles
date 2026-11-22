import { basename } from 'node:path'

const antiSlopEntrypointPath = './tools/biome/anti-slop/rules/anti-slop.ts'

function formatAntiSlopEntrypoint(paths: string[]): string {
  return `${paths.map((path) => `export * from './${basename(path)}'`).join('\n')}\n`
}

function parseAntiSlopEntrypoint(source: string): string[] {
  const rules: string[] = []
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || /^\s*\/\//.test(line)) continue
    const match = line.match(/^\s*export\s+\*\s+from\s+(['"])\.\/([a-z0-9-]+\.ts)\1\s*;?\s*$/)
    if (!match?.[2] || rules.includes(match[2])) throw new Error('The anti-slop entry point requires manual review.')
    rules.push(match[2])
  }

  return rules
}

export { antiSlopEntrypointPath, formatAntiSlopEntrypoint, parseAntiSlopEntrypoint }
