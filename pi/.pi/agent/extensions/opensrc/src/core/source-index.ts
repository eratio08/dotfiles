import type { Source, SourceDiff } from './model.ts'

function sourceKey(source: Pick<Source, 'type' | 'name' | 'version' | 'path'>): string {
  return [source.type, source.name, source.version, source.path].join('\u0000')
}

function diffSources(before: readonly Source[], after: readonly Source[]): SourceDiff {
  const beforeByKey = new Map(before.map((source) => [sourceKey(source), source]))
  const afterByKey = new Map(after.map((source) => [sourceKey(source), source]))
  const added = [...afterByKey.values()].filter((source) => !beforeByKey.has(sourceKey(source))).sort(compareSources)
  const removed = [...beforeByKey.values()].filter((source) => !afterByKey.has(sourceKey(source))).sort(compareSources)
  const unchanged = [...afterByKey.values()].filter((source) => beforeByKey.has(sourceKey(source))).sort(compareSources)
  return { added, removed, unchanged }
}

function isSafeRelativePath(value: string): boolean {
  if (
    value.length === 0 ||
    value.includes('\u0000') ||
    value.startsWith('/') ||
    value.startsWith('\\') ||
    /^[A-Za-z]:[\\/]/.test(value)
  )
    return false
  let depth = 0
  for (const segment of value.replaceAll('\\', '/').split('/')) {
    if (segment.length === 0 || segment === '.') continue
    if (segment === '..') {
      if (depth === 0) return false
      depth -= 1
      continue
    }
    depth += 1
  }
  return depth > 0
}

function compareSources(left: Source, right: Source): number {
  return sourceKey(left).localeCompare(sourceKey(right))
}

export { diffSources, isSafeRelativePath, sourceKey }
