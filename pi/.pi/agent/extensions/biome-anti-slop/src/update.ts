import { createHash, randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import {
  chmod,
  chown,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { type ExtensionAPI, withFileMutationQueue } from '@earendil-works/pi-coding-agent'
import * as Jsonc from 'jsonc-parser'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { appendBiomePlugins } from './biome-config.ts'

type PortSnapshot = {
  format: 1
  upstreamRevision: string
  portRevision: string
  effectEnabled: boolean
  plugins: string[]
  files: Record<string, string>
  digest: string
}

type UpdateDecisions = {
  conflicts?: Record<string, 'incoming' | 'local'>
  rules?: Record<string, 'enable' | 'disabled'>
}

type FileState = { data: string; mode: number; uid: number; gid: number; dev: number; ino: number } | null

type UpdateChange = { path: string; action: 'add' | 'change' | 'remove'; before: FileState; after: string | null }

type UpdateComparison = { name: string; base: string | null; local: string | null; incoming: string | null }

type UpdatePreview = {
  root: string
  baseAvailable: boolean
  baseRevision: string | null
  incomingRevision: string
  effectEnabled: boolean | null
  changes: UpdateChange[]
  comparisons: UpdateComparison[]
  pending: string[]
  issues: string[]
  backupDirectory: string
  snapshotBefore: FileState
  snapshotAfter: string | null
  hash: string
}

function snapshotDigest(snapshot: Omit<PortSnapshot, 'digest'>): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

function makePortSnapshot(files: Map<string, Buffer>, effectEnabled: boolean, plugins: string[]): string {
  const provenance = files.get('UPSTREAM.md')?.toString('utf8') ?? ''
  const upstreamRevision = provenance.match(/upstream revision is `([^\x60]+)`/i)?.[1]
  const portRevision = provenance.match(/port revision is `([^\x60]+)`/i)?.[1]
  if (!upstreamRevision || !portRevision) throw new Error('Bundled provenance does not identify both revisions.')
  const base = {
    format: 1 as const,
    upstreamRevision,
    portRevision,
    effectEnabled,
    plugins,
    files: Object.fromEntries(
      [...files].sort(([a], [b]) => a.localeCompare(b)).map(([name, data]) => [name, data.toString('base64')]),
    ),
  }
  return `${JSON.stringify({ ...base, digest: snapshotDigest(base) }, null, 2)}\n`
}

function validAssetName(name: string): boolean {
  return (
    name.length > 0 &&
    !isAbsolute(name) &&
    !name.includes('\\') &&
    name.split('/').every((part) => part !== '' && part !== '.' && part !== '..') &&
    name !== 'port-base.snapshot' &&
    !name.startsWith('backups/')
  )
}

async function safeFile(path: string): Promise<FileState> {
  let info: Stats
  try {
    info = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    info.nlink !== 1 ||
    info.size > 2_000_000 ||
    (await realpath(path)) !== path
  ) {
    throw new Error(`The file cannot be updated safely: ${path}`)
  }
  return {
    data: (await readFile(path)).toString('base64'),
    mode: info.mode,
    uid: info.uid,
    gid: info.gid,
    dev: info.dev,
    ino: info.ino,
  }
}

function sameState(a: FileState, b: FileState): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function parsePortSnapshot(state: FileState): PortSnapshot | null {
  if (!state) return null
  try {
    const value = JSON.parse(Buffer.from(state.data, 'base64').toString('utf8')) as PortSnapshot
    if (
      value.format !== 1 ||
      !Value.Check(Type.Boolean(), value.effectEnabled) ||
      !Value.Check(Type.String(), value.upstreamRevision) ||
      !Value.Check(Type.String(), value.portRevision) ||
      !Array.isArray(value.plugins) ||
      value.plugins.some(
        (path) =>
          !Value.Check(Type.String(), path) ||
          !path.startsWith('./tools/biome/anti-slop/rules/') ||
          !validAssetName(path.slice('./tools/biome/anti-slop/rules/'.length)),
      ) ||
      !Value.Check(Type.Object({}), value.files)
    )
      return null
    for (const [name, data] of Object.entries(value.files)) {
      if (
        !validAssetName(name) ||
        !Value.Check(Type.String(), data) ||
        Buffer.from(data, 'base64').toString('base64') !== data
      )
        return null
    }
    const { digest, ...base } = value
    return Value.Check(Type.String(), digest) && digest === snapshotDigest(base) ? value : null
  } catch {
    return null
  }
}

type PluginConfiguration = { plugins?: unknown; extends?: unknown; root?: unknown } | null

type AssetUpdateInput = {
  name: string
  destination: string
  base: PortSnapshot | null
  nextFiles: Map<string, Buffer>
  hasFocusedTest: boolean
  pluginPaths: string[]
  decisions: UpdateDecisions
  config: PluginConfiguration
  enabledPaths: Set<string>
  unresolvedPlugins: boolean
  local: FileState
}

type AssetUpdatePlan = { change?: UpdateChange; activate?: string; pending: string[] }

function planAssetUpdate(input: AssetUpdateInput): AssetUpdatePlan {
  const { name, destination, base, nextFiles, pluginPaths, decisions, config, enabledPaths, unresolvedPlugins, local } =
    input
  const before = base?.files[name]
  const after = nextFiles.get(name)?.toString('base64')
  const current = local?.data
  const candidatePath = `./tools/biome/anti-slop/rules/${name}`
  const configured = enabledPaths.has(join(destination, name))
  const pluginPath =
    pluginPaths.includes(candidatePath) || base?.plugins.includes(candidatePath) || configured
      ? candidatePath
      : undefined
  const pending: string[] = []
  if (!base) {
    if (after === current || decisions.conflicts?.[name] === 'local') return { pending }
    if (
      decisions.conflicts?.[name] === 'incoming' &&
      pluginPaths.includes(candidatePath) &&
      after !== undefined &&
      input.hasFocusedTest
    ) {
      return {
        pending,
        change: { path: join(destination, name), action: local ? 'change' : 'add', before: local, after },
      }
    }
    return { pending: [`Review the unknown-base change: ${name}`] }
  }
  let activate: string | undefined
  if (before === undefined && after !== undefined && pluginPath && !configured) {
    const rule = decisions.rules?.[name]
    if (!rule) pending.push(`Choose whether to enable the new rule: ${name}`)
    else if (rule === 'enable') {
      if (config?.root === false || config?.extends !== undefined || unresolvedPlugins)
        pending.push(`Review inherited or unresolved configuration before enabling: ${name}`)
      else activate = pluginPath
    }
  }
  if (before === after || after === current) return { pending, activate }
  if (before !== undefined && after === undefined && decisions.conflicts?.[name] === 'local')
    return { pending, activate }
  if (
    before !== undefined &&
    after === undefined &&
    pluginPath &&
    (configured || config?.root === false || config?.extends !== undefined || unresolvedPlugins)
  ) {
    pending.push(`Disable or review the removed rule before deleting: ${name}`)
    return { pending, activate }
  }
  if (current !== before) {
    const decision = decisions.conflicts?.[name]
    if (!decision) {
      pending.push(`Choose how to resolve the local conflict: ${name}`)
      return { pending, activate }
    }
    if (decision === 'local') return { pending, activate }
  }
  return {
    pending,
    activate,
    change: {
      path: join(destination, name),
      action: after === undefined ? 'remove' : current === undefined ? 'add' : 'change',
      before: local,
      after: after ?? null,
    },
  }
}

async function inspectPortUpdate(
  root: string,
  incoming: Map<string, Buffer>,
  genericNames: string[],
  effectNames: string[],
  pluginPaths: string[],
  decisions: UpdateDecisions = {},
): Promise<UpdatePreview> {
  const destination = join(root, 'tools/biome/anti-slop/rules')
  const snapshotPath = join(root, 'tools/biome/anti-slop/port-base.snapshot')
  const snapshotBefore = await safeFile(snapshotPath)
  const base = parsePortSnapshot(snapshotBefore)
  const pending: string[] = []
  const issues: string[] = []
  const changes: UpdateChange[] = []
  const observed: Record<string, FileState> = {}
  const comparisons: UpdateComparison[] = []
  const backupDirectory = join(dirname(snapshotPath), 'backups')
  if (!base) pending.push('The installed base is unknown. Unreviewed changes remain pending.')
  const selected = new Set(
    (base?.effectEnabled === false ? genericNames : [...genericNames, ...effectNames]).filter(
      (name) => !name.startsWith('tests/'),
    ),
  )
  for (const [name, decision] of Object.entries(decisions.conflicts ?? {})) {
    if (!validAssetName(name) || (decision !== 'incoming' && decision !== 'local'))
      issues.push(`Invalid conflict decision: ${name}`)
  }
  for (const [name, decision] of Object.entries(decisions.rules ?? {})) {
    if (!base) issues.push(`Rule enablement requires a known base: ${name}`)
    if (
      !pluginPaths.includes(`./tools/biome/anti-slop/rules/${name}`) ||
      (decision !== 'enable' && decision !== 'disabled')
    )
      issues.push(`Invalid rule decision: ${name}`)
  }
  const nextFiles = new Map([...incoming].filter(([name]) => selected.has(name)))
  const nextSnapshot = makePortSnapshot(
    nextFiles,
    base?.effectEnabled ?? false,
    pluginPaths.filter((path) => nextFiles.has(path.slice('./tools/biome/anti-slop/rules/'.length))),
  )
  const incomingSnapshot = JSON.parse(nextSnapshot) as PortSnapshot
  const names = [...new Set([...Object.keys(base?.files ?? {}), ...nextFiles.keys()])].sort()
  const configurationPaths = [join(root, 'biome.json'), join(root, 'biome.jsonc')]
  const configurations = await Promise.all(configurationPaths.map(safeFile))
  const configIndex = configurations.findIndex(Boolean)
  if (configurations.filter(Boolean).length !== 1)
    issues.push('The target must have exactly one safe Biome configuration.')
  const configPath = configurationPaths[configIndex] ?? configurationPaths[0] ?? ''
  const configBefore = configurations[configIndex] ?? null
  const configText = configBefore ? Buffer.from(configBefore.data, 'base64').toString('utf8') : ''
  const parseErrors: Jsonc.ParseError[] = []
  const configTree = Jsonc.parseTree(configText, parseErrors, { allowTrailingComma: true })
  const configKeys = configTree?.children?.map((property) => property.children?.[0]?.value) ?? []
  if (configTree?.type !== 'object' || new Set(configKeys).size !== configKeys.length)
    issues.push('The Biome configuration cannot be reviewed safely.')
  const config = Jsonc.parse(configText, parseErrors, { allowTrailingComma: true }) as {
    plugins?: unknown
    extends?: unknown
    root?: unknown
  } | null
  if (
    parseErrors.length ||
    !Value.Check(Type.Object({}), config) ||
    (config.plugins !== undefined &&
      (!Array.isArray(config.plugins) || config.plugins.some((item) => !Value.Check(Type.String(), item))))
  ) {
    issues.push('The Biome configuration cannot be reviewed safely.')
  }
  const enabled = Array.isArray(config?.plugins) ? (config.plugins as string[]) : []
  const enabledPaths = new Set<string>()
  let unresolvedPlugins = false
  for (const plugin of enabled) {
    const path = resolve(root, plugin)
    enabledPaths.add(path)
    try {
      enabledPaths.add(await realpath(path))
    } catch {
      unresolvedPlugins = true
    }
  }
  const activate: string[] = []
  for (const name of names) {
    if (!validAssetName(name)) {
      issues.push(`Invalid asset path: ${name}`)
      continue
    }
    const before = base?.files[name]
    const after = nextFiles.get(name)?.toString('base64')
    const assetDirectory = name.endsWith('.ts') ? destination : dirname(snapshotPath)
    const local = await safeFile(join(assetDirectory, name))
    observed[name] = local
    const current = local?.data
    if (base ? before !== after || before !== current : current !== after) {
      comparisons.push({ name, base: before ?? null, local: current ?? null, incoming: after ?? null })
    }
    const plan = planAssetUpdate({
      name,
      destination: assetDirectory,
      base,
      nextFiles,
      hasFocusedTest: incoming.has(`tests/${name.replace(/\.ts$/, '.test.ts')}`),
      pluginPaths,
      decisions,
      config,
      enabledPaths,
      unresolvedPlugins,
      local,
    })
    pending.push(...plan.pending)
    if (plan.activate) activate.push(plan.activate)
    if (plan.change) changes.push(plan.change)
  }
  const safeActivation = activate.filter(
    (path) => !pending.some((entry) => entry.includes(path.slice('./tools/biome/anti-slop/rules/'.length))),
  )
  if (safeActivation.length && configBefore) {
    const after = appendBiomePlugins(configText, safeActivation)
    if (after !== configText)
      changes.push({
        path: configPath,
        action: 'change',
        before: configBefore,
        after: Buffer.from(after).toString('base64'),
      })
  }
  const snapshotAfter =
    base && pending.length === 0 && issues.length === 0 ? Buffer.from(nextSnapshot).toString('base64') : null
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        root,
        snapshotPath,
        snapshotBefore,
        nextSnapshot,
        decisions,
        configurations,
        observed,
        changes,
        pending,
        issues,
      }),
    )
    .digest('hex')
  return {
    root,
    baseAvailable: !!base,
    baseRevision: base?.portRevision ?? null,
    incomingRevision: incomingSnapshot.portRevision,
    effectEnabled: base?.effectEnabled ?? null,
    changes,
    comparisons,
    pending,
    issues,
    backupDirectory,
    snapshotBefore,
    snapshotAfter,
    hash: digest,
  }
}

type ReadableContent = string | { base64: string } | null

type UpdateSummary = Omit<UpdatePreview, 'changes' | 'comparisons' | 'snapshotBefore' | 'snapshotAfter'> & {
  comparisons: { name: string; base: ReadableContent; local: ReadableContent; incoming: ReadableContent }[]
  changes: {
    path: string
    action: UpdateChange['action']
    before: string | { base64: string } | null
    after: string | { base64: string } | null
  }[]
}

async function inspectTypeofConfiguration(
  root: string,
  incoming: Map<string, Buffer>,
  allow: boolean,
): Promise<UpdatePreview> {
  const destination = join(root, 'tools/biome/anti-slop/rules')
  const path = join(destination, 'no-runtime-typeof.ts')
  const snapshotPath = join(root, 'tools/biome/anti-slop/port-base.snapshot')
  const snapshotBefore = await safeFile(snapshotPath)
  const base = parsePortSnapshot(snapshotBefore)
  const local = await safeFile(path)
  const issues: string[] = []
  const changes: UpdateChange[] = []
  const dependencies: Record<string, FileState> = {}
  for (const name of incoming.keys()) {
    if (!validAssetName(name)) issues.push(`Invalid asset path: ${name}`)
    else dependencies[name] = await safeFile(join(name.endsWith('.ts') ? destination : dirname(snapshotPath), name))
  }
  const configurations = await Promise.all([safeFile(join(root, 'biome.json')), safeFile(join(root, 'biome.jsonc'))])
  const templateBytes = base?.files['no-runtime-typeof.ts']
    ? Buffer.from(base.files['no-runtime-typeof.ts'], 'base64')
    : incoming.get('no-runtime-typeof.ts')
  const template = templateBytes?.toString('utf8') ?? ''
  const matches = [...template.matchAll(/^const allowInTypeGuards = (true|false);?$/gm)]
  if (matches.length !== 1 || !local || !templateBytes || !Buffer.from(template).equals(templateBytes)) {
    issues.push('The type-guard option cannot be identified safely.')
  } else {
    const sourceBytes = Buffer.from(local.data, 'base64')
    const source = sourceBytes.toString('utf8')
    const marker = matches[0]
    const prefix = `${template.slice(0, marker?.index ?? 0)}const allowInTypeGuards = `
    const value = source.slice(prefix.length).match(/^(true|false);?(?=\r?\n|$)/)?.[1]
    if (!Buffer.from(source).equals(sourceBytes) || !source.startsWith(prefix) || !value) {
      issues.push('The type-guard option or its preceding code was customized. Review it manually.')
    } else if ((value === 'true') !== allow) {
      const after = source.slice(0, prefix.length) + String(allow) + source.slice(prefix.length + value.length)
      changes.push({ path, action: 'change', before: local, after: Buffer.from(after).toString('base64') })
    }
  }
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        root,
        snapshotPath,
        snapshotBefore,
        local,
        dependencies,
        configurations,
        template: templateBytes?.toString('base64'),
        allow,
        changes,
        issues,
      }),
    )
    .digest('hex')
  return {
    root,
    baseAvailable: !!base,
    baseRevision: base?.portRevision ?? null,
    incomingRevision: base?.portRevision ?? 'unknown',
    effectEnabled: base?.effectEnabled ?? null,
    changes,
    comparisons: changes.map((change) => ({
      name: 'no-runtime-typeof.ts',
      base: base?.files['no-runtime-typeof.ts'] ?? null,
      local: local?.data ?? null,
      incoming: change.after,
    })),
    pending: [],
    issues,
    backupDirectory: join(dirname(snapshotPath), 'backups'),
    snapshotBefore,
    snapshotAfter: null,
    hash,
  }
}

function summarizePortUpdate(preview: UpdatePreview): UpdateSummary {
  function readable(data: string | null): string | { base64: string } | null {
    if (data === null) return null
    const bytes = Buffer.from(data, 'base64')
    const text = bytes.toString('utf8')
    return Buffer.from(text).equals(bytes) ? text : { base64: data }
  }
  return {
    root: preview.root,
    baseAvailable: preview.baseAvailable,
    baseRevision: preview.baseRevision,
    incomingRevision: preview.incomingRevision,
    effectEnabled: preview.effectEnabled,
    changes: preview.changes.map((change) => ({
      path: change.path,
      action: change.action,
      before: readable(change.before?.data ?? null),
      after: readable(change.after),
    })),
    comparisons: preview.comparisons.map((item) => ({
      name: item.name,
      base: readable(item.base),
      local: readable(item.local),
      incoming: readable(item.incoming),
    })),
    pending: preview.pending,
    issues: preview.issues,
    backupDirectory: preview.backupDirectory,
    hash: preview.hash,
  }
}

async function ensureUpdateParent(root: string, parent: string, completed: string[]): Promise<void> {
  const relativePath = relative(root, parent)
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath))
    throw new Error('The update path is outside the target.')
  let current = root
  for (const part of relativePath.split(sep).filter(Boolean)) {
    current = join(current, part)
    try {
      await mkdir(current)
      completed.push(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const info = await lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(current)) !== current)
      throw new Error(`The parent directory is unsafe: ${current}`)
  }
}

type FocusedUpdateCheck = {
  rule: string
  status: 'passed' | 'failed' | 'unavailable'
  command: string[]
  output: string
}

async function checkUnknownBaseChanges(
  preview: UpdatePreview,
  incoming: Map<string, Buffer>,
  biomeBinary: string,
  biomeVersion: string,
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<FocusedUpdateCheck[]> {
  const checks: FocusedUpdateCheck[] = []
  if (preview.changes.length === 0) return checks
  if (biomeVersion !== '2.6.4' || !biomeBinary)
    return [
      {
        rule: 'all',
        status: 'unavailable',
        command: [],
        output: 'Biome 2.6.4 is required for focused tests.',
      },
    ]
  const destination = join(preview.root, 'tools/biome/anti-slop/rules')
  const cwd = dirname(dirname(dirname(biomeBinary)))
  for (const change of preview.changes) {
    signal?.throwIfAborted()
    const name = relative(destination, change.path)
    const testName = `tests/${name.replace(/\.ts$/, '.test.ts')}`
    const upstreamTest = incoming.get(testName)
    const command: string[] = []
    let temp = ''
    try {
      if (!validAssetName(name) || !upstreamTest || change.after === null)
        throw new Error('The focused rule test is unavailable.')
      temp = await mkdtemp(join(tmpdir(), 'biome-anti-slop-update-test-'))
      for (const assetName of incoming.keys()) {
        if (!validAssetName(assetName)) throw new Error(`Invalid asset path: ${assetName}`)
        const state = await safeFile(join(destination, assetName))
        const data = state
          ? Buffer.from(state.data, 'base64')
          : assetName === 'tests/run-biome-cases.ts'
            ? incoming.get(assetName)
            : undefined
        if (!data) continue
        const path = join(temp, assetName)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, data, { flag: 'wx' })
      }
      const stagedRule = join(temp, name)
      await mkdir(dirname(stagedRule), { recursive: true })
      await writeFile(stagedRule, Buffer.from(change.after, 'base64'))
      const stagedTest = join(temp, testName)
      const localTest = await safeFile(join(destination, testName))
      if (!localTest) {
        await mkdir(dirname(stagedTest), { recursive: true })
        await writeFile(stagedTest, upstreamTest, { flag: 'wx' })
      }
      const testPaths = [stagedTest]
      if (localTest && localTest.data !== upstreamTest.toString('base64')) {
        const incomingTest = join(dirname(stagedTest), `incoming-${name.replace(/\.ts$/, '.test.ts')}`)
        await writeFile(incomingTest, upstreamTest, { flag: 'wx' })
        testPaths.push(incomingTest)
      }
      command.push('env', '-u', 'ANTI_SLOP_BIOME', '-u', 'ANTI_SLOP_INSTALLED_ROOT', 'bun', 'test', ...testPaths)
      const result = await pi.exec('env', command.slice(1), { cwd, signal, timeout: 120000 })
      checks.push({
        rule: name,
        status: result.code === 0 && !result.killed ? 'passed' : 'failed',
        command,
        output: result.stdout + result.stderr,
      })
    } catch (error) {
      checks.push({ rule: name, status: 'unavailable', command, output: String(error) })
    } finally {
      if (temp) await rm(temp, { recursive: true, force: true })
    }
  }
  return checks
}

async function applyPortUpdate(preview: UpdatePreview, focusedPassed: boolean, signal?: AbortSignal): Promise<string> {
  const destination = join(preview.root, 'tools/biome/anti-slop')
  const backupRoot = preview.backupDirectory
  if (preview.issues.length || (!preview.baseAvailable && !focusedPassed))
    throw new Error('The update preview is blocked.')
  const backup = join(backupRoot, randomUUID())
  const changes = [...preview.changes]
  if (preview.snapshotAfter && preview.snapshotAfter !== preview.snapshotBefore?.data)
    changes.push({
      path: join(preview.root, 'tools/biome/anti-slop/port-base.snapshot'),
      action: 'change',
      before: preview.snapshotBefore,
      after: preview.snapshotAfter,
    })
  const completed: string[] = []
  try {
    signal?.throwIfAborted()
    const destinationInfo = await lstat(destination)
    if (
      !destinationInfo.isDirectory() ||
      destinationInfo.isSymbolicLink() ||
      (await realpath(destination)) !== destination
    )
      throw new Error('The asset directory is unsafe.')
    await ensureUpdateParent(preview.root, dirname(backupRoot), completed)
    try {
      await mkdir(backupRoot)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const directory = await lstat(backupRoot)
    if (!directory.isDirectory() || directory.isSymbolicLink() || (await realpath(backupRoot)) !== backupRoot)
      throw new Error('The backup directory is unsafe.')
    await mkdir(backup)
    for (const [index, change] of changes.entries()) {
      if (change.before)
        await writeFile(join(backup, `${index}.before`), Buffer.from(change.before.data, 'base64'), {
          flag: 'wx',
          mode: 0o600,
        })
      if (change.after !== null)
        await writeFile(join(backup, `${index}.after`), Buffer.from(change.after, 'base64'), {
          flag: 'wx',
          mode: 0o600,
        })
    }
    if (preview.snapshotBefore)
      await writeFile(join(backup, 'previous-base.backup'), Buffer.from(preview.snapshotBefore.data, 'base64'), {
        flag: 'wx',
        mode: 0o600,
      })
    await writeFile(
      join(backup, 'manifest.backup'),
      JSON.stringify(
        {
          previewHash: preview.hash,
          baseAvailable: preview.baseAvailable,
          baseRevision: preview.baseRevision,
          incomingRevision: preview.incomingRevision,
          pending: preview.pending,
          changes,
          verification: 'not-run',
        },
        null,
        2,
      ),
      { flag: 'wx', mode: 0o600 },
    )
    for (const [index, change] of changes.entries()) {
      signal?.throwIfAborted()
      await withFileMutationQueue(change.path, async () => {
        if (!sameState(await safeFile(change.path), change.before))
          throw new Error(`The file changed after approval: ${change.path}`)
        const parent = dirname(change.path)
        await ensureUpdateParent(preview.root, parent, completed)
        const info = await lstat(parent)
        if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(parent)) !== parent)
          throw new Error(`The parent directory is unsafe: ${parent}`)
        if (change.after === null) {
          await unlink(change.path)
        } else {
          const temporary = join(parent, `.biome-anti-slop-${randomUUID()}.tmp`)
          try {
            const mode = change.before ? change.before.mode & 0o7777 : 0o644
            await writeFile(temporary, await readFile(join(backup, `${index}.after`)), { flag: 'wx', mode })
            await chmod(temporary, mode)
            const prepared = await lstat(temporary)
            if (change.before && (prepared.uid !== change.before.uid || prepared.gid !== change.before.gid))
              await chown(temporary, change.before.uid, change.before.gid)
            if (!sameState(await safeFile(change.path), change.before))
              throw new Error(`The file changed while preparing the update: ${change.path}`)
            if (change.before) await rename(temporary, change.path)
            else await link(temporary, change.path)
          } finally {
            await rm(temporary, { force: true })
          }
        }
      })
      completed.push(change.path)
    }
    return backup
  } catch (error) {
    throw new Error(
      `Biome anti-slop update failed. Backup: ${backup}. Changed paths: ${completed.join(', ') || 'none'}. ${String(error)}`,
    )
  }
}

export {
  applyPortUpdate,
  checkUnknownBaseChanges,
  inspectPortUpdate,
  inspectTypeofConfiguration,
  makePortSnapshot,
  summarizePortUpdate,
  type UpdateDecisions,
  type UpdatePreview,
}
