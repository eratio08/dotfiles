import type { ParsedSpec, Source } from './model.ts'

function sourceMatchesSpec(source: Source, spec: ParsedSpec): boolean {
  if (source.type !== spec.type) return false
  const expectedName = spec.type === 'repo' ? canonicalRepositoryName(spec.name) : spec.name
  const actualName = spec.type === 'repo' ? canonicalRepositoryName(source.name) : source.name
  if (actualName !== expectedName) return false
  const requestedVersion = spec.version ?? spec.ref
  return requestedVersion === undefined || source.version === requestedVersion
}

function canonicalRepositoryName(name: string): string {
  const normalized = name
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\.git$/, '')
  if (normalized.split('/').length === 2) return `github.com/${normalized}`
  return normalized
}

export { sourceMatchesSpec }
