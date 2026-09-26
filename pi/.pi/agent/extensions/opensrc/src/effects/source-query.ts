import { Effect } from 'effect'
import type {
  AstGrepMatch,
  FileEntry,
  GrepOptions,
  GrepResult,
  OpensrcFailure,
  RawAstMatch,
  SourceFile,
  TreeNode,
  TreeOptions,
} from '../core/model.ts'
import { createOpensrcFailure } from '../core/model.ts'
import { isSafeRelativePath } from '../core/source-index.ts'
import {
  compareEntries,
  filterFileEntries,
  isContainedPath,
  matchesGlob,
  normalizeEntryPath,
  normalizePath,
  normalizePosition,
} from '../core/source-query.ts'
import { failureFromUnknown } from './failure.ts'

function resolveContainedPath(root: string, filePath: string): Effect.Effect<string, OpensrcFailure> {
  return Effect.gen(function* () {
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
}

function buildTree(
  sourceName: string,
  entries: readonly FileEntry[],
  options: TreeOptions = {},
): Effect.Effect<TreeNode, OpensrcFailure> {
  return Effect.gen(function* () {
    const depth = yield* validateTreeDepth(options.depth)
    const root: MutableTreeNode = { name: sourceName, type: 'directory', children: new Map() }
    for (const entry of filterFileEntries(entries, options.pattern)) addTreeEntry(root, entry)
    return freezeTree(root, depth)
  })
}

function buildTreeInterruptible(
  sourceName: string,
  entries: readonly FileEntry[],
  options: TreeOptions,
  signal: AbortSignal,
): Effect.Effect<TreeNode, OpensrcFailure> {
  return Effect.gen(function* () {
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
}

function validateTreeDepth(depth: number | undefined): Effect.Effect<number, OpensrcFailure> {
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 0)) {
    return Effect.fail(
      createOpensrcFailure({
        _tag: 'validation',
        operation: 'tree',
        message: 'Tree depth must be a non-negative integer',
      }),
    )
  }
  return Effect.succeed(depth ?? Number.POSITIVE_INFINITY)
}

function grepFiles(
  sources: readonly { readonly source: string; readonly files: readonly SourceFile[] }[],
  pattern: string,
  options: GrepOptions = {},
): Effect.Effect<readonly GrepResult[], OpensrcFailure> {
  return Effect.gen(function* () {
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
}

function grepFilesInterruptible(
  sources: readonly { readonly source: string; readonly files: readonly SourceFile[] }[],
  pattern: string,
  options: GrepOptions = {},
  signal: AbortSignal,
): Effect.Effect<readonly GrepResult[], OpensrcFailure> {
  return Effect.gen(function* () {
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
}

function normalizeAstMatchesInterruptible(
  source: string,
  matches: readonly RawAstMatch[],
  signal: AbortSignal,
): Effect.Effect<readonly AstGrepMatch[], OpensrcFailure> {
  return Effect.gen(function* () {
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
}

type GrepContext = {
  readonly maxResults: number
  readonly expression: RegExp
  readonly include: string | undefined
  readonly selectedSources: readonly { readonly source: string; readonly files: readonly SourceFile[] }[]
}

function createGrepContextEffect(
  sources: readonly { readonly source: string; readonly files: readonly SourceFile[] }[],
  pattern: string,
  options: GrepOptions,
): Effect.Effect<GrepContext, OpensrcFailure> {
  const maxResults = options.maxResults ?? Number.MAX_SAFE_INTEGER
  if (!Number.isInteger(maxResults) || maxResults < 0) {
    return Effect.fail(
      createOpensrcFailure({
        _tag: 'validation',
        operation: 'grep',
        message: 'grep maxResults must be a non-negative integer',
      }),
    )
  }
  return Effect.try({
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
}

function filterFileEntriesInterruptibleEffect(
  entries: readonly FileEntry[],
  pattern: string | undefined,
  signal: AbortSignal,
): Effect.Effect<readonly FileEntry[], OpensrcFailure> {
  return Effect.gen(function* () {
    const safeEntries: FileEntry[] = []
    const state = { count: 0 }
    for (const entry of entries) {
      yield* queryCheckpoint(state, signal)
      if (isSafeEntryPath(entry.path)) safeEntries.push({ ...entry, path: normalizeEntryPath(entry.path) })
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
}

function freezeTreeInterruptibleEffect(
  node: MutableTreeNode,
  depth: number,
  signal: AbortSignal,
  state: QueryState,
): Effect.Effect<TreeNode, OpensrcFailure> {
  return Effect.gen(function* () {
    yield* queryCheckpoint(state, signal)
    const children =
      node.type === 'directory' && depth > 0 ? [...node.children.values()].sort(compareTreeNodes) : undefined
    if (children === undefined) return { name: node.name, type: node.type }
    const frozenChildren: TreeNode[] = []
    for (const child of children)
      frozenChildren.push(yield* freezeTreeInterruptibleEffect(child, depth - 1, signal, state))
    return { name: node.name, type: node.type, children: frozenChildren }
  })
}

type QueryState = { count: number }

function queryCheckpoint(state: QueryState, signal: AbortSignal): Effect.Effect<void, OpensrcFailure> {
  return Effect.gen(function* () {
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
}

function ensureQueryActiveEffect(signal: AbortSignal): Effect.Effect<void, OpensrcFailure> {
  return signal.aborted
    ? Effect.fail(
        createOpensrcFailure({
          _tag: 'cancellation',
          operation: 'query',
          message: 'Operation aborted',
        }),
      )
    : Effect.void
}

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

function isSafeEntryPath(value: string): boolean {
  return value !== '.' && isSafeRelativePath(value)
}

function compareTreeNodes(left: MutableTreeNode, right: MutableTreeNode): number {
  return (left.type === right.type ? 0 : left.type === 'directory' ? -1 : 1) || left.name.localeCompare(right.name)
}

export {
  buildTree,
  buildTreeInterruptible,
  grepFiles,
  grepFilesInterruptible,
  normalizeAstMatchesInterruptible,
  resolveContainedPath,
}
