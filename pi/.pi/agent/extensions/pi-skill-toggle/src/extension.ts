import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { keyHint, type Theme } from '@earendil-works/pi-coding-agent'
import { Key, matchesKey, type TUI, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import {
  PiCommandContext,
  type PiCommandContextTag,
  PiContext,
  type PiContextTag,
  type PiOperationsError,
  PiUi,
  type PiUiService,
  type PiUiUnavailableError,
} from '@eratio08/pi-effect'
import { Context, Effect, Layer, Option, Schema } from 'effect'

class SkillTogglePlanner extends Context.Service<
  SkillTogglePlanner,
  {
    readonly plan: (records: SkillRecord[], drafts: SkillDraft[]) => Effect.Effect<SkillChange[], FileSystemError>
  }
>()('pi-skill-toggle/apply/SkillTogglePlanner') {}

const plan = Effect.fn('SkillTogglePlanner.plan')(function* (
  fs: FileSystem['Service'],
  codec: FrontmatterCodec,
  patcher: FrontmatterPatcher,
  records: SkillRecord[],
  drafts: SkillDraft[],
): Effect.fn.Return<SkillChange[], FileSystemError> {
  const recordById = new Map(records.map((record) => [record.id, record]))
  const changes: SkillChange[] = []

  for (const draft of drafts) {
    const record = recordById.get(draft.skill.id)
    if (!record?.editable) continue

    const raw = yield* fs.readFile(record.filePath)
    const doc = codec.parse(raw)
    if (!doc.hasFrontmatter) continue

    const currentMode = classifyInvocationMode(doc)
    const needsNormalization = hasDuplicateDisableModelInvocation(doc)
    if (currentMode === draft.desiredMode && !needsNormalization) continue

    const patch = patcher.patchInvocationMode(doc, draft.desiredMode)
    if (patch.oldText === patch.newText) continue

    changes.push({
      skill: { ...record, mode: currentMode },
      filePath: record.filePath,
      from: currentMode,
      to: draft.desiredMode,
      patch,
    })
  }

  return changes
})

function SkillTogglePlannerLive(
  codec: FrontmatterCodec,
  patcher: FrontmatterPatcher,
): Layer.Layer<SkillTogglePlanner, never, FileSystem> {
  return Layer.effect(
    SkillTogglePlanner,
    Effect.gen(function* () {
      const fs = yield* FileSystem
      return SkillTogglePlanner.of({
        plan: (records: SkillRecord[], drafts: SkillDraft[]) => plan(fs, codec, patcher, records, drafts),
      })
    }),
  )
}

export { SkillTogglePlanner, SkillTogglePlannerLive }

class SkillChangeWriter extends Context.Service<
  SkillChangeWriter,
  {
    readonly apply: (changes: SkillChange[]) => Effect.Effect<ApplyResult>
  }
>()('pi-skill-toggle/apply/SkillChangeWriter') {}

type ChangeAttempt =
  | { readonly _tag: 'applied' }
  | { readonly _tag: 'conflict' }
  | { readonly _tag: 'error'; readonly error: unknown }

function applyChange(fs: FileSystem['Service'], change: SkillChange): Effect.Effect<ChangeAttempt, never> {
  return Effect.match(
    Effect.gen(function* () {
      const current = yield* fs.readFile(change.filePath)
      if (current !== change.patch.oldText) return { _tag: 'conflict' as const }
      yield* fs.writeFileAtomic(change.filePath, change.patch.newText)
      return { _tag: 'applied' as const }
    }),
    {
      onFailure: (error: FileSystemError) => ({ _tag: 'error' as const, error }),
      onSuccess: (attempt: { _tag: 'conflict' } | { _tag: 'applied' }) => attempt,
    },
  )
}

const apply = Effect.fn('SkillChangeWriter.apply')(function* (
  fs: FileSystem['Service'],
  changes: SkillChange[],
): Effect.fn.Return<ApplyResult> {
  const result: ApplyResult = { applied: [], skipped: [], errors: [] }

  for (const change of changes) {
    const attempt = yield* applyChange(fs, change)
    if (attempt._tag === 'applied') {
      result.applied.push(change)
      continue
    }
    if (attempt._tag === 'conflict') {
      result.errors.push({
        skill: change.skill,
        message: `${change.skill.name}: file changed while dialog was open; skipped`,
      })
      continue
    }
    result.errors.push({
      skill: change.skill,
      message: `${change.skill.name}: ${attempt.error instanceof Error ? attempt.error.message : String(attempt.error)}`,
    })
  }

  return result
})

const SkillChangeWriterLive: Layer.Layer<SkillChangeWriter, never, FileSystem> = Layer.effect(
  SkillChangeWriter,
  Effect.gen(function* () {
    const fs = yield* FileSystem
    return SkillChangeWriter.of({ apply: (changes: SkillChange[]) => apply(fs, changes) })
  }),
)

export { SkillChangeWriter, SkillChangeWriterLive }

const CommandPhaseSchema = Schema.Literals(['scan', 'plan', 'ui', 'reload'])
type CommandPhase = (typeof CommandPhaseSchema)['Type']

class ToggleSkillsCommandError extends Schema.TaggedError<ToggleSkillsCommandError>()('ToggleSkillsCommandError', {
  phase: CommandPhaseSchema,
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function commandError(phase: CommandPhase, cause: unknown): ToggleSkillsCommandError {
  return new ToggleSkillsCommandError({ phase, message: causeMessage(cause), cause })
}

function notify(message: string, type: 'info' | 'warning' | 'error'): Effect.Effect<void, never, PiUi> {
  return Effect.gen(function* () {
    const ui = yield* PiUi
    yield* ui.notify(message, type).pipe(Effect.catch(() => Effect.void))
  })
}

const toggleSkillsCommand = Effect.fn('toggleSkillsCommand')(function* (): Effect.fn.Return<
  void,
  ToggleSkillsCommandError,
  SkillInventory | SkillTogglePlanner | SkillChangeWriter | PiContextTag | PiCommandContextTag | PiUi
> {
  const context = yield* PiContext
  const command = yield* PiCommandContext
  const inventory = yield* SkillInventory
  const planner = yield* SkillTogglePlanner
  const writer = yield* SkillChangeWriter

  if (context.mode !== 'tui' || !context.hasUI) {
    yield* notify('/toggle-skills requires interactive mode', 'error')
    return
  }

  const skills = yield* inventory.load(context.cwd).pipe(Effect.mapError((error) => commandError('scan', error)))
  if (skills.length === 0) {
    yield* notify('Pi Skill Toggle: no skills found in global, user, or project skill directories', 'info')
    return
  }

  const ui = yield* PiUi
  const result = yield* showSkillToggleUi(ui, skills).pipe(Effect.mapError((error) => commandError('ui', error)))
  if (result.action !== 'apply') return

  const changes = yield* planner
    .plan(skills, result.drafts)
    .pipe(Effect.mapError((error) => commandError('plan', error)))
  if (changes.length === 0) {
    yield* notify('Pi Skill Toggle: no changes to apply', 'info')
    return
  }

  const applied = yield* writer.apply(changes)
  yield* notify(formatApplyResult(applied), applied.errors.length > 0 ? 'warning' : 'info')
  if (applied.applied.length > 0) {
    yield* command.reload().pipe(Effect.mapError((error) => commandError('reload', error)))
  }
})

function runToggleSkillsCommand(): Effect.Effect<void> {
  return toggleSkillsCommand().pipe(
    Effect.catch((error) => notify(formatCommandError(error), 'error')),
  ) as Effect.Effect<void>
}

function formatCommandError(error: ToggleSkillsCommandError): string {
  const prefix = {
    scan: 'Pi Skill Toggle failed to scan skills',
    plan: 'Pi Skill Toggle failed to plan changes',
    ui: 'Pi Skill Toggle failed to open the skill toggle UI',
    reload: 'Pi Skill Toggle failed to reload skills',
  }[error.phase]
  return `${prefix}: ${error.message}`
}

function formatApplyResult(result: ApplyResult): string {
  const lines = [`Pi Skill Toggle applied ${result.applied.length} change${result.applied.length === 1 ? '' : 's'}.`]
  for (const change of result.applied.slice(0, 6)) {
    lines.push(`- ${change.skill.name}: ${change.from} → ${change.to}`)
  }
  if (result.applied.length > 6) {
    lines.push(`- … ${result.applied.length - 6} more`)
  }
  if (result.errors.length > 0) {
    lines.push(`Errors/skipped: ${result.errors.length}`)
    for (const error of result.errors.slice(0, 4)) {
      lines.push(`- ${error.message}`)
    }
  }
  if (result.applied.length > 0) {
    lines.push('Reloaded skills, prompts, extensions, and themes.')
  }
  return lines.join('\n')
}

export { formatApplyResult, runToggleSkillsCommand, ToggleSkillsCommandError }

type SkillRoot = { path: string; source: SkillSource; includeRootMarkdownFiles: boolean }

function homeDirectory(): string {
  return process.env.HOME?.trim() || homedir()
}

function getAgentDir(): string {
  const configured = process.env.PI_CODING_AGENT_DIR?.trim()
  if (configured) return expandHome(configured)
  return join(homeDirectory(), '.pi', 'agent')
}

function getGlobalAgentsSkillDir(): string {
  return join(homeDirectory(), '.agents', 'skills')
}

function getSkillRoots(cwd: string): SkillRoot[] {
  const resolvedCwd = resolve(cwd)
  const userSkillRoot = join(getAgentDir(), 'skills')
  const globalSkillRoot = getGlobalAgentsSkillDir()
  const projectSkillRoot = resolve(resolvedCwd, '.pi', 'skills')
  const projectLegacySkillRoot = resolve(resolvedCwd, '.agents', 'skills')
  const roots: SkillRoot[] = [
    {
      path: userSkillRoot,
      source: { kind: 'user', root: userSkillRoot },
      includeRootMarkdownFiles: true,
    },
    {
      path: globalSkillRoot,
      source: { kind: 'global', root: globalSkillRoot },
      includeRootMarkdownFiles: false,
    },
    {
      path: projectSkillRoot,
      source: { kind: 'project', root: projectSkillRoot },
      includeRootMarkdownFiles: true,
    },
    // Pi also loads .agents/skills as a project skill directory. Root markdown
    // files are ignored there; directories containing SKILL.md are discovered.
    {
      path: projectLegacySkillRoot,
      source: { kind: 'project-legacy', root: projectLegacySkillRoot },
      includeRootMarkdownFiles: false,
    },
  ]

  const seen = new Set<string>()
  return roots.filter((root) => {
    const key = resolve(root.path)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function expandHome(input: string): string {
  if (input === '~') return homeDirectory()
  if (input.startsWith('~/')) return join(homeDirectory(), input.slice(2))
  return input
}

export { getAgentDir, getGlobalAgentsSkillDir, getSkillRoots, type SkillRoot }

class SkillLocator extends Context.Service<
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

const SkillLocatorLive: Layer.Layer<SkillLocator, never, FileSystem> = Layer.effect(
  SkillLocator,
  Effect.gen(function* () {
    const fs = yield* FileSystem
    return SkillLocator.of({ findSkillFiles: (cwd: string) => findSkillFiles(fs, cwd) })
  }),
)

export { SkillLocator, SkillLocatorLive }

type FrontmatterCodec = { parse(raw: string): FrontmatterDocument }

class SimpleFrontmatterCodec implements FrontmatterCodec {
  parse(raw: string): FrontmatterDocument {
    const lineEnding: '\n' | '\r\n' = raw.includes('\r\n') ? '\r\n' : '\n'
    const opening = raw.match(/^---[ \t]*(\r?\n)/)
    if (!opening) {
      return {
        raw,
        hasFrontmatter: false,
        frontmatterStart: 0,
        frontmatterEnd: 0,
        contentStart: 0,
        frontmatterText: '',
        bodyText: raw,
        fields: {},
        lineEnding,
      }
    }

    const frontmatterStart = opening[0].length
    const rest = raw.slice(frontmatterStart)
    const closing = /^---[ \t]*(?:\r?\n|$)/m.exec(rest)
    if (!closing || closing.index === undefined) {
      return {
        raw,
        hasFrontmatter: false,
        frontmatterStart: 0,
        frontmatterEnd: 0,
        contentStart: 0,
        frontmatterText: '',
        bodyText: raw,
        fields: {},
        lineEnding,
      }
    }

    const frontmatterEnd = frontmatterStart + closing.index
    const contentStart = frontmatterEnd + closing[0].length
    const frontmatterText = raw.slice(frontmatterStart, frontmatterEnd)

    return {
      raw,
      hasFrontmatter: true,
      frontmatterStart,
      frontmatterEnd,
      contentStart,
      frontmatterText,
      bodyText: raw.slice(contentStart),
      fields: parseYamlLikeFields(frontmatterText),
      lineEnding,
    }
  }
}

function parseYamlLikeFields(frontmatterText: string): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const rawLine of frontmatterText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(rawLine)
    if (!match) continue
    const key = match[1]
    if (!key) continue
    fields[key] = parseScalar(match[2] ?? '')
  }
  return fields
}

function parseScalar(raw: string): unknown {
  const value = raw.trim()
  if (value === 'true') return true
  if (value === 'false') return false
  if (value === 'null' || value === '~') return null
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

export { type FrontmatterCodec, SimpleFrontmatterCodec }

const DISABLE_KEY = 'disable-model-invocation'
const DISABLE_KEY_RE = /^\s*disable-model-invocation\s*:/

type FrontmatterPatcher = {
  patchInvocationMode(doc: FrontmatterDocument, desiredMode: SkillInvocationMode): FrontmatterPatch
}

class MinimalFrontmatterPatcher implements FrontmatterPatcher {
  patchInvocationMode(doc: FrontmatterDocument, desiredMode: SkillInvocationMode): FrontmatterPatch {
    if (!doc.hasFrontmatter) {
      const newFrontmatter = desiredMode === 'manual-only' ? `${DISABLE_KEY}: true${doc.lineEnding}` : ''
      const newText = newFrontmatter ? `---${doc.lineEnding}${newFrontmatter}---${doc.lineEnding}${doc.raw}` : doc.raw
      return { oldText: doc.raw, newText }
    }

    const newFrontmatter =
      desiredMode === 'manual-only'
        ? ensureManualOnly(doc.frontmatterText, doc.lineEnding)
        : ensureAgentInvocable(doc.frontmatterText)

    const newText = doc.raw.slice(0, doc.frontmatterStart) + newFrontmatter + doc.raw.slice(doc.frontmatterEnd)
    return { oldText: doc.raw, newText }
  }
}

function ensureManualOnly(frontmatterText: string, lineEnding: '\n' | '\r\n'): string {
  const lines = splitLinesPreserve(frontmatterText, lineEnding)
  let replaced = false
  const next: string[] = []

  for (const line of lines) {
    if (DISABLE_KEY_RE.test(stripEol(line))) {
      if (!replaced) {
        next.push(`${DISABLE_KEY}: true${getEol(line) || lineEnding}`)
        replaced = true
      }
      continue
    }
    next.push(line)
  }

  if (!replaced) {
    const last = next.at(-1)
    if (last !== undefined && !endsWithEol(last)) {
      next[next.length - 1] = `${last}${lineEnding}`
    }
    next.push(`${DISABLE_KEY}: true${lineEnding}`)
  }

  return next.join('')
}

function ensureAgentInvocable(frontmatterText: string): string {
  return splitLinesPreserve(frontmatterText, frontmatterText.includes('\r\n') ? '\r\n' : '\n')
    .filter((line) => !DISABLE_KEY_RE.test(stripEol(line)))
    .join('')
}

function splitLinesPreserve(text: string, fallbackEol: '\n' | '\r\n'): string[] {
  if (text.length === 0) return []
  const lines = text.match(/.*(?:\r?\n|$)/g)?.filter((line) => line.length > 0) ?? [text]
  return lines.length > 0 ? lines : [fallbackEol]
}

function getEol(line: string): string {
  if (line.endsWith('\r\n')) return '\r\n'
  if (line.endsWith('\n')) return '\n'
  return ''
}

function stripEol(line: string): string {
  return line.replace(/\r?\n$/, '')
}

function endsWithEol(line: string): boolean {
  return line.endsWith('\n')
}

export { type FrontmatterPatcher, MinimalFrontmatterPatcher }

const FRONTMATTER_KEY_RE = /^([A-Za-z0-9_-]+)\s*:/

function deriveSkillMetadata(
  filePath: string,
  doc: FrontmatterDocument,
): {
  name: string
  description: string
  diagnostics: SkillDiagnostic[]
} {
  const diagnostics: SkillDiagnostic[] = []
  const parentDirName = basename(dirname(filePath))
  const name = stringField(doc.fields.name) || parentDirName
  const description = stringField(doc.fields.description)

  if (!doc.hasFrontmatter) {
    diagnostics.push({ severity: 'warning', message: 'Missing YAML front matter' })
  }

  const duplicateKeys = getDuplicateFrontmatterKeys(doc)
  if (duplicateKeys.length > 0) {
    diagnostics.push({
      severity: 'warning',
      message: `Duplicate frontmatter key${duplicateKeys.length === 1 ? '' : 's'}: ${duplicateKeys.join(', ')}`,
    })
  }

  if (!description) {
    diagnostics.push({ severity: 'error', message: 'Missing required description; Pi will not load this skill' })
  }
  if (name !== parentDirName && basename(filePath) === 'SKILL.md') {
    diagnostics.push({ severity: 'warning', message: `Name does not match parent directory (${parentDirName})` })
  }

  return { name, description: description || '', diagnostics }
}

function getDisableModelInvocation(doc: FrontmatterDocument): boolean {
  return doc.fields['disable-model-invocation'] === true
}

function hasDuplicateDisableModelInvocation(doc: FrontmatterDocument): boolean {
  return (getTopLevelFrontmatterKeyCounts(doc).get('disable-model-invocation') ?? 0) > 1
}

function getDuplicateFrontmatterKeys(doc: FrontmatterDocument): string[] {
  return [...getTopLevelFrontmatterKeyCounts(doc)]
    .filter(([, count]) => count > 1)
    .map(([key]) => key)
    .sort()
}

function getTopLevelFrontmatterKeyCounts(doc: FrontmatterDocument): Map<string, number> {
  const counts = new Map<string, number>()
  if (!doc.hasFrontmatter) return counts

  for (const rawLine of doc.frontmatterText.split(/\r?\n/)) {
    const trimmed = rawLine.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = FRONTMATTER_KEY_RE.exec(rawLine)
    if (!match?.[1]) continue
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
  }

  return counts
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export {
  deriveSkillMetadata,
  getDisableModelInvocation,
  getDuplicateFrontmatterKeys,
  hasDuplicateDisableModelInvocation,
}

function classifyInvocationMode(doc: FrontmatterDocument): SkillInvocationMode {
  return getDisableModelInvocation(doc) ? 'manual-only' : 'agent-invocable'
}

function formatSourceKind(kind: SkillSource['kind'] | string): string {
  switch (kind) {
    case 'global':
      return 'Global'
    case 'user':
      return 'User'
    case 'project':
      return 'Project'
    case 'project-legacy':
      return 'Project (.agents)'
    default:
      return 'Unknown'
  }
}

function sourceCategory(source: SkillSource): 'global' | 'user' | 'project' | 'unknown' {
  if (source.kind === 'project-legacy') return 'project'
  if (source.kind === 'global' || source.kind === 'user' || source.kind === 'project') return source.kind
  return 'unknown'
}

function sourceBadge(source: SkillSource): string {
  return sourceCategory(source)
}

export { classifyInvocationMode, formatSourceKind, sourceBadge, sourceCategory }

class SkillInventory extends Context.Service<
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
        catch: (error: unknown) => error,
      })
    }),
    {
      onFailure: (error: unknown) => fallbackRecord(file, error),
      onSuccess: (record: {
        id: string
        name: string
        description: string
        filePath: string
        baseDir: string
        source: SkillSource
        editable: boolean
        mode: SkillInvocationMode
        diagnostics: SkillDiagnostic[]
      }) => record,
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

function SkillInventoryLive(codec: FrontmatterCodec): Layer.Layer<SkillInventory, never, FileSystem | SkillLocator> {
  return Layer.effect(
    SkillInventory,
    Effect.gen(function* () {
      const fs = yield* FileSystem
      const locator = yield* SkillLocator
      return SkillInventory.of({ load: (cwd: string) => load(fs, locator, codec, cwd) })
    }),
  )
}

export { SkillInventory, SkillInventoryLive }

type DirectoryEntry = {
  readonly name: string
  readonly isDirectory: boolean
  readonly isFile: boolean
  readonly isSymbolicLink: boolean
}

type FileStats = { readonly isDirectory: boolean; readonly isFile: boolean; readonly mode: number }

class FileSystemError extends Schema.TaggedError<FileSystemError>()('FileSystemError', {
  operation: Schema.String,
  path: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

class FileSystem extends Context.Service<
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
    catch: (cause: unknown) => toFileSystemError(operation, path, cause),
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

const FileSystemLive: Layer.Layer<FileSystem> = Layer.succeed(
  FileSystem,
  FileSystem.of({ readFile, writeFileAtomic, access, readdir, realpath, stat }),
)

export { type DirectoryEntry, type FileStats, FileSystem, FileSystemError, FileSystemLive }

const DEFAULT_CONTENT = '---\nname: test\ndescription: Test skill.\n---\n'

class MemoryFileSystem {
  private readonly files = new Map<string, string>()
  private readonly dirs = new Set<string>(['/'])
  private readonly canonicalPaths: ReadonlyMap<string, string>
  readonly service: FileSystem['Service']
  readonly layer: Layer.Layer<FileSystem>

  constructor(
    pathsOrContents: readonly string[] | ReadonlyMap<string, string>,
    canonicalPaths: ReadonlyMap<string, string> = new Map(),
  ) {
    this.canonicalPaths = canonicalPaths
    if (Array.isArray(pathsOrContents)) {
      for (const path of pathsOrContents) this.addFile(path, DEFAULT_CONTENT)
    } else {
      const contents = pathsOrContents as ReadonlyMap<string, string>
      contents.forEach((content, path) => {
        this.addFile(path, content)
      })
    }

    this.service = FileSystem.of({
      readFile: (path: string) => {
        const content = this.files.get(path)
        return content === undefined
          ? Effect.fail(this.error('readFile', path, `missing file: ${path}`))
          : Effect.succeed(content)
      },
      writeFileAtomic: (path: string, content: string) => {
        this.addFile(path, content)
        return Effect.void
      },
      access: (path: string) => Effect.succeed(this.files.has(path) || this.dirs.has(path)),
      readdir: (path: string) => {
        if (!this.dirs.has(path)) return Effect.fail(this.error('readdir', path, `missing directory: ${path}`))
        const prefix = path === '/' ? '/' : `${path}/`
        const names = new Set<string>()
        for (const directory of this.dirs) {
          if (directory === path || !directory.startsWith(prefix)) continue
          const [name] = directory.slice(prefix.length).split('/')
          if (name) names.add(name)
        }
        for (const file of this.files.keys()) {
          if (!file.startsWith(prefix)) continue
          const [name] = file.slice(prefix.length).split('/')
          if (name) names.add(name)
        }
        return Effect.succeed(
          [...names].sort().map((name): DirectoryEntry => {
            const fullPath = path === '/' ? `/${name}` : `${path}/${name}`
            return {
              name,
              isDirectory: this.dirs.has(fullPath),
              isFile: this.files.has(fullPath),
              isSymbolicLink: false,
            }
          }),
        )
      },
      realpath: (path: string) => Effect.succeed(this.canonicalPaths.get(path) ?? path),
      stat: (path: string) =>
        Effect.succeed({ isDirectory: this.dirs.has(path), isFile: this.files.has(path), mode: 0o644 }),
    })
    this.layer = Layer.succeed(FileSystem, this.service)
  }

  content(path: string): string | undefined {
    return this.files.get(path)
  }

  private addFile(path: string, content: string): void {
    this.files.set(path, content)
    const parts = path.split('/').filter(Boolean)
    let current = ''
    for (const part of parts.slice(0, -1)) {
      current += `/${part}`
      this.dirs.add(current)
    }
  }

  private error(operation: string, path: string, message: string): FileSystemError {
    return new FileSystemError({ operation, path, message, cause: undefined })
  }
}

export { MemoryFileSystem }

type SkillInvocationMode = 'agent-invocable' | 'manual-only'

type SkillSource =
  | { kind: 'global'; root: string }
  | { kind: 'user'; root: string }
  | { kind: 'project'; root: string }
  | { kind: 'project-legacy'; root: string }
  | { kind: 'unknown'; root: string }

type LocatedSkillFile = { filePath: string; source: SkillSource; editable: boolean }

type SkillDiagnosticSeverity = 'info' | 'warning' | 'error'

type SkillDiagnostic = { severity: SkillDiagnosticSeverity; message: string }

type SkillRecord = {
  id: string
  name: string
  description: string
  filePath: string
  baseDir: string
  source: SkillSource
  editable: boolean
  mode: SkillInvocationMode
  diagnostics: SkillDiagnostic[]
}

type SkillDraft = { skill: SkillRecord; desiredMode: SkillInvocationMode }

type FrontmatterDocument = {
  raw: string
  hasFrontmatter: boolean
  frontmatterStart: number
  frontmatterEnd: number
  contentStart: number
  frontmatterText: string
  bodyText: string
  fields: Record<string, unknown>
  lineEnding: '\n' | '\r\n'
}

type FrontmatterPatch = { oldText: string; newText: string }

type SkillChange = {
  skill: SkillRecord
  filePath: string
  from: SkillInvocationMode
  to: SkillInvocationMode
  patch: FrontmatterPatch
}

type ApplyResult = {
  applied: SkillChange[]
  skipped: Array<{ skill: SkillRecord; reason: string }>
  errors: Array<{ skill?: SkillRecord; message: string }>
}

type SkillToggleUiResult = { action: 'apply' | 'cancel'; drafts: SkillDraft[] }

export type {
  ApplyResult,
  FrontmatterDocument,
  FrontmatterPatch,
  LocatedSkillFile,
  SkillChange,
  SkillDiagnostic,
  SkillDiagnosticSeverity,
  SkillDraft,
  SkillInvocationMode,
  SkillRecord,
  SkillSource,
  SkillToggleUiResult,
}

type SkillToggleTui = Pick<TUI, 'requestRender' | 'terminal'>
type SkillToggleTheme = Pick<Theme, 'fg' | 'bold'>
type SkillToggleKeybindings = {
  matches(
    data: string,
    keybinding: 'tui.select.cancel' | 'tui.select.up' | 'tui.select.down' | 'tui.editor.deleteCharBackward',
  ): boolean
}

function showSkillToggleUi(
  ui: PiUiService,
  skills: SkillRecord[],
): Effect.Effect<
  SkillToggleUiResult | { action: 'cancel'; drafts: never[] },
  PiOperationsError | PiUiUnavailableError,
  never
> {
  return ui
    .custom<SkillToggleUiResult>(
      (tui, theme, keybindings, done) => new SkillToggleOverlay(tui, theme, skills, keybindings, done),
      {
        overlay: true,
        overlayOptions: {
          anchor: 'center',
          width: '92%',
          maxHeight: '88%',
          minWidth: 86,
        },
      },
    )
    .pipe(Effect.map((result) => Option.getOrElse(result, () => ({ action: 'cancel' as const, drafts: [] }))))
}

class SkillToggleOverlay {
  private readonly desired = new Map<string, SkillInvocationMode>()
  private search = ''
  private selectedIndex = 0

  constructor(
    private readonly tui: SkillToggleTui,
    private readonly theme: SkillToggleTheme,
    private readonly skills: SkillRecord[],
    private readonly keybindings: SkillToggleKeybindings,
    private readonly done: (result: SkillToggleUiResult) => void,
  ) {
    for (const skill of skills) this.desired.set(skill.id, skill.mode)
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, 'tui.select.cancel')) {
      this.done({ action: 'cancel', drafts: this.getDrafts() })
      return
    }

    if (matchesKey(data, Key.ctrl('s'))) {
      this.done({ action: 'apply', drafts: this.getDrafts() })
      return
    }

    if (this.keybindings.matches(data, 'tui.select.up')) {
      this.moveSelection(-1)
      return
    }

    if (this.keybindings.matches(data, 'tui.select.down')) {
      this.moveSelection(1)
      return
    }

    if (matchesKey(data, Key.space)) {
      const selected = this.getSelectedSkill()
      if (selected?.editable) {
        this.desired.set(selected.id, toggleMode(this.desired.get(selected.id) ?? selected.mode))
        this.tui.requestRender()
      }
      return
    }

    if (this.keybindings.matches(data, 'tui.editor.deleteCharBackward')) {
      if (this.search.length > 0) {
        this.search = Array.from(this.search).slice(0, -1).join('')
        this.selectedIndex = 0
        this.tui.requestRender()
      }
      return
    }

    if (isPrintableInput(data)) {
      this.search += data
      this.selectedIndex = 0
      this.tui.requestRender()
    }
  }

  render(width: number): string[] {
    const innerWidth = Math.max(20, width - 2)
    const panelHeight = this.getPanelHeight()
    const bodyHeight = Math.max(10, panelHeight - 8)
    const leftWidth = Math.max(32, Math.floor((innerWidth - 1) * 0.48))
    const rightWidth = Math.max(28, innerWidth - leftWidth - 1)

    const header = this.renderHeader(innerWidth)
    const search = frameLine(
      this.theme,
      this.theme.fg('muted', `Search: ${this.search || '(type to filter)'}`),
      innerWidth,
    )
    const body = combineColumns(
      this.renderList(leftWidth, bodyHeight),
      this.renderDetails(rightWidth, bodyHeight),
      leftWidth,
      rightWidth,
      this.theme.fg('borderMuted', '│'),
    ).map((line) => frameLine(this.theme, line, innerWidth))

    const footer = [
      frameLine(
        this.theme,
        this.theme.fg(
          'dim',
          `type search • ${keyHint('tui.select.up', 'move up')} • ${keyHint('tui.select.down', 'move down')} • space toggle • ctrl+s apply + reload`,
        ),
        innerWidth,
      ),
      frameLine(this.theme, this.theme.fg('dim', keyHint('tui.select.cancel', 'cancel')), innerWidth),
    ]

    return [
      topBorder(this.theme, innerWidth),
      frameLine(this.theme, header, innerWidth),
      search,
      divider(this.theme, innerWidth),
      ...body,
      divider(this.theme, innerWidth),
      ...footer,
      bottomBorder(this.theme, innerWidth),
    ]
  }

  invalidate(): void {}

  private renderHeader(innerWidth: number): string {
    const title = this.theme.fg('accent', this.theme.bold('Pi Skill Toggle'))
    const changed = this.getChangedCount()
    const editable = this.skills.filter((skill) => skill.editable).length
    const summary = this.theme.fg('muted', `${this.skills.length} skills • ${editable} editable • ${changed} changed`)
    const gap = Math.max(1, innerWidth - visibleLength(title) - visibleLength(summary))
    return `${title}${' '.repeat(gap)}${summary}`
  }

  private renderList(width: number, height: number): string[] {
    const lines: string[] = []
    const filtered = this.getFilteredSkills()

    if (filtered.length === 0) {
      lines.push(this.theme.fg('dim', 'No matching skills'))
      return pad(lines, height)
    }

    this.selectedIndex = clamp(this.selectedIndex, 0, filtered.length - 1)
    const visibleCount = Math.max(4, Math.floor(height / 2))
    const start = Math.max(
      0,
      Math.min(this.selectedIndex - Math.floor(visibleCount / 2), Math.max(0, filtered.length - visibleCount)),
    )
    const end = Math.min(filtered.length, start + visibleCount)

    for (let i = start; i < end; i += 1) {
      const skill = filtered[i]
      if (!skill) continue
      const desired = this.desired.get(skill.id) ?? skill.mode
      const selected = i === this.selectedIndex
      const changed = desired !== skill.mode
      const marker = selected ? '›' : ' '
      const box = desired === 'manual-only' ? '◼' : '□'
      const readonly = skill.editable ? '' : this.theme.fg('warning', ' read-only')
      const changedMark = changed ? this.theme.fg('accent', ' *') : ''
      const label = `${marker} ${box} ${skill.name}${changedMark}${readonly}`
      lines.push(selected ? this.theme.fg('accent', this.theme.bold(fit(label, width))) : fit(label, width))
      lines.push(
        this.theme.fg(
          'dim',
          fit(`    ${modeLabel(desired)} — ${shorten(skill.description || 'No description', width - 4)}`, width),
        ),
      )
    }

    return pad(lines, height)
  }

  private renderDetails(width: number, height: number): string[] {
    const skill = this.getSelectedSkill()
    const lines: string[] = []
    if (!skill) {
      lines.push(this.theme.fg('dim', 'No skill selected'))
      return pad(lines, height)
    }

    const desired = this.desired.get(skill.id) ?? skill.mode
    lines.push(this.theme.fg('accent', this.theme.bold(skill.name)))
    lines.push('')
    lines.push(`${this.theme.fg('muted', 'Current:')} ${modeLabel(skill.mode)}`)
    lines.push(
      `${this.theme.fg('muted', 'Desired:')} ${modeLabel(desired)}${desired !== skill.mode ? this.theme.fg('accent', ' (changed)') : ''}`,
    )
    lines.push(`${this.theme.fg('muted', 'Source:')} ${formatSourceKind(skill.source.kind)}`)
    lines.push(`${this.theme.fg('muted', 'Root:')} ${skill.source.root}`)
    lines.push(`${this.theme.fg('muted', 'Editable:')} ${skill.editable ? 'yes' : this.theme.fg('warning', 'no')}`)
    lines.push('')
    lines.push(this.theme.fg('muted', 'Path:'))
    lines.push(...wrap(skill.filePath, width))
    lines.push('')
    lines.push(this.theme.fg('muted', 'Description:'))
    lines.push(...wrap(skill.description || '(missing)', width))

    if (skill.diagnostics.length > 0) {
      lines.push('')
      lines.push(this.theme.fg('muted', 'Diagnostics:'))
      for (const diagnostic of skill.diagnostics.slice(0, 4)) {
        const color = diagnostic.severity === 'error' ? 'error' : diagnostic.severity === 'warning' ? 'warning' : 'dim'
        lines.push(...wrap(`- ${diagnostic.message}`, width).map((line) => this.theme.fg(color, line)))
      }
    }

    return pad(lines, height)
  }

  private moveSelection(delta: number): void {
    const filtered = this.getFilteredSkills()
    if (filtered.length === 0) return
    this.selectedIndex = clamp(this.selectedIndex + delta, 0, filtered.length - 1)
    this.tui.requestRender()
  }

  private getFilteredSkills(): SkillRecord[] {
    return filterSkills(this.skills, this.search)
  }

  private getSelectedSkill(): SkillRecord | undefined {
    return this.getFilteredSkills()[this.selectedIndex]
  }

  private getDrafts(): SkillDraft[] {
    return this.skills.map((skill) => ({ skill, desiredMode: this.desired.get(skill.id) ?? skill.mode }))
  }

  private getChangedCount(): number {
    return this.skills.filter((skill) => (this.desired.get(skill.id) ?? skill.mode) !== skill.mode).length
  }

  private getPanelHeight(): number {
    const rows = this.tui.terminal.rows ?? 30
    return clamp(Math.floor(rows * 0.82), 16, 52)
  }
}

function isPrintableInput(data: string): boolean {
  return data.length > 0 && !data.includes('\x1b') && !data.includes('\r') && !data.includes('\n') && data >= ' '
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function pad(lines: string[], height: number): string[] {
  const padded = [...lines]
  while (padded.length < height) padded.push('')
  return padded.slice(0, height)
}

function shorten(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`
}

function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (current.length === 0) {
      current = word
    } else if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

const ANSI_COLOR_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

function visibleLength(input: string): number {
  return input.replace(ANSI_COLOR_RE, '').length
}

export { SkillToggleOverlay, showSkillToggleUi }

type RenderTheme = Pick<Theme, 'fg'>

function fit(text: string, width: number): string {
  const truncated = truncateToWidth(text, Math.max(0, width))
  const padding = Math.max(0, width - visibleWidth(truncated))
  return `${truncated}${' '.repeat(padding)}`
}

function frameLine(theme: RenderTheme, content: string, innerWidth: number): string {
  return `${theme.fg('borderAccent', '│')}${fit(content, innerWidth)}${theme.fg('borderAccent', '│')}`
}

function divider(theme: RenderTheme, innerWidth: number): string {
  return theme.fg('borderMuted', `├${'─'.repeat(innerWidth)}┤`)
}

function topBorder(theme: RenderTheme, innerWidth: number): string {
  return theme.fg('borderAccent', `┌${'─'.repeat(innerWidth)}┐`)
}

function bottomBorder(theme: RenderTheme, innerWidth: number): string {
  return theme.fg('borderAccent', `└${'─'.repeat(innerWidth)}┘`)
}

function combineColumns(left: string[], right: string[], leftWidth: number, rightWidth: number, sep: string): string[] {
  const rows = Math.max(left.length, right.length)
  const lines: string[] = []
  for (let i = 0; i < rows; i += 1) {
    lines.push(`${fit(left[i] ?? '', leftWidth)}${sep}${fit(right[i] ?? '', rightWidth)}`)
  }
  return lines
}

export { bottomBorder, combineColumns, divider, fit, frameLine, topBorder }

function modeLabel(mode: SkillInvocationMode): string {
  return mode === 'manual-only' ? 'Manual-only' : 'Agent-invocable'
}

function toggleMode(mode: SkillInvocationMode): SkillInvocationMode {
  return mode === 'manual-only' ? 'agent-invocable' : 'manual-only'
}

function skillSearchText(skill: SkillRecord): string {
  return [
    skill.name,
    skill.description,
    skill.filePath,
    skill.source.kind,
    sourceBadge(skill.source),
    formatSourceKind(skill.source.kind),
    modeLabel(skill.mode),
  ]
    .join(' ')
    .toLowerCase()
}

function filterSkills(skills: SkillRecord[], query: string): SkillRecord[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return skills
  return skills.filter((skill) => {
    const haystack = skillSearchText(skill)
    return tokens.every((token) => haystack.includes(token))
  })
}

export { filterSkills, modeLabel, skillSearchText, toggleMode }
