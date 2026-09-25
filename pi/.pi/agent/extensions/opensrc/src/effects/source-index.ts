import { Effect } from 'effect'
import type { Source, SourceIndex, SourceIndexRecord, SourceType } from '../core/model.ts'
import { createOpensrcFailure, type OpensrcFailure } from '../core/model.ts'
import { isSafeRelativePath, sourceKey } from '../core/source-index.ts'

const EMPTY_CACHE_PATTERN = /no sources cached/i

function parseSourceIndex(input: string): Effect.Effect<SourceIndex, OpensrcFailure> {
  const text = input.trim()
  if (text.length === 0 || EMPTY_CACHE_PATTERN.test(text)) return Effect.succeed({ packages: [], repos: [] })
  return Effect.gen(function* () {
    const value = yield* Effect.try({
      try: () => JSON.parse(text) as unknown,
      catch: (cause: unknown) => sourceIndexFailure(`Invalid opensrc source index JSON: ${errorMessage(cause)}`, cause),
    })
    if (Array.isArray(value) && value.length === 0) return { packages: [], repos: [] }
    return yield* decodeSourceIndex(value)
  })
}

function decodeSourceIndex(value: unknown): Effect.Effect<SourceIndex, OpensrcFailure> {
  return Effect.gen(function* () {
    if (!isRecord(value))
      return yield* Effect.fail(sourceIndexFailure('Invalid opensrc source index: expected an object'))
    const packages = yield* decodeRecordsEffect(value.packages, 'packages')
    const repos = yield* decodeRecordsEffect(value.repos, 'repos')
    if (value.packages === undefined && value.repos === undefined) {
      return yield* Effect.fail(sourceIndexFailure('Invalid opensrc source index: expected packages or repos'))
    }
    return { packages, repos }
  })
}

function normalizeSources(index: SourceIndex): Effect.Effect<readonly Source[], OpensrcFailure> {
  return Effect.gen(function* () {
    const packages = yield* Effect.forEach(index.packages ?? [], (record) => normalizeRecordEffect(record, 'package'))
    const repos = yield* Effect.forEach(index.repos ?? [], (record) => normalizeRecordEffect(record, 'repo'))
    return [...packages, ...repos].sort(compareSources)
  })
}

function normalizeRecordEffect(
  record: SourceIndexRecord,
  group: 'package' | 'repo',
): Effect.Effect<Source, OpensrcFailure> {
  return Effect.gen(function* () {
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
}

function decodeRecordsEffect(
  value: unknown,
  group: string,
): Effect.Effect<readonly SourceIndexRecord[], OpensrcFailure> {
  return Effect.gen(function* () {
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
}

function decodeRecordEffect(
  value: unknown,
  group: string,
  index: number,
): Effect.Effect<SourceIndexRecord, OpensrcFailure> {
  return Effect.gen(function* () {
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
}

function isPackageType(value: string): value is 'npm' | 'pypi' | 'crates' {
  return value === 'npm' || value === 'pypi' || value === 'crates'
}

function isSourceType(value: string): value is SourceType {
  return isPackageType(value) || value === 'repo'
}

function compareSources(left: Source, right: Source): number {
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

export { decodeSourceIndex, normalizeSources, parseSourceIndex }
