import type { AstGrepMatch, FileEntry, RawAstMatch, SourcePosition } from './model.ts'
import { isSafeRelativePath } from './source-index.ts'

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

export {
  compareEntries,
  filterFileEntries,
  isContainedPath,
  matchesGlob,
  normalizeAstMatches,
  normalizeEntryPath,
  normalizePath,
  normalizePosition,
}
