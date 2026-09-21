import { Effect } from 'effect'
import type { ParsedSpec } from '../core/model.ts'
import { createOpensrcFailure, type OpensrcFailure } from '../core/model.ts'
import { failureFromUnknown } from './failure.ts'

const REPOSITORY_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org'])
const PACKAGE_PREFIXES = new Map([
  ['npm', 'npm'],
  ['pypi', 'pypi'],
  ['pip', 'pypi'],
  ['python', 'pypi'],
  ['crates', 'crates'],
  ['cargo', 'crates'],
  ['rust', 'crates'],
])

function parseSourceSpec(input: string): ParsedSpec {
  const spec = input.trim()
  if (spec.length === 0) return invalidSourceSpec('Source spec cannot be empty')
  if (/\s/.test(spec)) return invalidSourceSpec(`Invalid source spec: ${input}`)
  if (/^https?:\/\//i.test(spec)) return parseRepositoryUrl(spec)

  const prefixMatch = /^([a-z]+):(.*)$/i.exec(spec)
  if (prefixMatch === null) {
    if (spec.startsWith('@')) return parseNpm(spec)
    if (isRepositoryShorthand(spec)) return parseRepositoryShorthand(spec, 'github.com')
    return parseNpm(spec)
  }

  const prefix = prefixMatch[1].toLowerCase()
  const body = prefixMatch[2]
  const packageType = PACKAGE_PREFIXES.get(prefix)
  if (packageType === 'npm') return parseNpm(body)
  if (packageType === 'pypi') return parseRegistryPackage(body, 'pypi')
  if (packageType === 'crates') return parseRegistryPackage(body, 'crates')
  if (prefix === 'github' || prefix === 'gitlab' || prefix === 'bitbucket') {
    return parseRepositoryShorthand(
      body,
      prefix === 'github' ? 'github.com' : prefix === 'gitlab' ? 'gitlab.com' : 'bitbucket.org',
    )
  }
  return invalidSourceSpec(`Unsupported source spec prefix: ${prefix}`)
}

function parseSourceSpecEffect(input: string): Effect.Effect<ParsedSpec, OpensrcFailure> {
  return Effect.try({
    try: () => parseSourceSpec(input),
    catch: (cause) => failureFromUnknown(cause, 'validation', 'source-spec', 'The source spec could not be parsed.'),
  })
}

function parseNpm(value: string): ParsedSpec {
  const { name, version } = splitPackageVersion(value, true)
  if (!/^@[a-z0-9._~-]+\/[a-z0-9._~-]+$/i.test(name) && !/^[a-z0-9._~-]+$/i.test(name)) {
    return invalidSourceSpec(`Invalid npm package spec: ${value}`)
  }
  return { type: 'npm', name, ...(version ? { version } : {}) }
}

function parseRegistryPackage(value: string, type: 'pypi' | 'crates'): ParsedSpec {
  const { name, version } = splitRegistryPackageVersion(value, type)
  const namePattern = type === 'pypi' ? /^[a-z0-9][a-z0-9._-]*$/i : /^[a-z][a-z0-9_-]*$/i
  if (!namePattern.test(name)) return invalidSourceSpec(`Invalid ${type} package spec: ${value}`)
  return { type, name, ...(version ? { version } : {}) }
}

function parseRepositoryShorthand(value: string, host: string): ParsedSpec {
  const { repository, ref } = splitRepositoryRef(value)
  const parts = repository.split('/').filter(Boolean)
  if (parts.length !== 2 || parts.some((part) => !/^[^./]+(?:\.[^./]+)?$/.test(part))) {
    return invalidSourceSpec(`Invalid ${host} repository spec: ${value}`)
  }
  const [owner, name] = parts
  const normalizedName = name.replace(/\.git$/, '')
  return {
    type: 'repo',
    name: `${host}/${owner}/${normalizedName}`,
    ...(ref ? { ref } : {}),
    repository: `https://${host}/${owner}/${normalizedName}`,
  }
}

function parseRepositoryUrl(value: string): ParsedSpec {
  if (!URL.canParse(value)) return invalidSourceSpec(`Invalid repository URL: ${value}`)
  const url = new URL(value)
  const host = url.hostname.toLowerCase().replace(/^www\./, '')
  if (!REPOSITORY_HOSTS.has(host)) return invalidSourceSpec(`Unsupported repository host: ${url.hostname}`)
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length < 2) return invalidSourceSpec(`Invalid repository URL: ${value}`)
  const owner = parts[0]
  const name = parts[1].replace(/\.git$/, '')
  if (!owner || !name) return invalidSourceSpec(`Invalid repository URL: ${value}`)
  const ref = repositoryUrlRef(host, parts.slice(2))
  return {
    type: 'repo',
    name: `${host}/${owner}/${name}`,
    ...(ref ? { ref } : {}),
    repository: `https://${host}/${owner}/${name}`,
  }
}

function splitPackageVersion(value: string, scoped: boolean): { name: string; version?: string } {
  const separator = scoped ? value.indexOf('@', 1) : findPackageVersionSeparator(value)
  if (separator < 0) return { name: value }
  const name = value.slice(0, separator)
  const version = value.slice(separator + 1)
  if (!version) return invalidSourceSpec(`Invalid package version: ${value}`)
  return { name, version }
}

function splitRegistryPackageVersion(value: string, type: 'pypi' | 'crates'): { name: string; version?: string } {
  const equality = type === 'pypi' ? value.indexOf('==') : -1
  if (equality >= 0) {
    const name = value.slice(0, equality)
    const version = value.slice(equality + 2)
    if (!version) return invalidSourceSpec(`Invalid package version: ${value}`)
    return { name, version }
  }
  return splitPackageVersion(value, false)
}

function splitRepositoryRef(value: string): { repository: string; ref?: string } {
  const at = value.indexOf('@')
  const hash = value.indexOf('#')
  const separator = at < 0 ? hash : hash < 0 ? at : Math.min(at, hash)
  if (separator < 0) return { repository: value }
  const repository = value.slice(0, separator)
  const ref = value.slice(separator + 1)
  if (!ref) return invalidSourceSpec(`Invalid repository ref: ${value}`)
  return { repository, ref }
}

function repositoryUrlRef(host: string, suffix: readonly string[]): string | undefined {
  if (suffix.length === 0) return undefined
  const markerIndex = host === 'gitlab.com' && suffix[0] === '-' ? 1 : 0
  const marker = suffix[markerIndex]
  if (marker === 'tree' || marker === 'blob' || marker === 'src' || marker === 'commits') {
    const ref = suffix.slice(markerIndex + 1).join('/')
    return ref || undefined
  }
  return undefined
}

function findPackageVersionSeparator(value: string): number {
  const separator = value.lastIndexOf('@')
  if (separator <= 0) return -1
  return separator
}

function isRepositoryShorthand(value: string): boolean {
  const parts = value.split('/')
  return parts.length === 2 && parts.every((part) => part.length > 0) && !value.includes('\\')
}

function invalidSourceSpec(message: string, cause?: unknown): never {
  throw createOpensrcFailure({ _tag: 'validation', operation: 'source-spec', message, cause })
}

export { parseSourceSpec, parseSourceSpecEffect }
