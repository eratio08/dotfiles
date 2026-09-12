import { constants } from 'node:fs'
import { join } from 'node:path'
import { Context, Effect, Layer } from 'effect'
import { type DirectoryEntry, FileSystem, type FileSystemError } from '../ports/fs.ts'
import type { LocatedSkillFile, SkillSource } from '../types.ts'
import { getSkillRoots } from './pi-paths.ts'

export class SkillLocator extends Context.Service<
  SkillLocator,
  {
    readonly findSkillFiles: (cwd: string) => Effect.Effect<LocatedSkillFile[], FileSystemError>
  }
>()('pi-skill-toggle/discovery/SkillLocator') {}

function isDirectory(
  fs: FileSystem['Service'],
  path: string,
  entry: Pick<DirectoryEntry, 'isDirectory' | 'isSymbolicLink'>,
): Effect.Effect<boolean, never> {
  if (entry.isDirectory) return Effect.succeed(true)
  if (!entry.isSymbolicLink) return Effect.succeed(false)
  return fs.stat(path).pipe(
    Effect.map((stats) => stats.isDirectory),
    Effect.catch(() => Effect.succeed(false)),
  )
}

function isFile(
  fs: FileSystem['Service'],
  path: string,
  entry: Pick<DirectoryEntry, 'isFile' | 'isSymbolicLink'>,
): Effect.Effect<boolean, never> {
  if (entry.isFile) return Effect.succeed(true)
  if (!entry.isSymbolicLink) return Effect.succeed(false)
  return fs.stat(path).pipe(
    Effect.map((stats) => stats.isFile),
    Effect.catch(() => Effect.succeed(false)),
  )
}

const scanSkillDir = Effect.fn('SkillLocator.scanSkillDir')(function* (
  fs: FileSystem['Service'],
  dir: string,
  source: SkillSource,
  includeRootMarkdownFiles: boolean,
): Effect.fn.Return<LocatedSkillFile[], FileSystemError> {
  const entries = yield* fs.readdir(dir).pipe(Effect.catch(() => Effect.succeed<ReadonlyArray<DirectoryEntry>>([])))
  const out: LocatedSkillFile[] = []
  const skillEntry = entries.find((entry) => entry.name === 'SKILL.md')

  if (skillEntry) {
    const filePath = join(dir, 'SKILL.md')
    if (yield* isFile(fs, filePath, skillEntry)) {
      out.push({ filePath, source, editable: yield* fs.access(filePath, constants.R_OK | constants.W_OK) })
    }
    return out
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.name === 'node_modules') continue

    const fullPath = join(dir, entry.name)
    if (yield* isDirectory(fs, fullPath, entry)) {
      out.push(...(yield* scanSkillDir(fs, fullPath, source, false)))
      continue
    }

    if (includeRootMarkdownFiles && entry.name.endsWith('.md') && (yield* isFile(fs, fullPath, entry))) {
      out.push({ filePath: fullPath, source, editable: yield* fs.access(fullPath, constants.R_OK | constants.W_OK) })
    }
  }

  return out
})

const findSkillFiles = Effect.fn('SkillLocator.findSkillFiles')(function* (
  fs: FileSystem['Service'],
  cwd: string,
): Effect.fn.Return<LocatedSkillFile[], FileSystemError> {
  const files: LocatedSkillFile[] = []
  const seenFiles = new Set<string>()
  const seenSkillRoots = new Set<string>()

  for (const root of getSkillRoots(cwd)) {
    if (!(yield* fs.access(root.path))) continue

    const canonicalSkillRoot = yield* fs.realpath(root.path)
    if (seenSkillRoots.has(canonicalSkillRoot)) continue
    seenSkillRoots.add(canonicalSkillRoot)

    const found = yield* scanSkillDir(fs, root.path, root.source, root.includeRootMarkdownFiles)
    for (const file of found) {
      if (seenFiles.has(file.filePath)) continue
      seenFiles.add(file.filePath)
      files.push(file)
    }
  }

  return files.sort((a, b) => a.filePath.localeCompare(b.filePath))
})

export const SkillLocatorLive: Layer.Layer<SkillLocator, never, FileSystem> = Layer.effect(
  SkillLocator,
  Effect.gen(function* () {
    const fs = yield* FileSystem
    return SkillLocator.of({ findSkillFiles: (cwd) => findSkillFiles(fs, cwd) })
  }),
)
