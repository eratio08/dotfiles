import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { Cause, Context, Effect, Exit, Ref, Schema } from 'effect'

class ApplyPatchError extends Schema.TaggedError<ApplyPatchError>()('ApplyPatchError', {
  operation: Schema.Literals(['parse', 'apply', 'filesystem']),
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

type PatchOperation =
  | { type: 'add'; path: string; content: string; diff: string }
  | { type: 'update'; path: string; chunks: PatchChunk[]; moveTo?: string; diff: string }
  | { type: 'delete'; path: string; diff: string }

type PatchChunk = { lines: string[] }

type AppliedFile = {
  type: PatchOperation['type'] | 'move'
  path: string
  destination?: string
  additions: number
  deletions: number
  diff: string
}

type PreparedOperation = {
  type: PatchOperation['type']
  path: string
  destination?: string
  next?: Buffer
  result: AppliedFile
}

const begin = '*** Begin Patch'
const end = '*** End Patch'
const addPrefix = '*** Add File: '
const updatePrefix = '*** Update File: '
const deletePrefix = '*** Delete File: '
const movePrefix = '*** Move to: '

type PatchMutationQueueService = {
  readonly withLock: <A, E, R>(path: string, action: Effect.Effect<A, E, R>) => Effect.Effect<A, E | ApplyPatchError, R>
}

class PatchMutationQueue extends Context.Service<PatchMutationQueue, PatchMutationQueueService>()(
  'apply-patch/PatchMutationQueue',
) {}

const parsePatch = Effect.fn('parsePatch')(function* (
  patchText: string,
): Effect.fn.Return<PatchOperation[], ApplyPatchError> {
  return yield* Effect.try({
    try: () => {
      const lines = patchText.replace(/\r\n?/g, '\n').split('\n')
      if (lines.at(-1) === '') lines.pop()
      if (lines[0] !== begin || lines.at(-1) !== end)
        throw new Error(
          'apply_patch verification failed: patch must start with *** Begin Patch and end with *** End Patch',
        )

      const operations: PatchOperation[] = []
      let index = 1
      while (index < lines.length - 1) {
        const header = lines[index] ?? ''
        if (header.startsWith(addPrefix)) {
          const path = header.slice(addPrefix.length)
          index++
          const content: string[] = []
          while (index < lines.length - 1 && !isHeader(lines[index] ?? '')) {
            const line = lines[index] ?? ''
            if (!line.startsWith('+'))
              throw new Error(`apply_patch verification failed: add content must start with +: ${path}`)
            content.push(line.slice(1))
            index++
          }
          const text = content.join('\n')
          operations.push({ type: 'add', path, content: text ? `${text}\n` : '', diff: addDiff(path, content) })
          continue
        }
        if (header.startsWith(deletePrefix)) {
          const path = header.slice(deletePrefix.length)
          operations.push({ type: 'delete', path, diff: `--- ${path}\n+++ /dev/null` })
          index++
          continue
        }
        if (header.startsWith(updatePrefix)) {
          const path = header.slice(updatePrefix.length)
          index++
          let moveTo: string | undefined
          if ((lines[index] ?? '').startsWith(movePrefix)) {
            moveTo = (lines[index] ?? '').slice(movePrefix.length)
            index++
          }
          const chunks: PatchChunk[] = []
          while (index < lines.length - 1 && !isHeader(lines[index] ?? '')) {
            if (!(lines[index] ?? '').startsWith('@@'))
              throw new Error(`apply_patch verification failed: expected @@ hunk marker: ${path}`)
            index++
            const chunk: string[] = []
            while (
              index < lines.length - 1 &&
              !isHeader(lines[index] ?? '') &&
              !(lines[index] ?? '').startsWith('@@')
            ) {
              const line = lines[index] ?? ''
              if (!/^[ +-]/.test(line)) throw new Error(`apply_patch verification failed: invalid hunk line: ${path}`)
              chunk.push(line)
              index++
            }
            if (chunk.length === 0) throw new Error(`apply_patch verification failed: empty hunk: ${path}`)
            chunks.push({ lines: chunk })
          }
          if (chunks.length === 0) throw new Error(`apply_patch verification failed: no hunks found: ${path}`)
          operations.push({ type: 'update', path, chunks, moveTo, diff: updateDiff(path, moveTo, chunks) })
          continue
        }
        throw new Error(`apply_patch verification failed: unknown patch directive: ${header}`)
      }
      if (operations.length === 0) throw new Error('patch rejected: empty patch')
      return operations
    },
    catch: (cause: unknown) => createApplyPatchError('parse', cause),
  })
})

const applyPatch = Effect.fn('applyPatch')(function* (
  cwd: string,
  operations: PatchOperation[],
): Effect.fn.Return<AppliedFile[], ApplyPatchError, PatchMutationQueue> {
  const root = yield* fileSystem(() => realpath(cwd))
  const paths = new Set<string>()
  for (const operation of operations) {
    if (operation.path === '') return yield* failApply('apply_patch verification failed: empty file path')
    paths.add(operation.path)
    if (operation.type === 'update' && operation.moveTo) paths.add(operation.moveTo)
  }
  if (
    paths.size !==
    operations.reduce((count, operation) => count + (operation.type === 'update' && operation.moveTo ? 2 : 1), 0)
  ) {
    return yield* failApply('apply_patch verification failed: each path may appear in only one operation')
  }

  const resolvedPaths: string[][] = []
  for (const operation of operations) {
    const paths = [yield* resolvePatchPath(root, operation.path)]
    if (operation.type === 'update' && operation.moveTo) paths.push(yield* resolvePatchPath(root, operation.moveTo))
    resolvedPaths.push(paths)
  }
  const locked = [...new Set(resolvedPaths.flat())].sort()
  const committed = yield* Ref.make<AppliedFile[] | undefined>(undefined)
  const action = Effect.fn('applyPatch.action')(function* (): Effect.fn.Return<AppliedFile[], ApplyPatchError> {
    const prepared: PreparedOperation[] = []
    for (const operation of operations) prepared.push(yield* prepareOperation(root, operation))
    return yield* Effect.uninterruptible(commit(prepared).pipe(Effect.tap((files) => Ref.set(committed, files))))
  })()
  return yield* Effect.catchCause(withLockedPaths(locked, action), (cause) =>
    Ref.get(committed).pipe(
      Effect.flatMap((files) =>
        files !== undefined && Cause.hasInterruptsOnly(cause) ? Effect.succeed(files) : Effect.failCause(cause),
      ),
    ),
  )
})

const prepareOperation = Effect.fn('prepareOperation')(function* (
  root: string,
  operation: PatchOperation,
): Effect.fn.Return<PreparedOperation, ApplyPatchError> {
  const path = yield* resolvePatchPath(root, operation.path)
  if (operation.type === 'add') {
    if (yield* exists(path))
      return yield* failApply(`apply_patch verification failed: file already exists: ${operation.path}`)
    return {
      type: 'add',
      path,
      next: Buffer.from(operation.content),
      result: {
        type: 'add',
        path: operation.path,
        additions: lineCount(operation.content),
        deletions: 0,
        diff: operation.diff,
      },
    }
  }

  const source = yield* readText(path, operation.path)
  if (operation.type === 'delete') {
    return {
      type: 'delete',
      path,
      result: {
        type: 'delete',
        path: operation.path,
        additions: 0,
        deletions: lineCount(source.text),
        diff: operation.diff,
      },
    }
  }

  const destination = operation.moveTo ? yield* resolvePatchPath(root, operation.moveTo) : undefined
  if (destination && (yield* exists(destination)))
    return yield* failApply(`apply_patch verification failed: destination already exists: ${operation.moveTo}`)
  const nextText = yield* applyChunks(normalizeLineEndings(source.text), operation.chunks, operation.path)
  return {
    type: 'update',
    path,
    destination,
    next: Buffer.from(source.bom + restoreLineEndings(nextText, source.ending)),
    result: {
      type: destination ? 'move' : 'update',
      path: operation.path,
      destination: operation.moveTo,
      additions: countChunkLines(operation.chunks, '+'),
      deletions: countChunkLines(operation.chunks, '-'),
      diff: operation.diff,
    },
  }
})

const applyChunks = Effect.fn('applyChunks')(function* (
  content: string,
  chunks: PatchChunk[],
  path: string,
): Effect.fn.Return<string, ApplyPatchError> {
  let next = content
  for (const chunk of chunks) {
    const oldText = chunk.lines
      .filter((line) => !line.startsWith('+'))
      .map((line) => line.slice(1))
      .join('\n')
    const newText = chunk.lines
      .filter((line) => !line.startsWith('-'))
      .map((line) => line.slice(1))
      .join('\n')
    if (!oldText) return yield* failApply(`apply_patch verification failed: hunk has no original content: ${path}`)
    const first = next.indexOf(oldText)
    if (first < 0) return yield* failApply(`apply_patch verification failed: hunk does not match file: ${path}`)
    if (next.indexOf(oldText, first + oldText.length) >= 0)
      return yield* failApply(`apply_patch verification failed: hunk matches multiple locations: ${path}`)
    next = `${next.slice(0, first)}${newText}${next.slice(first + oldText.length)}`
  }
  return next
})

const commit = Effect.fn('commit')(function* (
  operations: PreparedOperation[],
): Effect.fn.Return<AppliedFile[], ApplyPatchError> {
  const originals = new Map<string, Buffer | undefined>()
  const temporary = new Map<string, string>()
  const touched = [
    ...new Set(
      operations.flatMap((operation) =>
        [operation.path, operation.destination].filter((path): path is string => Boolean(path)),
      ),
    ),
  ]
  for (const path of touched) {
    const existed = yield* exists(path)
    originals.set(path, existed ? yield* fileSystem(() => readFile(path)) : undefined)
  }

  const transaction = Effect.fn('commit.transaction')(function* (): Effect.fn.Return<AppliedFile[], ApplyPatchError> {
    for (const operation of operations) {
      const target = operation.destination ?? (operation.type === 'delete' ? undefined : operation.path)
      const next = operation.next
      if (!target || next === undefined) continue
      yield* fileSystem(() => mkdir(dirname(target), { recursive: true }))
      const temp = resolve(dirname(target), `.${basename(target)}.apply-patch-${randomUUID()}`)
      temporary.set(target, temp)
      yield* fileSystem(() => writeFile(temp, next))
    }
    for (const [target, temp] of temporary) yield* fileSystem(() => rename(temp, target))
    for (const operation of operations) {
      if (operation.type === 'delete' || operation.destination)
        yield* fileSystem(() => rm(operation.path, { force: false }))
    }
    return operations.map((operation) => operation.result)
  })()
  const finalize = Effect.fn('commit.finalize')(function* (
    exit: Exit.Exit<AppliedFile[], ApplyPatchError>,
  ): Effect.fn.Return<void, ApplyPatchError> {
    if (Exit.isFailure(exit)) yield* restoreOriginals(originals)
    yield* removeTemporaryFiles(temporary)
  })
  return yield* Effect.onExit(transaction, finalize)
})

const restoreOriginals = Effect.fn('restoreOriginals')(function* (
  originals: Map<string, Buffer | undefined>,
): Effect.fn.Return<void, ApplyPatchError> {
  return yield* Effect.forEach(
    [...originals],
    ([path, content]) => restoreOriginal(path, content).pipe(Effect.catchCause(() => Effect.void)),
    { discard: true },
  )
})

const restoreOriginal = Effect.fn('restoreOriginal')(function* (
  path: string,
  content: Buffer | undefined,
): Effect.fn.Return<void, ApplyPatchError> {
  if (content === undefined) return yield* fileSystem(() => rm(path, { force: true }))
  yield* fileSystem(() => mkdir(dirname(path), { recursive: true }))
  yield* fileSystem(() => writeFile(path, content))
})

const removeTemporaryFiles = Effect.fn('removeTemporaryFiles')(function* (
  temporary: Map<string, string>,
): Effect.fn.Return<void, ApplyPatchError> {
  return yield* Effect.forEach(
    [...temporary.values()],
    (path) => fileSystem(() => rm(path, { force: true })).pipe(Effect.catchCause(() => Effect.void)),
    { discard: true },
  )
})

const withLockedPaths = Effect.fn('withLockedPaths')(function* <A, R>(
  paths: string[],
  action: Effect.Effect<A, ApplyPatchError, R>,
): Effect.fn.Return<A, ApplyPatchError, R | PatchMutationQueue> {
  const lock = Effect.fn('withLockedPaths.lock')(function* (
    index: number,
  ): Effect.fn.Return<A, ApplyPatchError, R | PatchMutationQueue> {
    if (index === paths.length) return yield* action
    const path = paths[index]
    if (path === undefined) return yield* failApply('apply_patch verification failed: missing lock path')
    const mutationQueue = yield* PatchMutationQueue
    return yield* mutationQueue.withLock(path, lock(index + 1))
  })
  return yield* lock(0)
})

const resolvePatchPath = Effect.fn('resolvePatchPath')(function* (
  root: string,
  patchPath: string,
): Effect.fn.Return<string, ApplyPatchError> {
  if (!patchPath || isAbsolute(patchPath))
    return yield* failApply(`apply_patch verification failed: path must be project-relative: ${patchPath}`)
  const target = resolve(root, patchPath)
  if (!inside(root, target))
    return yield* failApply(`apply_patch verification failed: path escapes project: ${patchPath}`)
  const parent = yield* existingParent(target)
  const actualParent = yield* fileSystem(() => realpath(parent))
  if (!inside(root, actualParent))
    return yield* failApply(`apply_patch verification failed: path escapes project through symlink: ${patchPath}`)
  return target
})

const readText = Effect.fn('readText')(function* (
  path: string,
  displayPath: string,
): Effect.fn.Return<{ bom: string; text: string; ending: '\n' | '\r\n' }, ApplyPatchError> {
  const info = yield* Effect.tryPromise({
    try: () => lstat(path),
    catch: (cause: unknown) =>
      isMissingPathError(cause)
        ? createApplyPatchError('apply', new Error(`apply_patch verification failed: file not found: ${displayPath}`))
        : createApplyPatchError('filesystem', cause),
  })
  if (!info.isFile() || info.isSymbolicLink())
    return yield* failApply(`apply_patch verification failed: target is not a regular file: ${displayPath}`)
  const bytes = yield* fileSystem(() => readFile(path))
  const decoded = bytes.toString('utf8')
  if (!Buffer.from(decoded).equals(bytes))
    return yield* failApply(`apply_patch verification failed: file is not UTF-8 text: ${displayPath}`)
  const bom = decoded.startsWith('\uFEFF') ? '\uFEFF' : ''
  const text = bom ? decoded.slice(1) : decoded
  return { bom, text, ending: text.includes('\r\n') ? '\r\n' : '\n' }
})

const existingParent = Effect.fn('existingParent')(function* (path: string): Effect.fn.Return<string, ApplyPatchError> {
  let current = dirname(path)
  while (!(yield* exists(current))) current = dirname(current)
  return current
})

const exists = Effect.fn('exists')(function* (path: string): Effect.fn.Return<boolean, ApplyPatchError> {
  return yield* Effect.matchEffect(
    fileSystem(() => stat(path)),
    {
      onFailure: (error: ApplyPatchError) =>
        isMissingPathError(error.cause) ? Effect.succeed(false) : Effect.fail(error),
      onSuccess: () => Effect.succeed(true),
    },
  )
})

const fileSystem = Effect.fn('fileSystem')(function* <A>(
  operation: () => PromiseLike<A>,
): Effect.fn.Return<A, ApplyPatchError> {
  return yield* Effect.tryPromise({
    try: operation,
    catch: (cause: unknown) => createApplyPatchError(isFileSystemError(cause) ? 'filesystem' : 'apply', cause),
  })
})

function failApply(message: string): Effect.Effect<never, ApplyPatchError> {
  return Effect.fail(createApplyPatchError('apply', new Error(message)))
}

function createApplyPatchError(operation: 'parse' | 'apply' | 'filesystem', cause: unknown): ApplyPatchError {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new ApplyPatchError({ operation, message, cause })
}

function isFileSystemError(cause: unknown): cause is Error & { code: string } {
  return cause instanceof Error && 'code' in cause && typeof cause.code === 'string'
}

function isMissingPathError(cause: unknown): boolean {
  return isFileSystemError(cause) && (cause.code === 'ENOENT' || cause.code === 'ENOTDIR')
}

function inside(root: string, target: string): boolean {
  const value = relative(root, target)
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value))
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function restoreLineEndings(value: string, ending: '\n' | '\r\n'): string {
  return ending === '\n' ? value : value.replace(/\n/g, '\r\n')
}

function lineCount(value: string): number {
  return value === '' ? 0 : value.endsWith('\n') ? value.slice(0, -1).split('\n').length : value.split('\n').length
}

function countChunkLines(chunks: PatchChunk[], prefix: '+' | '-'): number {
  return chunks.reduce((count, chunk) => count + chunk.lines.filter((line) => line.startsWith(prefix)).length, 0)
}

function isHeader(line: string): boolean {
  return (
    line.startsWith('*** Add File: ') ||
    line.startsWith('*** Update File: ') ||
    line.startsWith('*** Delete File: ') ||
    line === end
  )
}

function addDiff(path: string, content: string[]): string {
  return [`--- /dev/null`, `+++ ${path}`, ...content.map((line) => `+${line}`)].join('\n')
}

function updateDiff(path: string, moveTo: string | undefined, chunks: PatchChunk[]): string {
  return [`--- ${path}`, `+++ ${moveTo ?? path}`, ...chunks.flatMap((chunk) => ['@@', ...chunk.lines])].join('\n')
}

export {
  type AppliedFile,
  ApplyPatchError,
  applyPatch,
  type PatchChunk,
  PatchMutationQueue,
  type PatchOperation,
  parsePatch,
}
