import { readFile, realpath, stat } from 'node:fs/promises'
import { Context, Effect, Layer } from 'effect'
import { glob } from 'glob'
import type { FileEntry, OpensrcFailure } from '../core/model.ts'
import { createOpensrcFailure } from '../core/model.ts'
import { filterFileEntries, isContainedPath } from '../core/source-query.ts'
import { decodeOpensrcFailure } from './failure.ts'
import { resolveContainedPath } from './source-query.ts'

interface FileSystemService {
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
    list: (sourceRoot, pattern, signal) => listFiles(sourceRoot, pattern, signal),
    read: (sourceRoot, filePath, signal) => readSourceFile(sourceRoot, filePath, signal),
    realPath: (sourceRoot, filePath, signal) => resolveRealPath(sourceRoot, filePath, signal),
  }
}

function listFiles(
  sourceRoot: string,
  pattern: string | undefined,
  signal: AbortSignal | undefined,
): Effect.Effect<readonly FileEntry[], OpensrcFailure> {
  return Effect.gen(function* () {
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
}

function readSourceFile(
  sourceRoot: string,
  filePath: string,
  signal: AbortSignal | undefined,
): Effect.Effect<string, OpensrcFailure> {
  return Effect.gen(function* () {
    yield* ensureNotAbortedEffect(signal)
    const root = yield* tryFileSystem('read', sourceRoot, () => realpath(sourceRoot))
    const absolutePath = yield* resolveContainedRealPath(root, filePath)
    const content = yield* tryFileSystem('read', filePath, (operationSignal) =>
      readFile(absolutePath, { encoding: 'utf8', signal: operationSignal }),
    )
    yield* ensureNotAbortedEffect(signal)
    return content
  })
}

function resolveRealPath(
  sourceRoot: string,
  filePath: string | undefined,
  signal: AbortSignal | undefined,
): Effect.Effect<string, OpensrcFailure> {
  return Effect.gen(function* () {
    yield* ensureNotAbortedEffect(signal)
    const root = yield* tryFileSystem('realpath', sourceRoot, () => realpath(sourceRoot))
    if (filePath === undefined) return root
    const result = yield* resolveContainedRealPath(root, filePath)
    yield* ensureNotAbortedEffect(signal)
    return result
  })
}

function resolveContainedRealPath(root: string, filePath: string): Effect.Effect<string, OpensrcFailure> {
  return Effect.gen(function* () {
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
}

function tryFileSystem<A>(
  operation: string,
  path: string,
  run: (signal: AbortSignal) => PromiseLike<A>,
): Effect.Effect<A, OpensrcFailure> {
  return Effect.tryPromise({
    try: run,
    catch: (cause) => mapFileSystemFailure(operation, path, cause),
  })
}

function ensureNotAbortedEffect(signal: AbortSignal | undefined): Effect.Effect<void, OpensrcFailure> {
  return signal?.aborted === true
    ? Effect.fail(
        createOpensrcFailure({
          _tag: 'cancellation',
          operation: 'filesystem',
          message: 'Operation aborted',
        }),
      )
    : Effect.void
}

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

export { createFileSystem, FileSystem, FileSystemLive, type FileSystemService }
