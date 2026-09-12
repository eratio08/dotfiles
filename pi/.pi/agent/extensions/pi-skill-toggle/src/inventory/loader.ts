import { dirname } from 'node:path'
import { Context, Effect, Layer } from 'effect'
import { SkillLocator } from '../discovery/skill-locator.ts'
import type { FrontmatterCodec } from '../frontmatter/parser.ts'
import { deriveSkillMetadata } from '../frontmatter/validation.ts'
import { FileSystem, type FileSystemError } from '../ports/fs.ts'
import type { LocatedSkillFile, SkillRecord } from '../types.ts'
import { classifyInvocationMode } from './classifier.ts'

export class SkillInventory extends Context.Service<
  SkillInventory,
  {
    readonly load: (cwd: string) => Effect.Effect<SkillRecord[], FileSystemError>
  }
>()('pi-skill-toggle/inventory/SkillInventory') {}

function fallbackRecord(file: LocatedSkillFile, error: unknown): SkillRecord {
  return {
    id: file.filePath,
    name: file.filePath.split('/').at(-2) ?? file.filePath,
    description: '',
    filePath: file.filePath,
    baseDir: dirname(file.filePath),
    source: file.source,
    editable: false,
    mode: 'agent-invocable',
    diagnostics: [{ severity: 'error', message: error instanceof Error ? error.message : String(error) }],
  }
}

function loadRecord(
  fs: FileSystem['Service'],
  codec: FrontmatterCodec,
  file: LocatedSkillFile,
): Effect.Effect<SkillRecord, never> {
  return Effect.match(
    Effect.gen(function* () {
      const raw = yield* fs.readFile(file.filePath)
      return yield* Effect.try({
        try: () => {
          const doc = codec.parse(raw)
          const metadata = deriveSkillMetadata(file.filePath, doc)
          return {
            id: file.filePath,
            name: metadata.name,
            description: metadata.description,
            filePath: file.filePath,
            baseDir: dirname(file.filePath),
            source: file.source,
            editable: file.editable && doc.hasFrontmatter && !metadata.diagnostics.some((d) => d.severity === 'error'),
            mode: classifyInvocationMode(doc),
            diagnostics: metadata.diagnostics,
          }
        },
        catch: (error) => error,
      })
    }),
    {
      onFailure: (error) => fallbackRecord(file, error),
      onSuccess: (record) => record,
    },
  )
}

const load = Effect.fn('SkillInventory.load')(function* (
  fs: FileSystem['Service'],
  locator: SkillLocator['Service'],
  codec: FrontmatterCodec,
  cwd: string,
): Effect.fn.Return<SkillRecord[], FileSystemError> {
  const located = yield* locator.findSkillFiles(cwd)
  const records: SkillRecord[] = []

  for (const file of located) {
    records.push(yield* loadRecord(fs, codec, file))
  }

  return records.sort((a, b) => a.name.localeCompare(b.name) || a.filePath.localeCompare(b.filePath))
})

export function SkillInventoryLive(
  codec: FrontmatterCodec,
): Layer.Layer<SkillInventory, never, FileSystem | SkillLocator> {
  return Layer.effect(
    SkillInventory,
    Effect.gen(function* () {
      const fs = yield* FileSystem
      const locator = yield* SkillLocator
      return SkillInventory.of({ load: (cwd) => load(fs, locator, codec, cwd) })
    }),
  )
}
