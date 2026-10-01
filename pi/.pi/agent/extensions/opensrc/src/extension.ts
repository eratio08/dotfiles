import { spawn } from 'node:child_process'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, resolve } from 'node:path'
import { isMainThread, parentPort, Worker } from 'node:worker_threads'
import { Lang, parse, pattern } from '@ast-grep/napi'
import { PiProcess } from '@eratio/pi-effect'
import { Context, Effect, Layer, Option, Ref, Schema, type Scope, Semaphore } from 'effect'
import { glob } from 'glob'

type SourceType = 'npm' | 'pypi' | 'crates' | 'repo'

type PackageSourceType = Exclude<SourceType, 'repo'>

type Source = {
  readonly type: SourceType
  readonly name: string
  readonly version: string
  readonly path: string
  readonly fetchedAt: string
}

type SourceIndexRecord = {
  readonly name: string
  readonly version: string
  readonly path: string
  readonly fetchedAt?: string
  readonly fetched_at?: string
  readonly registry?: PackageSourceType
  readonly type?: SourceType
}

type SourceIndex = { readonly packages?: readonly SourceIndexRecord[]; readonly repos?: readonly SourceIndexRecord[] }

type FileEntry = {
  readonly path: string
  readonly type: 'file' | 'directory'
  readonly size: number
  readonly modifiedAt?: string
}

type TreeNode = { readonly name: string; readonly type: 'file' | 'directory'; readonly children?: readonly TreeNode[] }

type SourcePosition = { readonly line: number; readonly column: number; readonly offset: number }

type GrepResult = {
  readonly source: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly text: string
}

type AstGrepMatch = {
  readonly source: string
  readonly file: string
  readonly text: string
  readonly start: SourcePosition
  readonly end: SourcePosition
  readonly line: number
  readonly column: number
  readonly metavars: Readonly<Record<string, string>>
}

type ParsedSpec = {
  readonly type: SourceType
  readonly name: string
  readonly version?: string
  readonly ref?: string
  readonly repository?: string
}

type FetchedSource = { readonly source: Source; readonly alreadyExists: boolean }

type RemoveResult = { readonly success: true; readonly removed: readonly string[] }

type CleanOptions = {
  readonly packages?: boolean
  readonly repos?: boolean
  readonly npm?: boolean
  readonly pypi?: boolean
  readonly crates?: boolean
}

type TreeOptions = { readonly depth?: number; readonly pattern?: string }

type GrepOptions = { readonly sources?: readonly string[]; readonly include?: string; readonly maxResults?: number }

type AstGrepOptions = { readonly glob?: string; readonly lang?: string | readonly string[]; readonly limit?: number }

type OpensrcFailureTag =
  | 'validation'
  | 'source-not-found'
  | 'cli'
  | 'filesystem'
  | 'parser'
  | 'cancellation'
  | 'timeout'
  | 'code-evaluation'
  | 'runtime'

type OpensrcFailureFields = {
  readonly _tag: OpensrcFailureTag
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
}

class OpensrcFailure extends Error {
  readonly _tag: OpensrcFailureTag
  readonly operation: string
  readonly cause?: unknown

  constructor(fields: OpensrcFailureFields) {
    super(fields.message)
    this.name = 'OpensrcFailure'
    this._tag = fields._tag
    this.operation = fields.operation
    if ('cause' in fields) this.cause = fields.cause
  }
}

function createOpensrcFailure(fields: OpensrcFailureFields): OpensrcFailure {
  return new OpensrcFailure(fields)
}

type SourceDiff = {
  readonly added: readonly Source[]
  readonly removed: readonly Source[]
  readonly unchanged: readonly Source[]
}

type PiExecutionResult = {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
  readonly killed: boolean
}

type PiExecutionRequest = {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd?: string
  readonly environment: Readonly<Record<string, string | undefined>>
}

type SourceFile = { readonly path: string; readonly content: string }

type RawAstMatch = {
  readonly source?: string
  readonly file: string
  readonly text: string
  readonly start: SourcePosition
  readonly end: SourcePosition
  readonly metavars?: Readonly<Record<string, string>>
}

type CliCommandPlan = {
  readonly operation: 'fetch' | 'list' | 'remove' | 'clean' | 'version'
  readonly args: readonly string[]
}

function planVersion(): CliCommandPlan {
  return { operation: 'version', args: ['--version'] }
}

function planList(): CliCommandPlan {
  return { operation: 'list', args: ['list', '--json'] }
}

function planFetch(specs: readonly string[], cwd: string): CliCommandPlan {
  return { operation: 'fetch', args: ['fetch', ...specs, '--cwd', cwd, '--quiet'] }
}

function planRemove(names: readonly string[]): CliCommandPlan {
  return { operation: 'remove', args: ['remove', ...names] }
}

function planClean(options: CleanOptions = {}): readonly CliCommandPlan[] {
  const scopeFlags = [options.packages ? '--packages' : undefined, options.repos ? '--repos' : undefined].filter(
    (value): value is string => value !== undefined,
  )
  const registryFlags = [
    options.npm ? '--npm' : undefined,
    options.pypi ? '--pypi' : undefined,
    options.crates ? '--crates' : undefined,
  ].filter((value): value is string => value !== undefined)
  if (registryFlags.length === 0) return [{ operation: 'clean', args: ['clean', ...scopeFlags] }]
  return registryFlags.map((registryFlag) => ({
    operation: 'clean' as const,
    args: ['clean', ...scopeFlags, registryFlag],
  }))
}

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

function isContainedPath(root: string, candidate: string): boolean {
  const rootPath = normalizePath(root)
  const candidatePath = normalizePath(candidate)
  if (rootPath === '.') return candidatePath === '.' || !candidatePath.startsWith('../')
  if (rootPath.endsWith('/')) return candidatePath === rootPath || candidatePath.startsWith(rootPath)
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}/`)
}

function filterFileEntries(entries: readonly FileEntry[], pattern?: string): readonly FileEntry[] {
  const safeEntries = entries
    .filter((entry) => isSafeEntryPath(entry.path))
    .map((entry) => ({ ...entry, path: normalizeEntryPath(entry.path) }))
  if (pattern === undefined) return safeEntries.sort(compareEntries)
  const matchingPaths = safeEntries.filter((entry) => matchesGlob(entry.path, pattern)).map((entry) => entry.path)
  return safeEntries
    .filter((entry) => matchingPaths.some((path) => path === entry.path || path.startsWith(`${entry.path}/`)))
    .sort(compareEntries)
}

function normalizeAstMatches(source: string, matches: readonly RawAstMatch[]): readonly AstGrepMatch[] {
  return matches.map((match) => ({
    source: match.source ?? source,
    file: match.file,
    text: match.text,
    start: normalizePosition(match.start),
    end: normalizePosition(match.end),
    line: match.start.line + 1,
    column: match.start.column + 1,
    metavars: { ...(match.metavars ?? {}) },
  }))
}

function matchesGlob(value: string, pattern: string): boolean {
  const normalizedValue = normalizeEntryPath(value)
  const normalizedPattern = normalizeEntryPath(pattern)
  let expression = '^'
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const character = normalizedPattern[index]
    if (character === '*') {
      if (normalizedPattern[index + 1] === '*') {
        index += 1
        if (normalizedPattern[index + 1] === '/') {
          index += 1
          expression += '(?:.*/)?'
        } else {
          expression += '.*'
        }
      } else {
        expression += '[^/]*'
      }
    } else if (character === '?') {
      expression += '[^/]'
    } else if (character === '{') {
      const end = normalizedPattern.indexOf('}', index + 1)
      if (end < 0) {
        expression += '\\{'
      } else {
        const alternatives = normalizedPattern
          .slice(index + 1, end)
          .split(',')
          .map((part) => escapeRegex(part))
          .join('|')
        expression += `(?:${alternatives})`
        index = end
      }
    } else {
      expression += escapeRegex(character)
    }
  }
  expression += '$'
  return new RegExp(expression).test(normalizedValue)
}

function normalizePath(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  const drive = /^[A-Za-z]:\//.test(normalized) ? normalized.slice(0, 3) : ''
  const prefix = normalized.startsWith('/') ? '/' : drive
  const segments = normalized.slice(prefix.length).split('/')
  const parts: string[] = []
  for (const segment of segments) {
    if (segment.length === 0 || segment === '.') continue
    if (segment === '..' && parts.at(-1) !== undefined && parts.at(-1) !== '..') {
      parts.pop()
    } else if (segment !== '..' || prefix.length === 0) {
      parts.push(segment)
    }
  }
  const joined = parts.join('/')
  return prefix.length > 0 ? `${prefix}${joined}` : joined || '.'
}

function normalizeEntryPath(value: string): string {
  return value
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/')
}

function isSafeEntryPath(value: string): boolean {
  return value !== '.' && isSafeRelativePath(value)
}

function compareEntries(left: FileEntry, right: FileEntry): number {
  return left.path.localeCompare(right.path) || left.type.localeCompare(right.type)
}

function normalizePosition(position: {
  readonly line: number
  readonly column: number
  readonly offset: number
}): SourcePosition {
  return { line: position.line + 1, column: position.column + 1, offset: position.offset }
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
}

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

const OpensrcFailureSchema = Schema.Struct({
  _tag: Schema.Literals([
    'validation',
    'source-not-found',
    'cli',
    'filesystem',
    'parser',
    'cancellation',
    'timeout',
    'code-evaluation',
    'runtime',
  ]),
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
})

function decodeOpensrcFailure(value: unknown): OpensrcFailure | undefined {
  const decoded = Schema.decodeUnknownOption(OpensrcFailureSchema)(value)
  return Option.isSome(decoded) ? createOpensrcFailure(decoded.value) : undefined
}

function failureFromUnknown(
  cause: unknown,
  _tag: OpensrcFailureTag,
  operation: string,
  fallbackMessage: string,
): OpensrcFailure {
  const failure = decodeOpensrcFailure(cause)
  if (failure !== undefined) return failure
  return createOpensrcFailure({
    _tag,
    operation,
    message: cause instanceof Error ? cause.message : fallbackMessage,
    cause,
  })
}

const EMPTY_CACHE_PATTERN = /no sources cached/i

const parseSourceIndex = Effect.fnUntraced(function* (input: string): Effect.fn.Return<SourceIndex, OpensrcFailure> {
  const text = input.trim()
  if (text.length === 0 || EMPTY_CACHE_PATTERN.test(text)) return { packages: [], repos: [] }
  const value = yield* Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: (cause: unknown) => sourceIndexFailure(`Invalid opensrc source index JSON: ${errorMessage(cause)}`, cause),
  })
  if (Array.isArray(value) && value.length === 0) return { packages: [], repos: [] }
  return yield* decodeSourceIndex(value)
})

const decodeSourceIndex = Effect.fnUntraced(function* (value: unknown): Effect.fn.Return<SourceIndex, OpensrcFailure> {
  if (!isRecord(value))
    return yield* Effect.fail(sourceIndexFailure('Invalid opensrc source index: expected an object'))
  const packages = yield* decodeRecordsEffect(value.packages, 'packages')
  const repos = yield* decodeRecordsEffect(value.repos, 'repos')
  if (value.packages === undefined && value.repos === undefined) {
    return yield* Effect.fail(sourceIndexFailure('Invalid opensrc source index: expected packages or repos'))
  }
  return { packages, repos }
})

const normalizeSources = Effect.fnUntraced(function* (
  index: SourceIndex,
): Effect.fn.Return<readonly Source[], OpensrcFailure> {
  const packages = yield* Effect.forEach(index.packages ?? [], (record) => normalizeRecordEffect(record, 'package'))
  const repos = yield* Effect.forEach(index.repos ?? [], (record) => normalizeRecordEffect(record, 'repo'))
  return [...packages, ...repos].sort(compareNormalizedSources)
})

const normalizeRecordEffect = Effect.fnUntraced(function* (record: SourceIndexRecord, group: 'package' | 'repo') {
  const type =
    group === 'repo' ? 'repo' : (record.registry ?? (record.type === 'repo' ? undefined : record.type) ?? 'npm')
  if (group === 'repo' && record.type !== undefined && record.type !== 'repo') {
    return yield* Effect.fail(sourceIndexEntryFailure(group, record.name, 'invalid type'))
  }
  if (group === 'package' && type === 'repo') {
    return yield* Effect.fail(sourceIndexEntryFailure(group, record.name, 'invalid registry'))
  }
  if (typeof type !== 'string' || !isSourceType(type)) {
    return yield* Effect.fail(sourceIndexEntryFailure(group, record.name, 'invalid type'))
  }
  const fetchedAt = record.fetchedAt ?? record.fetched_at
  if (!fetchedAt) return yield* Effect.fail(sourceIndexEntryFailure(group, record.name, 'missing fetchedAt'))
  if (!isSafeRelativePath(record.path))
    return yield* Effect.fail(sourceIndexEntryFailure(group, record.name, 'unsafe path'))
  return {
    type: type as SourceType,
    name: record.name,
    version: record.version,
    path: record.path.replaceAll('\\', '/'),
    fetchedAt,
  }
})

const decodeRecordsEffect = Effect.fnUntraced(function* (value: unknown, group: string) {
  if (value === undefined) return []
  if (!Array.isArray(value)) {
    return yield* Effect.fail(sourceIndexFailure(`Invalid opensrc source index: ${group} must be an array`))
  }
  const records: SourceIndexRecord[] = []
  for (const [index, entry] of value.entries()) {
    records.push(yield* decodeRecordEffect(entry, group, index))
  }
  return records
})

const decodeRecordEffect = Effect.fnUntraced(function* (value: unknown, group: string, index: number) {
  if (!isRecord(value)) {
    return yield* Effect.fail(sourceIndexFailure(`Invalid opensrc ${group} entry ${index}: expected an object`))
  }
  const name = value.name
  const version = value.version
  const path = value.path
  const fetchedAt = value.fetchedAt ?? value.fetched_at
  if (typeof name !== 'string' || name.length === 0) {
    return yield* Effect.fail(sourceIndexFailure(`Invalid opensrc ${group} entry ${index}: missing name`))
  }
  if (typeof version !== 'string' || version.length === 0) {
    return yield* Effect.fail(sourceIndexFailure(`Invalid opensrc ${group} entry ${name}: missing version`))
  }
  if (typeof path !== 'string' || path.length === 0) {
    return yield* Effect.fail(sourceIndexFailure(`Invalid opensrc ${group} entry ${name}: missing path`))
  }
  if (typeof fetchedAt !== 'string' || fetchedAt.length === 0) {
    return yield* Effect.fail(sourceIndexFailure(`Invalid opensrc ${group} entry ${name}: missing fetchedAt`))
  }
  const registry = value.registry
  const type = value.type
  if (registry !== undefined && (typeof registry !== 'string' || !isPackageType(registry))) {
    return yield* Effect.fail(sourceIndexFailure(`Invalid opensrc ${group} entry ${name}: invalid registry`))
  }
  if (type !== undefined && (typeof type !== 'string' || !isSourceType(type))) {
    return yield* Effect.fail(sourceIndexFailure(`Invalid opensrc ${group} entry ${name}: invalid type`))
  }
  return {
    name,
    version,
    path,
    fetchedAt,
    fetched_at: typeof value.fetched_at === 'string' ? value.fetched_at : undefined,
    registry: registry as SourceIndexRecord['registry'],
    type: type as SourceIndexRecord['type'],
  }
})

function isPackageType(value: string): value is 'npm' | 'pypi' | 'crates' {
  return value === 'npm' || value === 'pypi' || value === 'crates'
}

function isSourceType(value: string): value is SourceType {
  return isPackageType(value) || value === 'repo'
}

function compareNormalizedSources(left: Source, right: Source): number {
  return sourceKey(left).localeCompare(sourceKey(right))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sourceIndexFailure(message: string, cause?: unknown): OpensrcFailure {
  return createOpensrcFailure({ _tag: 'parser', operation: 'source-index', message, cause })
}

function sourceIndexEntryFailure(group: string, name: string, detail: string): OpensrcFailure {
  return sourceIndexFailure(`Invalid opensrc ${group} entry ${name}: ${detail}`)
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

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

const parseSourceSpecEffect = Effect.fnUntraced(function* (input: string) {
  return yield* Effect.try({
    try: () => parseSourceSpec(input),
    catch: (cause: unknown) =>
      failureFromUnknown(cause, 'validation', 'source-spec', 'The source spec could not be parsed.'),
  })
})

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

type OpensrcContextValue = { readonly cwd: string }

class OpensrcContext extends Context.Service<OpensrcContext, OpensrcContextValue>()('opensrc/Context') {}

type PiHostService = {
  readonly exec: (request: PiExecutionRequest) => Effect.Effect<PiExecutionResult, OpensrcFailure>
}

class PiHost extends Context.Service<PiHost, PiHostService>()('opensrc/PiHost') {}

const PiHostLive: Layer.Layer<PiHost, never, PiProcess> = Layer.effect(
  PiHost,
  Effect.gen(function* () {
    const piProcess = yield* PiProcess
    return PiHost.of({
      exec: Effect.fnUntraced(function* (request: PiExecutionRequest) {
        return yield* Object.keys(request.environment).length === 0
          ? piProcess
              .exec(request.command, [...request.args], { cwd: request.cwd })
              .pipe(Effect.mapError((cause) => mapPiFailure(request.command, cause)))
          : Effect.tryPromise({
              try: (signal: AbortSignal) => executeCommandWithEnvironment(request, signal),
              catch: (cause: unknown) => mapPiFailure(request.command, cause),
            })
      }),
    })
  }),
)

function executeCommandWithEnvironment(request: PiExecutionRequest, signal: AbortSignal): Promise<PiExecutionResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let killed = false
    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: createChildEnvironment(request.environment),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const complete = (result: PiExecutionResult): void => {
      if (settled) return
      settled = true
      if (killTimer !== undefined) clearTimeout(killTimer)
      signal.removeEventListener('abort', killProcess)
      resolve(result)
    }

    const killProcess = (): void => {
      if (settled || killed) return
      killed = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, 5_000)
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.once('error', (cause) => {
      const message = cause instanceof Error ? cause.message : String(cause)
      complete({ stdout, stderr: stderr || message, code: 1, killed })
    })
    child.once('close', (code) => {
      complete({ stdout, stderr, code: code ?? 0, killed })
    })
    if (signal.aborted) killProcess()
    else signal.addEventListener('abort', killProcess, { once: true })
  })
}

function createChildEnvironment(environment: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const childEnvironment = { ...process.env }
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete childEnvironment[name]
    else childEnvironment[name] = value
  }
  return childEnvironment
}

function mapPiFailure(command: string, cause: unknown): OpensrcFailure {
  return createOpensrcFailure({
    _tag: 'cli',
    operation: `exec ${command}`,
    message: cause instanceof Error ? cause.message : 'Process execution failed',
    cause,
  })
}

const MINIMUM_VERSION = [0, 7, 3] as const
const OPENSRC_INSTALL_COMMAND = 'npm install -g opensrc'
const DEFAULT_OPENSRC_BIN = resolve(
  dirname(createRequire(import.meta.url).resolve('opensrc/package.json')),
  'bin/opensrc.js',
)

type OpensrcConfig = {
  readonly bin: string
  readonly home: string
  readonly environment: Readonly<Record<string, string | undefined>>
}

type OpenSrcCliService = {
  readonly preflight: () => Effect.Effect<void, OpensrcFailure>
  readonly list: () => Effect.Effect<SourceIndex, OpensrcFailure>
  readonly fetch: (specs: readonly string[], cwd: string) => Effect.Effect<void, OpensrcFailure>
  readonly remove: (names: readonly string[]) => Effect.Effect<void, OpensrcFailure>
  readonly clean: (plans: readonly CliCommandPlan[]) => Effect.Effect<void, OpensrcFailure>
}

class OpensrcConfiguration extends Context.Service<OpensrcConfiguration, OpensrcConfig>()('opensrc/Configuration') {}

class OpenSrcCli extends Context.Service<OpenSrcCli, OpenSrcCliService>()('opensrc/OpenSrcCli') {}

function resolveOpensrcConfig(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = homedir(),
): OpensrcConfig {
  const configuredHome = environment.OPENSRC_HOME?.trim()
  const home = configuredHome ? expandHome(configuredHome, homeDirectory) : resolve(homeDirectory, '.opensrc')
  return {
    bin: environment.OPENSRC_BIN?.trim() || DEFAULT_OPENSRC_BIN,
    home,
    environment: configuredHome ? { OPENSRC_HOME: home } : {},
  }
}

const OpenSrcCliLive: Layer.Layer<OpenSrcCli, never, PiHost | OpensrcConfiguration> = Layer.effect(
  OpenSrcCli,
  Effect.gen(function* () {
    const piHost = yield* PiHost
    const config = yield* OpensrcConfiguration
    const run = Effect.fnUntraced(function* (plan: CliCommandPlan, cwd?: string) {
      return yield* piHost.exec({
        command: config.bin,
        args: plan.args,
        cwd,
        environment: config.environment,
      })
    })
    const ensurePreflight = yield* Effect.cached(
      Effect.gen(function* () {
        const result = yield* run(planVersion())
        yield* validateResult('preflight', result)
        const version = parseVersion(result.stdout)
        if (version === undefined || compareVersion(version, MINIMUM_VERSION) < 0) {
          return yield* Effect.fail(
            createOpensrcFailure({
              _tag: 'cli',
              operation: 'preflight',
              message: `The opensrc CLI must be version 0.7.3 or newer. Run \`${OPENSRC_INSTALL_COMMAND}\` with Node.js 24 or newer.`,
            }),
          )
        }
      }),
    )
    return OpenSrcCli.of({
      preflight: Effect.fnUntraced(function* () {
        return yield* ensurePreflight
      }),
      list: Effect.fnUntraced(function* () {
        yield* ensurePreflight
        const result = yield* run(planList())
        yield* validateResult('list', result)
        return yield* parseSourceIndex(result.stdout).pipe(
          Effect.mapError((cause) =>
            createOpensrcFailure({
              _tag: 'parser',
              operation: 'list',
              message: cause.message || 'Unable to parse the opensrc source index.',
              cause,
            }),
          ),
        )
      }),
      fetch: Effect.fnUntraced(function* (specs: readonly string[], cwd: string) {
        yield* ensurePreflight
        const result = yield* run(planFetch(specs, cwd), cwd)
        yield* validateResult('fetch', result)
      }),
      remove: Effect.fnUntraced(function* (names: readonly string[]) {
        yield* ensurePreflight
        const result = yield* run(planRemove(names))
        yield* validateResult('remove', result)
      }),
      clean: Effect.fnUntraced(function* (plans: readonly CliCommandPlan[]) {
        yield* ensurePreflight
        for (const plan of plans) {
          const result = yield* run(plan)
          yield* validateResult('clean', result)
        }
      }),
    })
  }),
)

const validateResult = Effect.fnUntraced(function* (operation: string, result: PiExecutionResult) {
  if (result.killed) return yield* Effect.fail(cancellationFailure(operation))
  if (result.code === 0) return
  const detail = result.stderr.trim().split('\n')[0] || `opensrc ${operation} failed with exit code ${result.code}`
  const message = operation === 'preflight' ? `${detail}. Run \`${OPENSRC_INSTALL_COMMAND}\` and try again.` : detail
  return yield* Effect.fail(createOpensrcFailure({ _tag: 'cli', operation, message, cause: { code: result.code } }))
})

function parseVersion(output: string): readonly [number, number, number] | undefined {
  const match = /(?:opensrc\s+)?(\d+)\.(\d+)\.(\d+)/i.exec(output)
  if (!match) return undefined
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareVersion(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

function expandHome(value: string, homeDirectory: string): string {
  if (value === '~') return homeDirectory
  if (value.startsWith('~/')) return resolve(homeDirectory, value.slice(2))
  return isAbsolute(value) ? value : resolve(value)
}

function cancellationFailure(operation: string): OpensrcFailure {
  return createOpensrcFailure({ _tag: 'cancellation', operation, message: 'The opensrc operation was cancelled.' })
}

type SourceStoreMutation<A> = {
  readonly before: readonly Source[]
  readonly after: readonly Source[]
  readonly value: A
}

type SourceStoreService = {
  readonly current: () => readonly Source[]
  readonly load: () => Effect.Effect<readonly Source[], OpensrcFailure>
  readonly refresh: () => Effect.Effect<readonly Source[], OpensrcFailure>
  readonly mutate: <A>(
    operation: (before: readonly Source[]) => Effect.Effect<A, OpensrcFailure>,
  ) => Effect.Effect<SourceStoreMutation<A>, OpensrcFailure>
  readonly snapshot: Effect.Effect<readonly Source[], OpensrcFailure>
}

class SourceStore extends Context.Service<SourceStore, SourceStoreService>()('opensrc/SourceStore') {}

function SourceStoreLive(): Layer.Layer<SourceStore, never, OpenSrcCli> {
  return Layer.effect(
    SourceStore,
    Effect.gen(function* () {
      const cli = yield* OpenSrcCli
      const state = yield* Ref.make<readonly Source[]>([])
      const lock = yield* Semaphore.make(1)
      const refreshState = Effect.fnUntraced(function* () {
        const index = yield* cli.list()
        const sources = yield* normalizeSources(index).pipe(
          Effect.mapError((cause) =>
            createOpensrcFailure({
              _tag: 'parser',
              operation: 'source-store.refresh',
              message: cause.message || 'Unable to normalize the source index.',
              cause,
            }),
          ),
          Effect.map(freezeSources),
        )
        yield* Ref.set(state, sources)
        return sources
      })
      const refresh = Effect.fnUntraced(function* () {
        return yield* lock.withPermits(1)(refreshState())
      })
      const mutate: SourceStoreService['mutate'] = Effect.fnUntraced(function* <A>(
        operation: (before: readonly Source[]) => Effect.Effect<A, OpensrcFailure>,
      ) {
        return yield* lock.withPermits(1)(
          Effect.gen(function* () {
            const before = yield* Ref.get(state)
            const value = yield* operation(before)
            const after = yield* refreshState()
            return { before, after, value }
          }),
        )
      })
      const service: SourceStoreService = {
        current: () => Ref.getUnsafe(state),
        load: refresh,
        refresh,
        mutate,
        snapshot: Ref.get(state),
      }
      return SourceStore.of(service)
    }),
  )
}

function freezeSources(value: readonly Source[]): readonly Source[] {
  return Object.freeze(value.map((source) => Object.freeze({ ...source })))
}

const resolveContainedPath = Effect.fnUntraced(function* (
  root: string,
  filePath: string,
): Effect.fn.Return<string, OpensrcFailure> {
  if (!isSafeRelativePath(filePath))
    return yield* Effect.fail(
      createOpensrcFailure({
        _tag: 'validation',
        operation: 'path',
        message: `Unsafe source path: ${filePath}`,
      }),
    )
  const rootPath = normalizePath(root)
  const candidate = normalizePath(rootPath === '.' ? filePath : `${rootPath}/${filePath}`)
  if (!isContainedPath(rootPath, candidate))
    return yield* Effect.fail(
      createOpensrcFailure({
        _tag: 'validation',
        operation: 'path',
        message: `Source path escapes root: ${filePath}`,
      }),
    )
  return candidate
})

const buildTree = Effect.fnUntraced(function* (
  sourceName: string,
  entries: readonly FileEntry[],
  options: TreeOptions = {},
): Effect.fn.Return<TreeNode, OpensrcFailure> {
  const depth = yield* validateTreeDepth(options.depth)
  const root: MutableTreeNode = { name: sourceName, type: 'directory', children: new Map() }
  for (const entry of filterFileEntries(entries, options.pattern)) addTreeEntry(root, entry)
  return freezeTree(root, depth)
})

const buildTreeInterruptible = Effect.fnUntraced(function* (
  sourceName: string,
  entries: readonly FileEntry[],
  options: TreeOptions,
  signal: AbortSignal,
): Effect.fn.Return<TreeNode, OpensrcFailure> {
  const depth = yield* validateTreeDepth(options.depth)
  const root: MutableTreeNode = { name: sourceName, type: 'directory', children: new Map() }
  const filteredEntries = yield* filterFileEntriesInterruptibleEffect(entries, options.pattern, signal)
  const state = { count: 0 }
  for (const entry of filteredEntries) {
    yield* queryCheckpoint(state, signal)
    addTreeEntry(root, entry)
  }
  return yield* freezeTreeInterruptibleEffect(root, depth, signal, state)
})

const validateTreeDepth = Effect.fnUntraced(function* (depth: number | undefined) {
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 0)) {
    return yield* Effect.fail(
      createOpensrcFailure({
        _tag: 'validation',
        operation: 'tree',
        message: 'Tree depth must be a non-negative integer',
      }),
    )
  }
  return depth ?? Number.POSITIVE_INFINITY
})

const grepFiles = Effect.fnUntraced(function* (
  sources: readonly { readonly source: string; readonly files: readonly SourceFile[] }[],
  pattern: string,
  options: GrepOptions = {},
): Effect.fn.Return<readonly GrepResult[], OpensrcFailure> {
  const context = yield* createGrepContextEffect(sources, pattern, options)
  if (context.maxResults === 0) return []
  const results: GrepResult[] = []
  for (const item of context.selectedSources) {
    const files = item.files
      .filter((file) => context.include === undefined || matchesGlob(file.path, context.include))
      .sort((left, right) => left.path.localeCompare(right.path))
    for (const file of files) {
      const lines = file.content.split('\n')
      for (let index = 0; index < lines.length && results.length < context.maxResults; index += 1) {
        context.expression.lastIndex = 0
        const match = context.expression.exec(lines[index])
        if (match === null) continue
        results.push({
          source: item.source,
          file: file.path,
          line: index + 1,
          column: (match.index ?? 0) + 1,
          text: lines[index].trim(),
        })
      }
      if (results.length >= context.maxResults) return results
    }
  }
  return results
})

const grepFilesInterruptible = Effect.fnUntraced(function* (
  sources: readonly { readonly source: string; readonly files: readonly SourceFile[] }[],
  pattern: string,
  options: GrepOptions = {},
  signal: AbortSignal,
): Effect.fn.Return<readonly GrepResult[], OpensrcFailure> {
  const context = yield* createGrepContextEffect(sources, pattern, options)
  if (context.maxResults === 0) return []
  const state = { count: 0 }
  const results: GrepResult[] = []
  for (const item of context.selectedSources) {
    yield* queryCheckpoint(state, signal)
    const files = item.files
      .filter((file) => context.include === undefined || matchesGlob(file.path, context.include))
      .sort((left, right) => left.path.localeCompare(right.path))
    for (const file of files) {
      yield* queryCheckpoint(state, signal)
      const lines = file.content.split('\n')
      for (let index = 0; index < lines.length && results.length < context.maxResults; index += 1) {
        yield* queryCheckpoint(state, signal)
        context.expression.lastIndex = 0
        const match = context.expression.exec(lines[index])
        if (match === null) continue
        results.push({
          source: item.source,
          file: file.path,
          line: index + 1,
          column: (match.index ?? 0) + 1,
          text: lines[index].trim(),
        })
      }
      if (results.length >= context.maxResults) return results
    }
  }
  return results
})

const normalizeAstMatchesInterruptible = Effect.fnUntraced(function* (
  source: string,
  matches: readonly RawAstMatch[],
  signal: AbortSignal,
): Effect.fn.Return<readonly AstGrepMatch[], OpensrcFailure> {
  const result: AstGrepMatch[] = []
  const state = { count: 0 }
  for (const match of matches) {
    yield* queryCheckpoint(state, signal)
    result.push({
      source: match.source ?? source,
      file: match.file,
      text: match.text,
      start: normalizePosition(match.start),
      end: normalizePosition(match.end),
      line: match.start.line + 1,
      column: match.start.column + 1,
      metavars: { ...(match.metavars ?? {}) },
    })
  }
  return result
})

type GrepContext = {
  readonly maxResults: number
  readonly expression: RegExp
  readonly include: string | undefined
  readonly selectedSources: readonly { readonly source: string; readonly files: readonly SourceFile[] }[]
}

const createGrepContextEffect = Effect.fnUntraced(function* (
  sources: readonly { readonly source: string; readonly files: readonly SourceFile[] }[],
  pattern: string,
  options: GrepOptions,
): Effect.fn.Return<GrepContext, OpensrcFailure> {
  const maxResults = options.maxResults ?? Number.MAX_SAFE_INTEGER
  if (!Number.isInteger(maxResults) || maxResults < 0) {
    return yield* Effect.fail(
      createOpensrcFailure({
        _tag: 'validation',
        operation: 'grep',
        message: 'grep maxResults must be a non-negative integer',
      }),
    )
  }
  return yield* Effect.try({
    try: () => ({
      maxResults,
      expression: new RegExp(pattern, 'i'),
      include: options.include,
      selectedSources: [...sources]
        .filter((item) => options.sources === undefined || options.sources.includes(item.source))
        .sort((left, right) => left.source.localeCompare(right.source)),
    }),
    catch: (cause: unknown) =>
      createOpensrcFailure({
        _tag: 'validation',
        operation: 'grep',
        message: `Invalid grep pattern: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  })
})

const filterFileEntriesInterruptibleEffect = Effect.fnUntraced(function* (
  entries: readonly FileEntry[],
  pattern: string | undefined,
  signal: AbortSignal,
) {
  const safeEntries: FileEntry[] = []
  const state = { count: 0 }
  for (const entry of entries) {
    yield* queryCheckpoint(state, signal)
    if (isSafeInterruptibleEntryPath(entry.path)) safeEntries.push({ ...entry, path: normalizeEntryPath(entry.path) })
  }
  if (pattern === undefined) return safeEntries.sort(compareEntries)
  const matchingPaths: string[] = []
  for (const entry of safeEntries) {
    yield* queryCheckpoint(state, signal)
    if (matchesGlob(entry.path, pattern)) matchingPaths.push(entry.path)
  }
  return safeEntries
    .filter((entry) => matchingPaths.some((path) => path === entry.path || path.startsWith(`${entry.path}/`)))
    .sort(compareEntries)
})

const freezeTreeInterruptibleEffect = Effect.fnUntraced(function* (
  node: MutableTreeNode,
  depth: number,
  signal: AbortSignal,
  state: QueryState,
): Effect.fn.Return<TreeNode, OpensrcFailure> {
  yield* queryCheckpoint(state, signal)
  const children =
    node.type === 'directory' && depth > 0 ? [...node.children.values()].sort(compareTreeNodes) : undefined
  if (children === undefined) return { name: node.name, type: node.type }
  const frozenChildren: TreeNode[] = []
  for (const child of children)
    frozenChildren.push(yield* freezeTreeInterruptibleEffect(child, depth - 1, signal, state))
  return { name: node.name, type: node.type, children: frozenChildren }
})

type QueryState = { count: number }

const queryCheckpoint = Effect.fnUntraced(function* (state: QueryState, signal: AbortSignal) {
  const count = yield* Effect.sync(() => {
    state.count += 1
    return state.count
  })
  yield* ensureQueryActiveEffect(signal)
  if (count % 128 !== 0) return
  yield* Effect.tryPromise({
    try: () => new Promise<void>((resolve) => setImmediate(resolve)),
    catch: (cause: unknown) => failureFromUnknown(cause, 'runtime', 'query', 'The source query failed.'),
  })
  yield* ensureQueryActiveEffect(signal)
})

const ensureQueryActiveEffect = Effect.fnUntraced(function* (signal: AbortSignal) {
  if (signal.aborted) {
    return yield* Effect.fail(
      createOpensrcFailure({
        _tag: 'cancellation',
        operation: 'query',
        message: 'Operation aborted',
      }),
    )
  }
})

type MutableTreeNode = {
  readonly name: string
  readonly type: 'file' | 'directory'
  readonly children: Map<string, MutableTreeNode>
}

function addTreeEntry(root: MutableTreeNode, entry: FileEntry): void {
  const parts = normalizeEntryPath(entry.path).split('/').filter(Boolean)
  if (parts.length === 0) return
  let current = root
  for (let index = 0; index < parts.length; index += 1) {
    const name = parts[index]
    const isLast = index === parts.length - 1
    const type = isLast ? entry.type : 'directory'
    const existing = current.children.get(name)
    if (existing) {
      if (existing.type === 'directory') current = existing
      continue
    }
    const child: MutableTreeNode = { name, type, children: new Map() }
    current.children.set(name, child)
    if (child.type === 'directory') current = child
  }
}

function freezeTree(node: MutableTreeNode, depth: number): TreeNode {
  const children =
    node.type === 'directory' && depth > 0
      ? [...node.children.values()].sort(compareTreeNodes).map((child) => freezeTree(child, depth - 1))
      : undefined
  return children === undefined ? { name: node.name, type: node.type } : { name: node.name, type: node.type, children }
}

function isSafeInterruptibleEntryPath(value: string): boolean {
  return value !== '.' && isSafeRelativePath(value)
}

function compareTreeNodes(left: MutableTreeNode, right: MutableTreeNode): number {
  return (left.type === right.type ? 0 : left.type === 'directory' ? -1 : 1) || left.name.localeCompare(right.name)
}

type FileSystemService = {
  readonly list: (
    sourceRoot: string,
    pattern: string | undefined,
    signal?: AbortSignal,
  ) => Effect.Effect<readonly FileEntry[], OpensrcFailure>
  readonly read: (sourceRoot: string, filePath: string, signal?: AbortSignal) => Effect.Effect<string, OpensrcFailure>
  readonly realPath: (
    sourceRoot: string,
    filePath?: string,
    signal?: AbortSignal,
  ) => Effect.Effect<string, OpensrcFailure>
}

class FileSystem extends Context.Service<FileSystem, FileSystemService>()('opensrc/FileSystem') {}

function createFileSystem(): FileSystemService {
  return {
    list: (sourceRoot: string, pattern: string | undefined, signal?: AbortSignal) =>
      listFiles(sourceRoot, pattern, signal),
    read: (sourceRoot: string, filePath: string, signal?: AbortSignal) => readSourceFile(sourceRoot, filePath, signal),
    realPath: (sourceRoot: string, filePath?: string, signal?: AbortSignal) =>
      resolveRealPath(sourceRoot, filePath, signal),
  }
}

const listFiles = Effect.fnUntraced(function* (
  sourceRoot: string,
  pattern: string | undefined,
  signal: AbortSignal | undefined,
) {
  yield* ensureNotAbortedEffect(signal)
  const root = yield* tryFileSystem('list', sourceRoot, () => realpath(sourceRoot))
  const paths = yield* tryFileSystem('list', sourceRoot, (operationSignal) =>
    glob(pattern ?? '**/*', {
      cwd: root,
      dot: true,
      ignore: ['.git/**', '**/.git/**'],
      nodir: false,
      signal: operationSignal,
    }),
  )
  yield* ensureNotAbortedEffect(signal)
  const entries: FileEntry[] = []
  for (const filePath of paths) {
    yield* ensureNotAbortedEffect(signal)
    if (isGitPath(filePath)) continue
    const absolutePath = yield* resolveContainedPath(root, filePath)
    const actualPath = yield* tryFileSystem('list', filePath, () => realpath(absolutePath))
    if (!isContainedPath(root, actualPath)) {
      return yield* Effect.fail(
        createOpensrcFailure({
          _tag: 'validation',
          operation: 'path',
          message: `Source path escapes root: ${filePath}`,
        }),
      )
    }
    const metadata = yield* tryFileSystem('list', filePath, () => stat(actualPath))
    entries.push({
      path: filePath.replaceAll('\\', '/'),
      type: metadata.isDirectory() ? 'directory' : 'file',
      size: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
    })
  }
  return filterFileEntries(entries, pattern)
})

const readSourceFile = Effect.fnUntraced(function* (
  sourceRoot: string,
  filePath: string,
  signal: AbortSignal | undefined,
) {
  yield* ensureNotAbortedEffect(signal)
  const root = yield* tryFileSystem('read', sourceRoot, () => realpath(sourceRoot))
  const absolutePath = yield* resolveContainedRealPath(root, filePath)
  const content = yield* tryFileSystem('read', filePath, (operationSignal) =>
    readFile(absolutePath, { encoding: 'utf8', signal: operationSignal }),
  )
  yield* ensureNotAbortedEffect(signal)
  return content
})

const resolveRealPath = Effect.fnUntraced(function* (
  sourceRoot: string,
  filePath: string | undefined,
  signal: AbortSignal | undefined,
) {
  yield* ensureNotAbortedEffect(signal)
  const root = yield* tryFileSystem('realpath', sourceRoot, () => realpath(sourceRoot))
  if (filePath === undefined) return root
  const result = yield* resolveContainedRealPath(root, filePath)
  yield* ensureNotAbortedEffect(signal)
  return result
})

const resolveContainedRealPath = Effect.fnUntraced(function* (root: string, filePath: string) {
  const candidate = yield* resolveContainedPath(root, filePath)
  const actualPath = yield* tryFileSystem('realpath', filePath, () => realpath(candidate))
  if (!isContainedPath(root, actualPath)) {
    return yield* Effect.fail(
      createOpensrcFailure({
        _tag: 'validation',
        operation: 'path',
        message: `Source path escapes root: ${filePath}`,
      }),
    )
  }
  return actualPath
})

const tryFileSystem = Effect.fnUntraced(function* <A>(
  operation: string,
  path: string,
  run: (signal: AbortSignal) => PromiseLike<A>,
) {
  return yield* Effect.tryPromise({
    try: run,
    catch: (cause: unknown) => mapFileSystemFailure(operation, path, cause),
  })
})

const ensureNotAbortedEffect = Effect.fnUntraced(function* (signal: AbortSignal | undefined) {
  if (signal?.aborted === true) {
    return yield* Effect.fail(
      createOpensrcFailure({
        _tag: 'cancellation',
        operation: 'filesystem',
        message: 'Operation aborted',
      }),
    )
  }
})

function mapFileSystemFailure(operation: string, path: string, cause: unknown): OpensrcFailure {
  const failure = decodeOpensrcFailure(cause)
  if (failure?._tag === 'cancellation') {
    return createOpensrcFailure({
      _tag: 'cancellation',
      operation,
      message: 'The opensrc operation was cancelled.',
      cause: failure,
    })
  }
  return createOpensrcFailure({
    _tag: 'filesystem',
    operation,
    message: failure?.message ?? (cause instanceof Error ? cause.message : `Unable to ${operation} source files`),
    cause: { path, failure: failure ?? cause },
  })
}

function isGitPath(filePath: string): boolean {
  return filePath === '.git' || filePath.startsWith('.git/') || filePath.includes('/.git/')
}

function FileSystemLive(): Layer.Layer<FileSystem, never, never> {
  return Layer.succeed(FileSystem, FileSystem.of(createFileSystem()))
}

type AstParserWorkerRequest = {
  readonly type: 'parse'
  readonly source: string
  readonly file: string
  readonly content: string
  readonly pattern: string
  readonly language: string
  readonly limit: number
}

type AstParserWorkerResult = { readonly type: 'result'; readonly matches: readonly RawAstMatch[] }

type AstParserWorkerFailure = {
  readonly type: 'error'
  readonly name: string
  readonly message: string
  readonly stack?: string
}

type AstParserWorkerMessage = AstParserWorkerResult | AstParserWorkerFailure

function runAstParserWorker(): void {
  if (parentPort === null) return
  const workerPort = parentPort
  workerPort.once('message', (request: AstParserWorkerRequest) => {
    Promise.resolve()
      .then(() => parseAstRequest(request))
      .then(
        (message) => workerPort.postMessage(message),
        (cause) => workerPort.postMessage(serializeAstParserError(cause)),
      )
  })
}

function parseAstRequest(request: AstParserWorkerRequest): AstParserWorkerMessage {
  const parserLanguage = toAstLanguage(request.language)
  if (parserLanguage === undefined) {
    return {
      type: 'error',
      name: 'ValidationError',
      message: `Unsupported AST language: ${request.language}`,
    }
  }
  const root = parse(parserLanguage, request.content)
  const rule = pattern(parserLanguage, request.pattern)
  const parsed = root.root().findAll(rule).slice(0, request.limit)
  const metavariableNames = [...request.pattern.matchAll(/\$+([A-Z][A-Z0-9_]*)/g)].map((match) => match[1])
  const matches = parsed.map((node): RawAstMatch => {
    const range = node.range()
    const metavars: Record<string, string> = {}
    for (const name of metavariableNames) {
      const matched = node.getMatch(name)
      if (matched) metavars[name] = matched.text()
    }
    return {
      source: request.source,
      file: request.file,
      text: node.text(),
      start: { line: range.start.line, column: range.start.column, offset: range.start.index },
      end: { line: range.end.line, column: range.end.column, offset: range.end.index },
      metavars,
    }
  })
  return { type: 'result', matches }
}

function toAstLanguage(value: string): Lang | undefined {
  const normalized = value.toLowerCase()
  if (normalized === 'javascript' || normalized === 'js') return Lang.JavaScript
  if (normalized === 'typescript' || normalized === 'ts') return Lang.TypeScript
  if (normalized === 'tsx' || normalized === 'typescriptreact') return Lang.Tsx
  if (normalized === 'html') return Lang.Html
  if (normalized === 'css') return Lang.Css
  return undefined
}

function serializeAstParserError(cause: unknown): AstParserWorkerFailure {
  const failure = decodeOpensrcFailure(cause)
  if (failure !== undefined)
    return { type: 'error', name: failure.name, message: failure.message, stack: failure.stack }
  if (cause instanceof Error) return { type: 'error', name: cause.name, message: cause.message, stack: cause.stack }
  return { type: 'error', name: 'Error', message: String(cause) }
}

if (!isMainThread) runAstParserWorker()

type AstParserService = {
  readonly find: (
    source: string,
    file: string,
    content: string,
    pattern: string,
    lang: string,
    limit: number,
  ) => Effect.Effect<readonly RawAstMatch[], OpensrcFailure>
}

class AstParser extends Context.Service<AstParser, AstParserService>()('opensrc/AstParser') {}

type ApiEffect<A> = Effect.Effect<A, OpensrcFailure>

type OpensrcApiService = {
  readonly list: () => ApiEffect<readonly Source[]>
  readonly has: (name: string, version?: string) => ApiEffect<boolean>
  readonly get: (name: string) => ApiEffect<Source | undefined>
  readonly files: (sourceName: string, glob?: string) => ApiEffect<readonly FileEntry[]>
  readonly tree: (sourceName: string, options?: TreeOptions) => ApiEffect<TreeNode>
  readonly grep: (pattern: string, options?: GrepOptions) => ApiEffect<readonly GrepResult[]>
  readonly astGrep: (
    sourceName: string,
    pattern: string,
    options?: AstGrepOptions,
  ) => ApiEffect<readonly AstGrepMatch[]>
  readonly read: (sourceName: string, filePath: string) => ApiEffect<string>
  readonly readMany: (sourceName: string, paths: readonly string[]) => ApiEffect<Readonly<Record<string, string>>>
  readonly resolve: (spec: string) => ApiEffect<ParsedSpec>
  readonly fetch: (specs: string | readonly string[]) => ApiEffect<readonly FetchedSource[]>
  readonly remove: (names: readonly string[]) => ApiEffect<RemoveResult>
  readonly clean: (options?: CleanOptions) => ApiEffect<RemoveResult>
}

const NonNegativeIntegerSchema = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const TreeDepthSchema = NonNegativeIntegerSchema.pipe(
  Schema.annotate({ message: 'Tree depth must be a non-negative integer.' }),
)
const GrepMaxResultsSchema = NonNegativeIntegerSchema.pipe(
  Schema.annotate({ message: 'grep maxResults must be a non-negative integer.' }),
)
const AstLimitSchema = NonNegativeIntegerSchema.pipe(
  Schema.annotate({ message: 'AST limit must be a non-negative integer.' }),
)
const TreeOptionsSchema = Schema.Struct({
  depth: Schema.optional(TreeDepthSchema),
  pattern: Schema.optional(Schema.NonEmptyString),
}).pipe(Schema.annotate({ message: 'Tree options must be an object.' }))
const GrepOptionsSchema = Schema.Struct({
  sources: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  include: Schema.optional(Schema.NonEmptyString),
  maxResults: Schema.optional(GrepMaxResultsSchema),
}).pipe(Schema.annotate({ message: 'Grep options must be an object.' }))
const AstGrepOptionsSchema = Schema.Struct({
  glob: Schema.optional(Schema.NonEmptyString),
  lang: Schema.optional(Schema.Union([Schema.NonEmptyString, Schema.Array(Schema.NonEmptyString)])),
  limit: Schema.optional(AstLimitSchema),
}).pipe(Schema.annotate({ message: 'AST options must be an object.' }))
const CleanOptionsSchema = Schema.Struct({
  packages: Schema.optional(Schema.Boolean),
  repos: Schema.optional(Schema.Boolean),
  npm: Schema.optional(Schema.Boolean),
  pypi: Schema.optional(Schema.Boolean),
  crates: Schema.optional(Schema.Boolean),
}).pipe(Schema.annotate({ message: 'Clean options must be an object.' }))

const createOpensrcApi = Effect.fnUntraced(function* (
  signal?: AbortSignal,
): Effect.fn.Return<
  OpensrcApiService,
  OpensrcFailure,
  OpensrcContext | OpensrcConfiguration | FileSystem | OpenSrcCli | SourceStore | AstParser | Scope.Scope
> {
  const context = yield* OpensrcContext
  const callSignal = signal ?? (yield* Effect.abortSignal)
  const config = yield* OpensrcConfiguration
  const fileSystem = yield* FileSystem
  const cli = yield* OpenSrcCli
  const sourceStore = yield* SourceStore
  const astParser = yield* AstParser
  yield* sourceStore.load()

  const sourceRoot = Effect.fnUntraced(
    function* (source: Source) {
      const cacheRoot = yield* fileSystem.realPath(config.home, undefined, callSignal)
      return yield* fileSystem.realPath(cacheRoot, source.path, callSignal)
    },
    Effect.mapError((cause) => decodeOpensrcFailure(cause) ?? filesystemFailure('source-root', cause)),
  )
  const getSource = Effect.fnUntraced(function* (name: string) {
    const validName = yield* assertStringEffect('source name', name)
    const source = sourceStore.current().find((candidate) => candidate.name === validName)
    return source === undefined ? yield* Effect.fail(sourceNotFound(validName)) : source
  })
  const readFiles = Effect.fnUntraced(function* (source: Source, patternValue: string | undefined, root?: string) {
    const pattern = patternValue === undefined ? undefined : yield* assertStringEffect('file glob', patternValue)
    const sourcePath = root ?? (yield* sourceRoot(source))
    return yield* fileSystem.list(sourcePath, pattern, callSignal)
  })
  const readOne = Effect.fnUntraced(function* (source: Source, filePath: string) {
    const validPath = yield* assertStringEffect('file path', filePath)
    const root = yield* sourceRoot(source)
    return yield* fileSystem.read(root, validPath, callSignal)
  })
  const api: OpensrcApiService = {
    list: () => Effect.succeed(sourceStore.current()),
    has: Effect.fn('OpensrcApi.has')(function* (name: string, version?: string) {
      const validName = yield* assertStringEffect('source name', name)
      const validVersion = version === undefined ? undefined : yield* assertStringEffect('source version', version)
      return sourceStore
        .current()
        .some((source) => source.name === validName && (validVersion === undefined || source.version === validVersion))
    }),
    get: Effect.fn('OpensrcApi.get')(function* (name: string) {
      const validName = yield* assertStringEffect('source name', name)
      return sourceStore.current().find((source) => source.name === validName)
    }),
    files: Effect.fn('OpensrcApi.files')(function* (sourceName: string, globValue?: string) {
      const source = yield* getSource(sourceName)
      return yield* readFiles(source, globValue)
    }),
    tree: Effect.fn('OpensrcApi.tree')(function* (sourceName: string, options: TreeOptions = {}) {
      const treeOptions = yield* decodeTreeOptionsEffect(options)
      const source = yield* getSource(sourceName)
      const entries = yield* readFiles(source, undefined)
      return yield* buildTreeInterruptible(source.name, entries, treeOptions, callSignal)
    }),
    grep: Effect.fn('OpensrcApi.grep')(function* (patternValue: string, options: GrepOptions = {}) {
      const patternText = yield* assertStringEffect('grep pattern', patternValue)
      const grepOptions = yield* decodeGrepOptionsEffect(options)
      const selected =
        grepOptions.sources === undefined
          ? sourceStore.current()
          : yield* Effect.forEach(grepOptions.sources, (name) => getSource(name))
      const sourceFiles: Array<{ readonly source: string; readonly files: readonly SourceFile[] }> = []
      for (const source of selected) {
        const root = yield* sourceRoot(source)
        const entries = yield* readFiles(source, grepOptions.include, root)
        const files: SourceFile[] = []
        for (const entry of entries) {
          if (entry.type !== 'file') continue
          const content = yield* fileSystem.read(root, entry.path, callSignal)
          files.push({ path: entry.path, content })
        }
        sourceFiles.push({ source: source.name, files })
      }
      return yield* grepFilesInterruptible(sourceFiles, patternText, grepOptions, callSignal)
    }),
    astGrep: Effect.fn('OpensrcApi.astGrep')(function* (
      sourceName: string,
      patternValue: string,
      options: AstGrepOptions = {},
    ) {
      const patternText = yield* assertStringEffect('AST pattern', patternValue)
      const astGrepOptions = yield* decodeAstGrepOptionsEffect(options)
      const source = yield* getSource(sourceName)
      const root = yield* sourceRoot(source)
      const entries = yield* readFiles(source, astGrepOptions.glob, root)
      const languages = yield* normalizeLanguagesEffect(astGrepOptions.lang)
      const limit = astGrepOptions.limit ?? 100
      const matches: RawAstMatch[] = []
      for (const entry of entries) {
        if (entry.type !== 'file') continue
        const fileLanguages = languages.length > 0 ? languages : inferredLanguage(entry.path)
        for (const lang of fileLanguages) {
          const content = yield* fileSystem.read(root, entry.path, callSignal)
          const remaining = limit - matches.length
          if (remaining <= 0) {
            return yield* normalizeAstMatchesInterruptible(source.name, matches, callSignal)
          }
          const result = yield* astParser.find(source.name, entry.path, content, patternText, lang, remaining)
          matches.push(...result.slice(0, remaining))
          if (matches.length >= limit) {
            return yield* normalizeAstMatchesInterruptible(source.name, matches.slice(0, limit), callSignal)
          }
        }
      }
      return yield* normalizeAstMatchesInterruptible(source.name, matches, callSignal)
    }),
    read: Effect.fn('OpensrcApi.read')(function* (sourceName: string, filePath: string) {
      const source = yield* getSource(sourceName)
      return yield* readOne(source, filePath)
    }),
    readMany: Effect.fn('OpensrcApi.readMany')(function* (sourceName: string, paths: readonly string[]) {
      const validPaths = yield* assertStringArrayEffect('read paths', paths)
      const source = yield* getSource(sourceName)
      const result: Record<string, string> = {}
      for (const requestedPath of validPaths) {
        if (hasGlobMagic(requestedPath)) {
          const entries = yield* readFilesOrError(source, requestedPath, result)
          if (entries === undefined) continue
          const files = entries.filter((entry) => entry.type === 'file')
          if (files.length === 0) {
            result[requestedPath] = `[Error: no files matched ${requestedPath}]`
            continue
          }
          for (const entry of files) {
            const value = yield* readOneOrError(source, entry.path)
            if (value !== undefined) result[entry.path] = value
          }
          continue
        }
        const value = yield* readOneOrError(source, requestedPath)
        if (value !== undefined) result[requestedPath] = value
      }
      return result
    }),
    resolve: Effect.fn('OpensrcApi.resolve')(function* (spec: string) {
      const validSpec = yield* assertStringEffect('source spec', spec)
      return yield* Effect.try({
        try: () => parseSourceSpec(validSpec),
        catch: (cause: unknown) => {
          const failure = decodeOpensrcFailure(cause)
          return validationFailure(
            'resolve',
            failure?.message ?? (cause instanceof Error ? cause.message : 'The source spec could not be parsed.'),
            failure ?? cause,
          )
        },
      })
    }),
    fetch: Effect.fn('OpensrcApi.fetch')(function* (specValues: string | readonly string[]) {
      const specs = yield* normalizeSpecsEffect(specValues)
      const parsed: ParsedSpec[] = []
      for (const spec of specs) {
        parsed.push(
          yield* parseSourceSpecEffect(spec).pipe(
            Effect.mapError((cause) => validationFailure('fetch', cause.message, cause)),
          ),
        )
      }
      const mutation = yield* sourceStore.mutate((before) =>
        Effect.gen(function* () {
          const existing = parsed.map((spec) => before.some((source) => sourceMatchesSpec(source, spec)))
          yield* cli.fetch(specs, context.cwd)
          return existing
        }),
      )
      const fetched: FetchedSource[] = []
      for (const [index, spec] of parsed.entries()) {
        const source = mutation.after.find((candidate) => sourceMatchesSpec(candidate, spec))
        if (source === undefined) return yield* Effect.fail(sourceNotFound(spec.name))
        fetched.push({ source, alreadyExists: mutation.value[index] })
      }
      return fetched
    }),
    remove: Effect.fn('OpensrcApi.remove')(function* (names: readonly string[]) {
      const validNames = yield* assertStringArrayEffect('source names', names)
      if (validNames.length === 0)
        return yield* Effect.fail(validationFailure('remove', 'At least one source name is required.'))
      if (validNames.some((name) => name.startsWith('-') || name.includes('\u0000'))) {
        return yield* Effect.fail(
          validationFailure('remove', 'Source names cannot start with a flag or contain a null byte.'),
        )
      }
      const mutation = yield* sourceStore.mutate((before) =>
        Effect.gen(function* () {
          yield* cli.remove(validNames)
          return before
        }),
      )
      const removed = diffSources(mutation.value, mutation.after).removed.map((source) => source.name)
      return { success: true, removed: [...new Set(removed)] } satisfies RemoveResult
    }),
    clean: Effect.fn('OpensrcApi.clean')(function* (options: CleanOptions = {}) {
      const cleanOptions = yield* decodeCleanOptionsEffect(options)
      const mutation = yield* sourceStore.mutate((before) =>
        Effect.gen(function* () {
          yield* cli.clean(planClean(cleanOptions))
          return before
        }),
      )
      const removed = diffSources(mutation.value, mutation.after).removed.map((source) => source.name)
      return { success: true, removed: [...new Set(removed)] } satisfies RemoveResult
    }),
  }

  const readFilesOrError = Effect.fnUntraced(function* (
    source: Source,
    pattern: string,
    result: Record<string, string>,
  ) {
    return yield* Effect.match(readFiles(source, pattern), {
      onFailure: (cause: OpensrcFailure) => {
        const stopped = operationStopped(cause)
        if (stopped !== undefined) return { _tag: 'failure' as const, error: stopped }
        result[pattern] = formatIndividualError(cause)
        return { _tag: 'formatted' as const }
      },
      onSuccess: (entries: readonly FileEntry[]) => ({ _tag: 'success' as const, entries }),
    }).pipe(
      Effect.flatMap((outcome) => {
        if (outcome._tag === 'failure') return Effect.fail(outcome.error)
        if (outcome._tag === 'formatted') return Effect.succeed(undefined)
        return Effect.succeed(outcome.entries)
      }),
    )
  })

  const readOneOrError = Effect.fnUntraced(function* (source: Source, path: string) {
    return yield* Effect.match(readOne(source, path), {
      onFailure: (cause: OpensrcFailure) => {
        const stopped = operationStopped(cause)
        if (stopped !== undefined) return { _tag: 'failure' as const, error: stopped }
        return { _tag: 'formatted' as const, value: formatIndividualError(cause) }
      },
      onSuccess: (value: string) => ({ _tag: 'success' as const, value }),
    }).pipe(
      Effect.flatMap((outcome) => {
        if (outcome._tag === 'failure') return Effect.fail(outcome.error)
        return Effect.succeed(outcome.value)
      }),
    )
  })

  return api
})

function AstParserLive(): Layer.Layer<AstParser, never, never> {
  return Layer.succeed(AstParser, AstParser.of(createAstParser()))
}

function createAstParser(): AstParserService {
  return {
    find: Effect.fnUntraced(function* (
      source: string,
      file: string,
      content: string,
      patternText: string,
      language: string,
      limit: number,
    ) {
      return yield* Effect.tryPromise({
        try: (signal: AbortSignal) =>
          evaluateAstParserInWorker(
            { type: 'parse', source, file, content, pattern: patternText, language, limit },
            signal,
          ),
        catch: (cause: unknown) =>
          failureFromUnknown(cause, 'parser', 'astGrep', 'The source file could not be parsed.'),
      })
    }),
  }
}

type AstParserOutcome =
  | { readonly ok: true; readonly matches: readonly RawAstMatch[] }
  | { readonly ok: false; readonly error: OpensrcFailure }

function evaluateAstParserInWorker(
  request: AstParserWorkerRequest,
  signal: AbortSignal,
): Promise<readonly RawAstMatch[]> {
  if (signal.aborted) return Promise.reject(apiCancellationFailure('astGrep'))
  const worker = new Worker(new URL('./extension.ts', import.meta.url))
  return new Promise((resolve, reject) => {
    let settled = false
    const abortHandler = (): void => finishFailure(apiCancellationFailure('astGrep'))

    const cleanup = (): void => {
      signal.removeEventListener('abort', abortHandler)
    }

    const complete = (outcome: AstParserOutcome): void => {
      if (outcome.ok) resolve(outcome.matches)
      else reject(outcome.error)
    }

    const finish = (outcome: AstParserOutcome): void => {
      if (settled) return
      settled = true
      cleanup()
      void worker.terminate().then(
        () => complete(outcome),
        () => complete(outcome),
      )
    }

    const finishSuccess = (matches: readonly RawAstMatch[]): void => finish({ ok: true, matches })
    const finishFailure = (error: OpensrcFailure): void => finish({ ok: false, error })

    worker.on('message', (message: AstParserWorkerMessage) => {
      if (message.type === 'result') finishSuccess(message.matches)
      else
        finishFailure(
          createOpensrcFailure({
            _tag: 'parser',
            operation: 'astGrep',
            message: message.message,
            cause: { name: message.name, stack: message.stack },
          }),
        )
    })
    worker.on('error', (cause) =>
      finishFailure(failureFromUnknown(cause, 'parser', 'astGrep', 'The source file could not be parsed.')),
    )
    worker.on('exit', (code) => {
      if (!settled)
        finishFailure(
          createOpensrcFailure({
            _tag: 'parser',
            operation: 'astGrep',
            message: `The AST parser worker exited with code ${code}.`,
          }),
        )
    })
    signal.addEventListener('abort', abortHandler, { once: true })

    Promise.resolve()
      .then(() => worker.postMessage(request))
      .catch((cause) =>
        finishFailure(failureFromUnknown(cause, 'parser', 'postMessage', 'The AST parser worker failed.')),
      )
  })
}

const normalizeSpecsEffect = Effect.fnUntraced(function* (value: string | readonly string[]) {
  const specs = typeof value === 'string' ? [value] : value
  const validSpecs = yield* assertStringArrayEffect('source specs', specs)
  if (validSpecs.length === 0)
    return yield* Effect.fail(validationFailure('fetch', 'At least one source spec is required.'))
  return validSpecs
})

const normalizeLanguagesEffect = Effect.fnUntraced(function* (
  value: string | readonly string[] | undefined,
): Effect.fn.Return<readonly string[], OpensrcFailure> {
  if (value === undefined) return []
  const languages = typeof value === 'string' ? [value] : value
  return yield* assertStringArrayEffect('AST languages', languages).pipe(
    Effect.map((items) => items.map((language) => language.toLowerCase())),
  )
})

function inferredLanguage(filePath: string): readonly string[] {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.ts' || extension === '.mts' || extension === '.cts') return ['typescript']
  if (extension === '.tsx') return ['tsx']
  if (extension === '.js' || extension === '.mjs' || extension === '.cjs' || extension === '.jsx') return ['javascript']
  if (extension === '.html' || extension === '.htm') return ['html']
  if (extension === '.css') return ['css']
  return []
}

const decodeInputEffect = Effect.fnUntraced(function* <S extends Schema.ConstraintDecoder<unknown>>(
  operation: string,
  schema: S,
  value: unknown,
  message: string,
): Effect.fn.Return<S['Type'], OpensrcFailure> {
  return yield* Effect.try({
    try: () => Schema.decodeUnknownSync(schema)(value),
    catch: (cause: unknown) => validationFailure(operation, message, cause),
  })
})

type TreeOptionsValue = Schema.Schema.Type<typeof TreeOptionsSchema>
type GrepOptionsValue = Schema.Schema.Type<typeof GrepOptionsSchema>
type AstGrepOptionsValue = Schema.Schema.Type<typeof AstGrepOptionsSchema>
type CleanOptionsValue = Schema.Schema.Type<typeof CleanOptionsSchema>

const decodeTreeOptionsEffect = Effect.fnUntraced(function* (
  value: unknown,
): Effect.fn.Return<TreeOptionsValue, OpensrcFailure> {
  return yield* decodeInputEffect('tree', TreeOptionsSchema, value, 'Tree options must be an object.')
})

const decodeGrepOptionsEffect = Effect.fnUntraced(function* (
  value: unknown,
): Effect.fn.Return<GrepOptionsValue, OpensrcFailure> {
  return yield* decodeInputEffect('grep', GrepOptionsSchema, value, 'Grep options must be an object.')
})

const decodeAstGrepOptionsEffect = Effect.fnUntraced(function* (
  value: unknown,
): Effect.fn.Return<AstGrepOptionsValue, OpensrcFailure> {
  return yield* decodeInputEffect('astGrep', AstGrepOptionsSchema, value, 'AST options must be an object.')
})

const decodeCleanOptionsEffect = Effect.fnUntraced(function* (
  value: unknown,
): Effect.fn.Return<CleanOptionsValue, OpensrcFailure> {
  return yield* decodeInputEffect('clean', CleanOptionsSchema, value, 'Clean options must be an object.')
})

const assertStringEffect = Effect.fnUntraced(function* (name: string, value: unknown) {
  return yield* decodeInputEffect('validation', Schema.NonEmptyString, value, `${name} must be a non-empty string.`)
})

const assertStringArrayEffect = Effect.fnUntraced(function* (name: string, value: unknown) {
  return yield* decodeInputEffect(
    'validation',
    Schema.Array(Schema.NonEmptyString),
    value,
    `${name} must be an array of non-empty strings.`,
  )
})

function hasGlobMagic(value: string): boolean {
  return /[*?{[]/.test(value)
}

function operationStopped(cause: unknown): OpensrcFailure | undefined {
  const failure = decodeOpensrcFailure(cause)
  return failure !== undefined && (failure._tag === 'cancellation' || failure._tag === 'timeout') ? failure : undefined
}

function formatIndividualError(cause: unknown): string {
  const failure = decodeOpensrcFailure(cause)
  if (failure !== undefined) return `[Error: ${failure.message}]`
  return `[Error: ${cause instanceof Error ? cause.message : 'Unable to read the path'}]`
}

function sourceNotFound(name: string): OpensrcFailure {
  return createOpensrcFailure({
    _tag: 'source-not-found',
    operation: 'source',
    message: `Cached source not found: ${name}`,
  })
}

function apiCancellationFailure(operation = 'api'): OpensrcFailure {
  return createOpensrcFailure({
    _tag: 'cancellation',
    operation,
    message: 'The opensrc operation was cancelled.',
  })
}

function validationFailure(operation: string, message: string, cause?: unknown): OpensrcFailure {
  return createOpensrcFailure({ _tag: 'validation', operation, message, cause })
}

function filesystemFailure(operation: string, cause: unknown): OpensrcFailure {
  return createOpensrcFailure({
    _tag: 'filesystem',
    operation,
    message: cause instanceof Error ? cause.message : 'The source path is not accessible.',
    cause,
  })
}

type OpensrcServices = FileSystem | AstParser | OpensrcConfiguration | PiHost | OpenSrcCli | SourceStore

function createOpensrcServiceLayer(config: OpensrcConfig): Layer.Layer<OpensrcServices, never, PiProcess> {
  const hostLayer = Layer.mergeAll(PiHostLive, Layer.succeed(OpensrcConfiguration, config))
  const cliLayer = OpenSrcCliLive.pipe(Layer.provideMerge(hostLayer))
  const storeLayer = SourceStoreLive().pipe(Layer.provideMerge(cliLayer))
  return Layer.mergeAll(FileSystemLive(), AstParserLive(), storeLayer)
}

export {
  type AstGrepMatch,
  type AstGrepOptions,
  AstParser,
  AstParserLive,
  type AstParserService,
  type AstParserWorkerFailure,
  type AstParserWorkerMessage,
  type AstParserWorkerRequest,
  type AstParserWorkerResult,
  buildTree,
  buildTreeInterruptible,
  type CleanOptions,
  type CliCommandPlan,
  compareEntries,
  createAstParser,
  createFileSystem,
  createOpensrcApi,
  createOpensrcFailure,
  createOpensrcServiceLayer,
  decodeOpensrcFailure,
  decodeSourceIndex,
  diffSources,
  type FetchedSource,
  type FileEntry,
  FileSystem,
  FileSystemLive,
  type FileSystemService,
  filterFileEntries,
  type GrepOptions,
  type GrepResult,
  grepFiles,
  grepFilesInterruptible,
  isContainedPath,
  isSafeRelativePath,
  matchesGlob,
  normalizeAstMatches,
  normalizeAstMatchesInterruptible,
  normalizeEntryPath,
  normalizePath,
  normalizePosition,
  normalizeSources,
  OpenSrcCli,
  OpenSrcCliLive,
  type OpenSrcCliService,
  type OpensrcApiService,
  type OpensrcConfig,
  OpensrcConfiguration,
  OpensrcContext,
  type OpensrcContextValue,
  OpensrcFailure,
  type OpensrcFailureTag,
  type OpensrcServices,
  type PackageSourceType,
  type ParsedSpec,
  type PiExecutionRequest,
  type PiExecutionResult,
  PiHost,
  PiHostLive,
  type PiHostService,
  parseSourceIndex,
  parseSourceSpec,
  parseSourceSpecEffect,
  planClean,
  planFetch,
  planList,
  planRemove,
  planVersion,
  type RawAstMatch,
  type RemoveResult,
  resolveContainedPath,
  resolveOpensrcConfig,
  runAstParserWorker,
  type Source,
  type SourceDiff,
  type SourceFile,
  type SourceIndex,
  type SourceIndexRecord,
  type SourcePosition,
  SourceStore,
  SourceStoreLive,
  type SourceStoreMutation,
  type SourceStoreService,
  type SourceType,
  sourceKey,
  sourceMatchesSpec,
  type TreeNode,
  type TreeOptions,
}
