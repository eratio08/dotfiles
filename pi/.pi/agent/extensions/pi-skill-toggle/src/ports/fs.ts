import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Context, Effect, Layer, Schema } from 'effect'

export interface DirectoryEntry {
  readonly name: string
  readonly isDirectory: boolean
  readonly isFile: boolean
  readonly isSymbolicLink: boolean
}

export interface FileStats {
  readonly isDirectory: boolean
  readonly isFile: boolean
  readonly mode: number
}

export class FileSystemError extends Schema.TaggedError<FileSystemError>()('FileSystemError', {
  operation: Schema.String,
  path: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

export class FileSystem extends Context.Service<
  FileSystem,
  {
    readonly readFile: (path: string) => Effect.Effect<string, FileSystemError>
    readonly writeFileAtomic: (path: string, content: string) => Effect.Effect<void, FileSystemError>
    readonly access: (path: string, mode?: number) => Effect.Effect<boolean, FileSystemError>
    readonly readdir: (path: string) => Effect.Effect<ReadonlyArray<DirectoryEntry>, FileSystemError>
    readonly realpath: (path: string) => Effect.Effect<string, FileSystemError>
    readonly stat: (path: string) => Effect.Effect<FileStats, FileSystemError>
  }
>()('pi-skill-toggle/ports/FileSystem') {}

function toFileSystemError(operation: string, path: string, cause: unknown): FileSystemError {
  return new FileSystemError({
    operation,
    path,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  })
}

function tryFileSystem<A>(
  operation: string,
  path: string,
  execute: (signal: AbortSignal) => PromiseLike<A>,
): Effect.Effect<A, FileSystemError> {
  return Effect.tryPromise({
    try: execute,
    catch: (cause) => toFileSystemError(operation, path, cause),
  })
}

const readFile = Effect.fn('FileSystem.readFile')(function* (path: string): Effect.fn.Return<string, FileSystemError> {
  return yield* tryFileSystem('readFile', path, (signal) => fs.readFile(path, { encoding: 'utf8', signal }))
})

const writeFileAtomic = Effect.fn('FileSystem.writeFileAtomic')(function* (
  path: string,
  content: string,
): Effect.fn.Return<void, FileSystemError> {
  const temporaryPath = yield* Effect.sync(() =>
    join(dirname(path), `.pi-skill-toggle-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`),
  )
  const mode = yield* tryFileSystem('stat', path, () => fs.stat(path)).pipe(
    Effect.map((stats) => stats.mode),
    Effect.catch(() => Effect.succeed(undefined)),
  )

  yield* tryFileSystem('writeFile', temporaryPath, (signal) =>
    fs.writeFile(temporaryPath, content, { encoding: 'utf8', signal }),
  )
  if (mode !== undefined) {
    yield* tryFileSystem('chmod', temporaryPath, () => fs.chmod(temporaryPath, mode))
  }
  yield* tryFileSystem('rename', temporaryPath, () => fs.rename(temporaryPath, path))
})

const access = Effect.fn('FileSystem.access')(function* (
  path: string,
  mode = constants.F_OK,
): Effect.fn.Return<boolean, FileSystemError> {
  return yield* tryFileSystem('access', path, () => fs.access(path, mode)).pipe(
    Effect.map(() => true),
    Effect.catch(() => Effect.succeed(false)),
  )
})

const readdir = Effect.fn('FileSystem.readdir')(function* (
  path: string,
): Effect.fn.Return<ReadonlyArray<DirectoryEntry>, FileSystemError> {
  const entries = yield* tryFileSystem('readdir', path, () => fs.readdir(path, { withFileTypes: true }))
  return entries.map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
    isFile: entry.isFile(),
    isSymbolicLink: entry.isSymbolicLink(),
  }))
})

const realpath = Effect.fn('FileSystem.realpath')(function* (path: string): Effect.fn.Return<string, FileSystemError> {
  return yield* tryFileSystem('realpath', path, () => fs.realpath(path))
})

const stat = Effect.fn('FileSystem.stat')(function* (path: string): Effect.fn.Return<FileStats, FileSystemError> {
  const stats = yield* tryFileSystem('stat', path, () => fs.stat(path))
  return { isDirectory: stats.isDirectory(), isFile: stats.isFile(), mode: stats.mode }
})

export const FileSystemLive: Layer.Layer<FileSystem> = Layer.succeed(
  FileSystem,
  FileSystem.of({ readFile, writeFileAtomic, access, readdir, realpath, stat }),
)
