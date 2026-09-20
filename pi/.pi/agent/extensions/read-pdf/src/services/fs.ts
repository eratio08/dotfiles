import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Context, Effect, Layer, Schema } from 'effect'

class FileSystemError extends Schema.TaggedError<FileSystemError>()('FileSystemError', {
  operation: Schema.String,
  path: Schema.String,
  cause: Schema.Unknown,
}) {}

class FileSystem extends Context.Service<
  FileSystem,
  {
    readonly readFile: (path: string) => Effect.Effect<Uint8Array, FileSystemError>
    readonly writeTemporaryMarkdown: (content: string) => Effect.Effect<string, FileSystemError>
  }
>()('read-pdf/services/FileSystem') {}

function toFileSystemError(operation: string, path: string, cause: unknown): FileSystemError {
  return new FileSystemError({ operation, path, cause })
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

const readFile = Effect.fn('FileSystem.readFile')(function* (
  path: string,
): Effect.fn.Return<Uint8Array, FileSystemError> {
  return yield* tryFileSystem('readFile', path, (signal) => fs.readFile(path, { signal }))
})

const writeTemporaryMarkdown = Effect.fn('FileSystem.writeTemporaryMarkdown')(function* (
  content: string,
): Effect.fn.Return<string, FileSystemError> {
  const path = yield* Effect.sync(() => join(tmpdir(), `pi-read-pdf-${randomUUID()}.md`))
  yield* tryFileSystem('writeFile', path, (signal) => fs.writeFile(path, content, { encoding: 'utf8', signal }))
  return path
})

const FileSystemLive: Layer.Layer<FileSystem> = Layer.succeed(
  FileSystem,
  FileSystem.of({ readFile, writeTemporaryMarkdown }),
)

export { FileSystem, FileSystemError, FileSystemLive }
