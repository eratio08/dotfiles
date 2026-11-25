import { createHash, randomUUID } from 'node:crypto'
import type { Stats } from 'node:fs'
import {
  chmod,
  chown,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { withFileMutationQueue } from '@earendil-works/pi-coding-agent'
import * as Jsonc from 'jsonc-parser'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { antiSlopEntrypointPath, formatAntiSlopEntrypoint, parseAntiSlopEntrypoint } from './anti-slop-entrypoint.ts'
import { inspectBiomePluginReferences, removeAntiSlopRegistration } from './biome-config.ts'

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
  conflicts?: Record<string, 'incoming'>
  rules?: Record<string, 'enable'>
}

type FileState = { data: string; mode: number; uid: number; gid: number; dev: number; ino: number } | null

type UpdateChange = { path: string; action: 'add' | 'change' | 'remove'; before: FileState; after: string | null }

type UpdateComparison = { name: string; base: string | null; local: string | null; incoming: string | null }

type UpdatePreview = {
  root: string
  effectEnabled: boolean | null
  changes: UpdateChange[]
  comparisons: UpdateComparison[]
  pending: string[]
  issues: string[]
  snapshotBefore: FileState
  snapshotAfter: string | null
  hash: string
}

function snapshotDigest(snapshot: Omit<PortSnapshot, 'digest'>): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

function createPortSnapshot(files: Map<string, Buffer>, effectEnabled: boolean, plugins: string[]): string {
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
  base: PortSnapshot
  nextFiles: Map<string, Buffer>
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
  const before = base.files[name]
  const after = nextFiles.get(name)?.toString('base64')
  const current = local?.data
  const candidatePath = `./tools/biome/anti-slop/rules/${name}`
  const configured = enabledPaths.has(join(destination, name))
  const pluginPath =
    pluginPaths.includes(candidatePath) || base.plugins.includes(candidatePath) || configured
      ? candidatePath
      : undefined
  const pending: string[] = []
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
  decisions: UpdateDecisions,
  configurationPath: string,
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
  if (!base) throw new Error('The installed anti-slop ownership is unknown. No files changed.')
  const selected = new Set(base.effectEnabled ? [...genericNames, ...effectNames] : genericNames)
  for (const [name, decision] of Object.entries(decisions.conflicts ?? {})) {
    if (!validAssetName(name) || decision !== 'incoming') issues.push(`Invalid conflict decision: ${name}`)
  }
  for (const [name, decision] of Object.entries(decisions.rules ?? {})) {
    if (!pluginPaths.includes(`./tools/biome/anti-slop/rules/${name}`) || decision !== 'enable')
      issues.push(`Invalid rule decision: ${name}`)
  }
  const nextFiles = new Map([...incoming].filter(([name]) => selected.has(name)))
  const nextSnapshot = createPortSnapshot(
    nextFiles,
    base.effectEnabled,
    pluginPaths.filter((path) => nextFiles.has(path.slice('./tools/biome/anti-slop/rules/'.length))),
  )
  const names = [...new Set([...Object.keys(base.files), ...nextFiles.keys()])].sort()
  const configurations = [await safeFile(configurationPath)]
  const configIndex = configurations.findIndex(Boolean)
  if (configurations.filter(Boolean).length !== 1)
    issues.push('The target must have exactly one safe Biome configuration.')

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
  if (parseErrors.length || !Value.Check(Type.Object({}), config)) {
    issues.push('The Biome configuration cannot be reviewed safely.')
  }
  const references = inspectBiomePluginReferences(configText)
  const enabled = [...references.plugins, ...references.overrides]
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
  const entrypoint = await safeFile(join(root, antiSlopEntrypointPath))
  if (!entrypoint || !enabledPaths.has(join(root, antiSlopEntrypointPath))) {
    issues.push('The anti-slop entry point is not configured. Manual review is required.')
  } else {
    try {
      for (const name of parseAntiSlopEntrypoint(Buffer.from(entrypoint.data, 'base64').toString('utf8'))) {
        enabledPaths.add(join(destination, name))
      }
    } catch (error) {
      issues.push(String(error))
    }
  }
  const activate: string[] = []
  for (const name of names) {
    if (!validAssetName(name)) {
      issues.push(`Invalid asset path: ${name}`)
      continue
    }
    const before = base.files[name]
    const after = nextFiles.get(name)?.toString('base64')
    const assetDirectory = name.endsWith('.ts') ? destination : dirname(snapshotPath)
    const local = await safeFile(join(assetDirectory, name))
    observed[name] = local
    const current = local?.data
    if (before !== after || before !== current) {
      comparisons.push({ name, base: before ?? null, local: current ?? null, incoming: after ?? null })
    }
    const plan = planAssetUpdate({
      name,
      destination: assetDirectory,
      base,
      nextFiles,
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
  if (safeActivation.length && entrypoint && issues.length === 0) {
    const source = Buffer.from(entrypoint.data, 'base64').toString('utf8')
    const after = `${source}${source.endsWith('\n') ? '' : '\n'}${formatAntiSlopEntrypoint(safeActivation)}`
    changes.push({
      path: join(root, antiSlopEntrypointPath),
      action: 'change',
      before: entrypoint,
      after: Buffer.from(after).toString('base64'),
    })
  }
  const snapshotAfter =
    pending.length === 0 && issues.length === 0 ? Buffer.from(nextSnapshot).toString('base64') : null
  const digest = createHash('sha256')
    .update(
      JSON.stringify({
        root,
        snapshotPath,
        snapshotBefore,
        nextSnapshot,
        decisions,
        configurationPath,
        configurations,
        entrypoint,
        observed,
        changes,
        pending,
        issues,
      }),
    )
    .digest('hex')
  return {
    root,
    effectEnabled: base.effectEnabled,
    changes,
    comparisons,
    pending,
    issues,
    snapshotBefore,
    snapshotAfter,
    hash: digest,
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

type RemovalPreview = {
  root: string
  changes: UpdateChange[]
  retained: string[]
  hash: string
}

async function pluginUsesAntiSlop(root: string, destination: string, plugin: string): Promise<boolean> {
  let candidate: string
  if (isAbsolute(plugin) || plugin.startsWith('./') || plugin.startsWith('../')) {
    candidate = resolve(root, plugin)
  } else {
    try {
      candidate = createRequire(join(root, 'package.json')).resolve(plugin)
      if (!isAbsolute(candidate)) throw new Error('The plugin does not resolve to a file.')
    } catch {
      throw new Error(`The plugin path requires manual review: ${plugin}`)
    }
  }
  let actual = candidate
  try {
    actual = await realpath(candidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const within = relative(destination, actual)
  return within === '' || (within !== '..' && !within.startsWith(`..${sep}`) && !isAbsolute(within))
}

async function inspectCommandRemoval(root: string, configurationPath: string): Promise<RemovalPreview> {
  const destination = join(root, 'tools/biome/anti-slop')
  const snapshotPath = join(destination, 'port-base.snapshot')
  const snapshot = await safeFile(snapshotPath)
  const base = parsePortSnapshot(snapshot)
  if (!base || !snapshot) throw new Error('The installed anti-slop ownership is unknown. No files changed.')
  const config = await safeFile(configurationPath)
  if (!config) throw new Error('The selected Biome configuration does not exist.')
  const configBytes = Buffer.from(config.data, 'base64')
  const configText = configBytes.toString('utf8')
  if (!Buffer.from(configText).equals(configBytes)) throw new Error('The Biome configuration is not valid UTF-8.')
  const references = inspectBiomePluginReferences(configText)
  if (references.inherited) throw new Error('The inherited Biome configuration requires manual review.')
  if (references.plugins.filter((path) => path === antiSlopEntrypointPath).length !== 1)
    throw new Error('The anti-slop registration cannot be identified safely.')
  const after = removeAntiSlopRegistration(configText, antiSlopEntrypointPath)
  for (const plugin of [
    ...references.plugins.filter((path) => path !== antiSlopEntrypointPath),
    ...references.overrides,
  ]) {
    if (await pluginUsesAntiSlop(root, destination, plugin))
      throw new Error(`Another plugin refers to the anti-slop directory: ${plugin}`)
  }
  const siblingPath = join(root, basename(configurationPath) === 'biome.json' ? 'biome.jsonc' : 'biome.json')
  const sibling = await safeFile(siblingPath)
  if (sibling) {
    const bytes = Buffer.from(sibling.data, 'base64')
    const source = bytes.toString('utf8')
    if (!Buffer.from(source).equals(bytes)) throw new Error('Another Biome configuration cannot be reviewed safely.')
    const other = inspectBiomePluginReferences(source)
    if (other.inherited) throw new Error('Another Biome configuration requires manual review.')
    for (const plugin of [...other.plugins, ...other.overrides]) {
      if (await pluginUsesAntiSlop(root, destination, plugin))
        throw new Error(`Another Biome configuration refers to the anti-slop directory: ${siblingPath}`)
    }
  }
  const expected = new Map<string, string>()
  for (const [name, content] of Object.entries(base.files)) {
    const path = join(destination, name.endsWith('.ts') ? 'rules' : '', name)
    if (path === join(root, antiSlopEntrypointPath) || path === snapshotPath || expected.has(path))
      throw new Error('The installed anti-slop ownership is ambiguous.')
    expected.set(path, content)
  }
  expected.set(
    join(root, antiSlopEntrypointPath),
    Buffer.from(formatAntiSlopEntrypoint(base.plugins)).toString('base64'),
  )
  expected.set(snapshotPath, snapshot.data)
  const observed: Record<string, FileState | number[]> = {}
  const queue = [destination]
  let count = 0
  while (queue.length) {
    const directory = queue.shift()
    if (!directory) break
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(directory)) !== directory)
      throw new Error(`The anti-slop directory is unsafe: ${directory}`)
    observed[directory] = [info.dev, info.ino, info.mode, info.uid, info.gid]
    for (const entry of (await readdir(directory)).sort()) {
      if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(entry))
        throw new Error('The anti-slop directory contains an unsafe filename.')
      if (++count > 2000) throw new Error('The anti-slop directory is too large to inspect safely.')
      const path = join(directory, entry)
      const stat = await lstat(path)
      if (stat.isDirectory() && !stat.isSymbolicLink()) queue.push(path)
      else observed[path] = await safeFile(path)
    }
  }
  const changes: UpdateChange[] = [
    {
      path: configurationPath,
      action: 'change',
      before: config,
      after: Buffer.from(after).toString('base64'),
    },
  ]
  const retained: string[] = []
  for (const [path, state] of Object.entries(observed)) {
    if (Array.isArray(state)) continue
    if (!state) throw new Error(`The anti-slop file changed during inspection: ${path}`)
    if (expected.get(path) === state.data) changes.push({ path, action: 'remove', before: state, after: null })
    else retained.push(relative(destination, path))
  }
  changes.sort((a, b) => Number(a.path === snapshotPath) - Number(b.path === snapshotPath))
  const hash = createHash('sha256')
    .update(JSON.stringify({ root, configurationPath, config, siblingPath, sibling, observed, changes, retained }))
    .digest('hex')
  return { root, changes, retained, hash }
}

async function applyCommandRemoval(preview: RemovalPreview): Promise<void> {
  await applyApprovedChanges(preview.root, preview.changes, false)
}

async function applyCommandUpdate(preview: UpdatePreview): Promise<void> {
  if (preview.issues.length || preview.pending.length || !preview.snapshotAfter)
    throw new Error('The update preview is blocked.')
  const changes = [...preview.changes]
  if (preview.snapshotAfter !== preview.snapshotBefore?.data) {
    changes.push({
      path: join(preview.root, 'tools/biome/anti-slop/port-base.snapshot'),
      action: 'change',
      before: preview.snapshotBefore,
      after: preview.snapshotAfter,
    })
  }
  await applyApprovedChanges(preview.root, changes, true)
}

async function applyApprovedChanges(root: string, changes: UpdateChange[], createParents: boolean): Promise<void> {
  const completed: string[] = []
  try {
    for (const change of changes) {
      await withFileMutationQueue(change.path, async () => {
        if (!sameState(await safeFile(change.path), change.before))
          throw new Error(`The file changed after approval: ${change.path}`)
        const parent = dirname(change.path)
        if (createParents) await ensureUpdateParent(root, parent, completed)
        const info = await lstat(parent)
        if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(parent)) !== parent)
          throw new Error(`The parent directory is unsafe: ${parent}`)
        if (change.after === null) {
          await unlink(change.path)
          return
        }
        const temporary = join(parent, `.biome-anti-slop-${randomUUID()}.tmp`)
        try {
          const mode = change.before ? change.before.mode & 0o7777 : 0o644
          await writeFile(temporary, Buffer.from(change.after, 'base64'), { flag: 'wx', mode })
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
      })
      completed.push(change.path)
    }
  } catch (error) {
    throw new Error(`Biome anti-slop change failed. Changed paths: ${completed.join(', ') || 'none'}. ${String(error)}`)
  }
}

export {
  applyCommandRemoval,
  applyCommandUpdate,
  createPortSnapshot,
  inspectCommandRemoval,
  inspectPortUpdate,
  type UpdatePreview,
}
