import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  chmod,
  chown,
  glob,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type ExtensionAPI, type ExtensionContext, withFileMutationQueue } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { parseDocument } from 'yaml'
import { antiSlopEntrypointPath, formatAntiSlopEntrypoint } from './anti-slop-entrypoint.ts'
import { editBiomeConfiguration } from './biome-config.ts'
import {
  applyCommandRemoval,
  applyCommandUpdate,
  inspectCommandRemoval,
  inspectPortUpdate,
  makePortSnapshot,
  type UpdatePreview,
} from './update.ts'

const bundledDirectory = fileURLToPath(new URL('../assets/anti-slop/', import.meta.url))
const pluginPaths = [
  './tools/biome/anti-slop/rules/no-reflect-apply.ts',
  './tools/biome/anti-slop/rules/no-runtime-typeof.ts',
  './tools/biome/anti-slop/rules/no-array-filter-map.ts',
  './tools/biome/anti-slop/rules/no-reduce-accumulator-copy.ts',
  './tools/biome/anti-slop/rules/no-accumulating-spread.ts',
  './tools/biome/anti-slop/rules/no-widen-then-assert.ts',
  './tools/biome/anti-slop/rules/no-known-value-widening.ts',
  './tools/biome/anti-slop/rules/no-unsafe-dictionary-type.ts',
  './tools/biome/anti-slop/rules/no-object-parameters.ts',
  './tools/biome/anti-slop/rules/no-unknown-parameters.ts',
  './tools/biome/anti-slop/rules/no-unknown-returns.ts',
  './tools/biome/anti-slop/rules/no-unknown-type-aliases.ts',
  './tools/biome/anti-slop/rules/no-shape-in-symbol-names.ts',
  './tools/biome/anti-slop/rules/no-reflect-get.ts',
  './tools/biome/anti-slop/rules/no-module-mocking.ts',
  './tools/biome/anti-slop/rules/no-chained-type-assertions.ts',
  './tools/biome/anti-slop/rules/no-conditional-empty-object-spread.ts',
]
const effectPluginPaths = [
  './tools/biome/anti-slop/rules/no-service-constructor-imports.ts',
  './tools/biome/anti-slop/rules/no-manual-effect-error-tag.ts',
  './tools/biome/anti-slop/rules/no-manual-tag-comparison.ts',
  './tools/biome/anti-slop/rules/no-manual-tagged-construction.ts',
  './tools/biome/anti-slop/rules/prefer-effect-match.ts',
]
const effectBundledFiles = [
  'no-service-constructor-imports.ts',
  'tagged-values.ts',
  'no-manual-effect-error-tag.ts',
  'no-manual-tag-comparison.ts',
  'no-manual-tagged-construction.ts',
  'prefer-effect-match.ts',
]
const bundledFiles = [
  'LICENSE',
  'OXC-LICENSE',
  'UPSTREAM.md',
  'shared.ts',
  'array-method.ts',
  'reducer.ts',
  'no-reduce-accumulator-copy.ts',
  'no-accumulating-spread.ts',
  'no-widen-then-assert.ts',
  'no-known-value-widening.ts',
  'no-unsafe-dictionary-type.ts',
  'parameter-contract.ts',
  'no-reflect-get.ts',
  'no-module-mocking.ts',
  'no-chained-type-assertions.ts',
  'no-conditional-empty-object-spread.ts',
  'no-object-parameters.ts',
  'no-unknown-parameters.ts',
  'no-unknown-returns.ts',
  'no-unknown-type-aliases.ts',
  'no-shape-in-symbol-names.ts',
  'widening-types.ts',
  'no-array-filter-map.ts',
  'no-reflect-apply.ts',
  'no-runtime-typeof.ts',
]
const missingRules = ['require-readable-spacing', 'require-safety-comment-for-type-assertion']

type InstallPreview = {
  root: string
  proposedFiles: string[]
  missingRules: string[]
  gaps: string[]
  issues: string[]
  gitStatus: string
  packageManager: string | null
  biomeVersion: string | null
  effectEnabled: boolean
  assetNames: string[]
  repositoryFiles: { path: string; content: string }[]
  bundleHash: string
  configurationPath: string
  configurationBefore: string | null
  configurationAfter: string
  configurationMetadata: number[] | null
  resolvedConfiguration: string
  resolvedConfigurationScope: 'workspace-root' | 'target'
  hash: string
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function readBundledAntiSlop(assetNames: string[]): Promise<{ files: Map<string, Buffer>; hash: string }> {
  const files = new Map<string, Buffer>()
  const digest = createHash('sha256')

  for (const name of assetNames) {
    const path = join(bundledDirectory, name)
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Invalid bundled anti-slop file: ${name}`)
    const content = await readFile(path)
    files.set(name, content)
    digest.update(name).update(content)
  }

  return { files, hash: digest.digest('hex') }
}

type RepositoryInspection = {
  directories: string[]
  gitStatus: string
  repositoryFiles: { path: string; content: string }[]
  issues: string[]
}

type ConfigurationInspection = {
  configurationPath: string
  configurationBefore: string | null
  configurationAfter: string
  configurationMetadata: number[] | null
  nestedConfiguration: boolean
  resolvedConfiguration: string
  version: string
  biomeBinary: string
  issues: string[]
}

async function inspectRepository(
  target: string,
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<RepositoryInspection> {
  const issues: string[] = []
  const git = await pi.exec('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: target, signal })
  if (git.code !== 0) issues.push('The target is not a readable Git repository.')
  if (git.stdout.length > 12000) issues.push('Git status is too large to inspect safely.')

  const gitRoot = await pi.exec('git', ['rev-parse', '--show-toplevel'], { cwd: target, signal })
  const repositoryRoot = gitRoot.code === 0 ? await realpath(gitRoot.stdout.trim()) : target
  const directories: string[] = []
  let directory = target
  while (true) {
    directories.push(directory)
    if (directory === repositoryRoot || dirname(directory) === directory) break
    directory = dirname(directory)
  }

  const destinationDirectories: string[] = []
  for (const path of [join(target, 'tools'), join(target, 'tools/biome')]) {
    if (!(await pathExists(path))) break
    const info = await lstat(path)
    if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(path)) !== path) {
      issues.push(`The destination has an unsafe parent: ${path}`)
      break
    }
    destinationDirectories.push(path)
  }

  const repositoryFiles: { path: string; content: string }[] = []
  for (const path of [
    ...directories.flatMap((dir) =>
      ['AGENTS.md', 'CLAUDE.md', 'package.json', 'pnpm-workspace.yaml'].map((name) => join(dir, name)),
    ),
    ...destinationDirectories.flatMap((dir) => ['AGENTS.md', 'CLAUDE.md'].map((name) => join(dir, name))),
  ]) {
    if (!(await pathExists(path))) continue
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 12000) {
      issues.push(`The repository file cannot be inspected safely: ${path}`)
      continue
    }
    repositoryFiles.push({ path, content: await readFile(path, 'utf8') })
  }
  if (await pathExists(join(target, 'tools/biome/anti-slop'))) issues.push('The destination already exists.')

  return { directories, gitStatus: git.stdout, repositoryFiles, issues }
}

async function inspectBiomeConfiguration(
  target: string,
  directories: string[],
  pi: ExtensionAPI,
  signal?: AbortSignal,
  selectedPluginPaths = [antiSlopEntrypointPath],
  selectedConfiguration?: string,
): Promise<ConfigurationInspection> {
  const issues: string[] = []
  const json = join(target, 'biome.json')
  const jsonc = join(target, 'biome.jsonc')
  const hasJson = await pathExists(json)
  const hasJsonc = await pathExists(jsonc)
  if (!selectedConfiguration && hasJson && hasJsonc) issues.push('Both Biome configuration files exist. Use --config.')
  const configurationPath = selectedConfiguration ?? (hasJsonc ? jsonc : json)
  let configurationBefore: string | null = null
  let configurationAfter = ''
  let resolvedConfiguration = ''
  let nestedConfiguration = false
  let configurationMetadata: number[] | null = null

  if (await pathExists(configurationPath)) {
    const info = await lstat(configurationPath)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
      issues.push('The Biome configuration is not a regular unlinked file.')
    } else if (info.size > 12000) {
      issues.push('The Biome configuration is too large to inspect safely.')
    } else {
      configurationMetadata = [info.dev, info.ino, info.mode, info.uid, info.gid]
      const bytes = await readFile(configurationPath)
      configurationBefore = bytes.toString('utf8')
      if (!Buffer.from(configurationBefore).equals(bytes)) issues.push('The Biome configuration is not valid UTF-8.')
      try {
        const edit = editBiomeConfiguration(configurationBefore, selectedPluginPaths)
        configurationAfter = edit.after
        nestedConfiguration = edit.nested
      } catch (error) {
        issues.push(String(error))
      }
    }
  } else {
    let current = dirname(target)
    while (true) {
      for (const name of ['biome.json', 'biome.jsonc']) {
        if (await pathExists(join(current, name)))
          issues.push(`Inherited configuration requires review: ${join(current, name)}`)
      }
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
    configurationAfter = `${JSON.stringify(
      {
        root: true,
        plugins: selectedPluginPaths,
        files: { includes: ['**', '!**/tools/biome/anti-slop'] },
      },
      null,
      2,
    )}\n`
  }

  let version = ''
  let biomeBinary = ''
  for (const dir of directories) {
    const manifestPath = join(dir, 'node_modules/@biomejs/biome/package.json')
    if (!(await pathExists(manifestPath))) continue
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version?: string }
      version = manifest.version ?? ''
      biomeBinary = join(dir, 'node_modules/.bin/biome')
    } catch {
      issues.push(`Unable to read the Biome manifest: ${manifestPath}`)
    }
    break
  }
  if (!version) issues.push('Biome 2.6.4 is not installed in the target or workspace.')
  if (version && version !== '2.6.4') issues.push(`Biome 2.6.4 is required; found ${version}.`)
  if (version === '2.6.4') {
    try {
      await access(biomeBinary, constants.X_OK)
    } catch {
      issues.push('The target Biome executable is unavailable.')
    }
  }
  if (configurationBefore !== null && version === '2.6.4') {
    try {
      const args = ['inspect', 'config', '--colors=off']
      if (!nestedConfiguration) args.push('--config-path', configurationPath)
      const inspected = await pi.exec(biomeBinary, args, { cwd: target, signal })
      if (inspected.code !== 0) issues.push('Biome could not resolve the existing configuration.')
      resolvedConfiguration = inspected.stdout + inspected.stderr
      if (
        [antiSlopEntrypointPath, ...pluginPaths, ...effectPluginPaths].some((path) =>
          resolvedConfiguration.includes(path.slice(2)),
        )
      ) {
        issues.push('The effective Biome configuration already includes an anti-slop plugin.')
      }
      if (resolvedConfiguration.length > 12000)
        issues.push('The resolved Biome configuration is too large to inspect safely.')
    } catch {
      issues.push('The target Biome executable is unavailable.')
    }
  }

  return {
    configurationPath,
    configurationBefore,
    configurationAfter,
    configurationMetadata,
    nestedConfiguration,
    resolvedConfiguration,
    version,
    biomeBinary,
    issues,
  }
}

function workspacePatterns(file: { path: string; content: string }): string[] {
  let workspace: unknown
  if (file.path.endsWith('/pnpm-workspace.yaml')) {
    const document = parseDocument(file.content)
    if (document.errors.length || document.warnings.length) throw new Error('Invalid workspace YAML')
    const manifest = document.toJS({ maxAliasCount: 100 }) as { packages?: unknown } | null
    if (manifest !== null && !Value.Check(Type.Object({}), manifest)) throw new Error('Invalid workspace YAML')
    workspace = manifest?.packages
  } else {
    const manifest = JSON.parse(file.content) as { workspaces?: unknown }
    workspace = manifest.workspaces
    if (Value.Check(Type.Object({}), workspace)) workspace = (workspace as { packages?: unknown }).packages
  }
  if (workspace === undefined) return []
  if (!Value.Check(Type.Array(Type.String()), workspace)) throw new Error('Invalid workspace patterns')
  if (
    workspace.some(
      (pattern: string) =>
        isAbsolute(pattern.replace(/^!/, '')) ||
        pattern.includes('\\') ||
        pattern.replace(/^!/, '').split('/').includes('..'),
    )
  ) {
    throw new Error('Invalid workspace patterns')
  }
  return workspace
}

async function inspectWorkspaceManifests(
  target: string,
  files: { path: string; content: string }[],
  issues: string[],
): Promise<void> {
  const manifests = files.filter(
    (file) => file.path.endsWith('/package.json') || file.path.endsWith('/pnpm-workspace.yaml'),
  )
  const found = new Set(files.map((file) => file.path))
  for (const file of manifests) {
    if (file.path.endsWith('/package.json') && found.has(join(dirname(file.path), 'pnpm-workspace.yaml'))) continue
    try {
      const patterns = workspacePatterns(file)
      const included = patterns
        .filter((pattern) => !pattern.startsWith('!'))
        .map((pattern) => `${pattern.replace(/\/$/, '')}/package.json`)
      const excluded = patterns
        .filter((pattern) => pattern.startsWith('!'))
        .map((pattern) => `${pattern.slice(1).replace(/\/$/, '')}/package.json`)
      if (!included.length) continue
      const paths: string[] = []
      for await (const path of glob(included, {
        cwd: dirname(file.path),
        exclude: [...excluded, '**/node_modules/**', '**/.git/**'],
      })) {
        const absolute = resolve(dirname(file.path), path)
        const withinTarget = relative(target, absolute)
        if (
          withinTarget.startsWith(`..${sep}`) ||
          withinTarget === '..' ||
          isAbsolute(withinTarget) ||
          found.has(absolute)
        )
          continue
        paths.push(absolute)
        if (paths.length > 2000) throw new Error('Too many workspace manifests')
      }
      for (const path of paths.sort()) {
        const info = await lstat(path)
        if (!info.isFile() || info.isSymbolicLink() || info.size > 12000 || (await realpath(path)) !== path) {
          issues.push(`The repository file cannot be inspected safely: ${path}`)
          continue
        }
        files.push({ path, content: await readFile(path, 'utf8') })
        found.add(path)
      }
    } catch {
      issues.push(`The workspace configuration cannot be inspected safely: ${file.path}`)
    }
  }
}

async function inspectBiomeAntiSlop(
  root: string,
  pi: ExtensionAPI,
  signal?: AbortSignal,
  effect = false,
  selectedConfiguration?: string,
): Promise<InstallPreview> {
  const target = await realpath(root)
  const gaps = [
    'Only upstream examples and selected edge cases are verified for the installed rules.',
    'Per-rule severity configuration and fixes are not implemented.',
    'Biome noAccumulatingSpread can duplicate the reducer copy and spread diagnostics.',
    'The accumulating-spread companion covers selected Oxc examples; identical argument text and multiple writes can differ from Oxc.',
    'no-widen-then-assert skips ambiguous repeated source text because the Biome JavaScript AST exposes no source offsets.',
    'Biome 2.6.4 supports lint/plugin suppression, but the tested named suppression does not suppress JavaScript plugins.',
    'Biome 2.6.4 omits initial leading comments from the JavaScript plugin AST, so the safety-comment rule is not installed.',
    'Targets that rely on a parent configuration without a local configuration require manual review.',
    'Projects that typecheck vendored assets need compatible @biomejs/runtime declarations; dependency changes are not automatic.',
    'Installed rules run through Biome without Pi.',
    'Targets outside the trusted Git repository require a session in that target.',
  ]
  const repository = await inspectRepository(target, pi, signal)
  const { gitStatus, repositoryFiles } = repository

  await inspectWorkspaceManifests(target, repositoryFiles, repository.issues)
  const effectEnabled = effect
  const assetNames = effectEnabled ? [...bundledFiles, ...effectBundledFiles] : bundledFiles
  const selectedPluginPaths = effectEnabled ? [...pluginPaths, ...effectPluginPaths] : pluginPaths
  const config = await inspectBiomeConfiguration(
    target,
    repository.directories,
    pi,
    signal,
    [antiSlopEntrypointPath],
    selectedConfiguration,
  )
  if (effectEnabled) gaps.push('Effect constructor imports through package aliases are not detected.')
  const {
    version,
    configurationPath,
    configurationBefore,
    configurationAfter,
    nestedConfiguration,
    configurationMetadata,
    resolvedConfiguration,
  } = config
  const issues = [...repository.issues, ...config.issues]
  let packageManager: string | null = null
  for (const file of repositoryFiles) {
    if (!file.path.endsWith('/package.json')) continue
    try {
      const manifest = JSON.parse(file.content) as { packageManager?: unknown }
      if (Value.Check(Type.String(), manifest.packageManager)) {
        packageManager = manifest.packageManager
        break
      }
    } catch {
      issues.push(`The package manifest is invalid: ${file.path}`)
    }
  }
  if (!packageManager) {
    const detected: string[] = []
    for (const dir of repository.directories) {
      for (const [file, manager] of [
        ['bun.lock', 'bun'],
        ['bun.lockb', 'bun'],
        ['pnpm-lock.yaml', 'pnpm'],
        ['yarn.lock', 'yarn'],
        ['package-lock.json', 'npm'],
      ] as const) {
        if ((await pathExists(join(dir, file))) && !detected.includes(manager)) detected.push(manager)
      }
    }
    packageManager = detected.length === 1 ? (detected[0] ?? null) : detected.length ? 'ambiguous' : null
  }
  const resolvedConfigurationScope = nestedConfiguration ? 'workspace-root' : 'target'
  if (nestedConfiguration) {
    gaps.push('Biome inspect config reports the workspace root; review the nested configuration separately.')
  }

  const proposedFiles = [
    configurationPath,
    ...assetNames.map((name) =>
      join(target, name.endsWith('.ts') ? 'tools/biome/anti-slop/rules' : 'tools/biome/anti-slop', name),
    ),
    join(target, antiSlopEntrypointPath),
    join(target, 'tools/biome/anti-slop/port-base.snapshot'),
    ...(configurationBefore === null ? [] : [join(target, 'tools/biome/anti-slop/biome-config.backup')]),
  ]
  const bundleHash = (await readBundledAntiSlop(assetNames)).hash
  const hash = createHash('sha256')
    .update(
      JSON.stringify({
        target,
        version,
        packageManager,
        gitStatus: gitStatus,
        repositoryFiles,
        issues,
        proposedFiles,
        missingRules,
        gaps,
        bundleHash,
        entrypoint: formatAntiSlopEntrypoint(selectedPluginPaths),
        effectEnabled,
        assetNames,
        configurationPath,
        configurationBefore,
        configurationAfter,
        nestedConfiguration,
        configurationMetadata,
        resolvedConfiguration,
      }),
    )
    .digest('hex')

  return {
    root: target,
    proposedFiles,
    missingRules,
    gaps,
    issues,
    gitStatus: gitStatus.slice(0, 12000),
    packageManager,
    biomeVersion: version || null,
    effectEnabled,
    assetNames,
    repositoryFiles,
    bundleHash,
    configurationPath,
    configurationBefore,
    configurationAfter,
    configurationMetadata,
    resolvedConfiguration: resolvedConfiguration.slice(0, 12000),
    resolvedConfigurationScope,
    hash,
  }
}

async function installBiomeAntiSlop(preview: InstallPreview, signal?: AbortSignal): Promise<void> {
  const tools = join(preview.root, 'tools')
  const biome = join(tools, 'biome')
  const destination = join(biome, 'anti-slop')
  const rulesDirectory = join(destination, 'rules')
  const changed: string[] = []
  let stage = ''

  try {
    signal?.throwIfAborted()
    const assets = await readBundledAntiSlop(preview.assetNames)
    if (assets.hash !== preview.bundleHash) throw new Error('Bundled files changed after approval.')
    stage = await mkdtemp(join(tmpdir(), 'biome-anti-slop-stage-'))

    for (const [name, content] of assets.files) {
      const file = join(stage, name)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, content, { flag: 'wx' })
    }

    for (const directory of [tools, biome]) {
      signal?.throwIfAborted()
      if (!(await pathExists(directory))) {
        await mkdir(directory)
        changed.push(directory)
      }
      const info = await lstat(directory)
      if (!info.isDirectory() || info.isSymbolicLink() || (await realpath(directory)) !== directory) {
        throw new Error(`The destination parent changed: ${directory}`)
      }
    }

    await mkdir(destination)
    changed.push(destination)
    await mkdir(rulesDirectory)
    changed.push(rulesDirectory)
    for (const name of preview.assetNames) {
      signal?.throwIfAborted()
      const file = join(name.endsWith('.ts') ? rulesDirectory : destination, name)
      const directory = dirname(file)
      if ((await realpath(directory)) !== directory) throw new Error('The destination directory changed.')
      await withFileMutationQueue(file, async () => {
        await writeFile(file, await readFile(join(stage, name)), { flag: 'wx' })
      })
      changed.push(file)
    }

    const entrypoint = join(preview.root, antiSlopEntrypointPath)
    const selectedRules = preview.effectEnabled ? [...pluginPaths, ...effectPluginPaths] : pluginPaths
    await withFileMutationQueue(entrypoint, async () => {
      await writeFile(entrypoint, formatAntiSlopEntrypoint(selectedRules), { flag: 'wx' })
    })
    changed.push(entrypoint)

    const snapshot = join(destination, 'port-base.snapshot')
    await withFileMutationQueue(snapshot, async () => {
      await writeFile(
        snapshot,
        makePortSnapshot(
          assets.files,
          preview.effectEnabled,
          preview.effectEnabled ? [...pluginPaths, ...effectPluginPaths] : pluginPaths,
        ),
        { flag: 'wx', mode: 0o600 },
      )
    })
    changed.push(snapshot)

    if (preview.configurationBefore !== null) {
      const backup = join(destination, 'biome-config.backup')
      await withFileMutationQueue(backup, async () => {
        await writeFile(backup, preview.configurationBefore ?? '', { flag: 'wx', mode: 0o600 })
      })
      changed.push(backup)
    }

    signal?.throwIfAborted()
    await withFileMutationQueue(preview.configurationPath, async () => {
      if (preview.configurationBefore === null) {
        await writeFile(preview.configurationPath, preview.configurationAfter, { flag: 'wx' })
        return
      }

      const info = await lstat(preview.configurationPath)
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.nlink !== 1 ||
        JSON.stringify([info.dev, info.ino, info.mode, info.uid, info.gid]) !==
          JSON.stringify(preview.configurationMetadata) ||
        (await readFile(preview.configurationPath, 'utf8')) !== preview.configurationBefore
      ) {
        throw new Error('Biome configuration changed after approval.')
      }

      const temporary = join(preview.root, `.biome-anti-slop-${randomUUID()}.tmp`)
      try {
        await writeFile(temporary, preview.configurationAfter, { flag: 'wx', mode: info.mode & 0o7777 })
        await chmod(temporary, info.mode & 0o7777)
        const prepared = await lstat(temporary)
        if (prepared.uid !== info.uid || prepared.gid !== info.gid) await chown(temporary, info.uid, info.gid)
        const current = await lstat(preview.configurationPath)
        if (
          !current.isFile() ||
          current.isSymbolicLink() ||
          current.nlink !== 1 ||
          current.ino !== info.ino ||
          current.dev !== info.dev ||
          current.mode !== info.mode ||
          current.uid !== info.uid ||
          current.gid !== info.gid ||
          (await readFile(preview.configurationPath, 'utf8')) !== preview.configurationBefore
        ) {
          throw new Error('Biome configuration changed while preparing the install.')
        }
        await rename(temporary, preview.configurationPath)
      } finally {
        await rm(temporary, { force: true })
      }
    })
    changed.push(preview.configurationPath)
  } catch (error) {
    throw new Error(
      `Biome anti-slop install failed. Created paths: ${changed.join(', ') || 'none'}. Review them before recovery. ${String(error)}`,
    )
  } finally {
    if (stage) await rm(stage, { recursive: true, force: true })
  }
}

async function isTrustedTarget(
  root: string,
  ctx: ExtensionContext,
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!ctx.isProjectTrusted()) return false
  const cwd = await realpath(ctx.cwd)
  const git = await pi.exec('git', ['rev-parse', '--show-toplevel'], { cwd, signal })
  const scope = git.code === 0 ? await realpath(git.stdout.trim()) : cwd
  const path = relative(scope, root)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}

type AntiSlopArguments = { config?: string; effect: boolean }

function parseAntiSlopArguments(args: string, allowEffect: boolean): AntiSlopArguments {
  const tokens: string[] = []
  let token = ''
  let quote = ''
  let started = false
  for (let i = 0; i < args.length; i++) {
    const char = args[i] ?? ''
    if (char === '\\' && quote !== "'") {
      if (++i === args.length) throw new Error('Invalid command arguments.')
      token += args[i]
      started = true
    } else if (quote) {
      if (char === quote) quote = ''
      else token += char
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) tokens.push(token)
      token = ''
      started = false
    } else {
      token += char
      started = true
    }
  }
  if (quote) throw new Error('Invalid command arguments.')
  if (started) tokens.push(token)
  let config: string | undefined
  let effect = false
  for (let i = 0; i < tokens.length; i++) {
    const arg = tokens[i]
    if (arg === '--effect' && allowEffect && !effect) effect = true
    else if (arg === '--config' && config === undefined) config = tokens[++i] ?? ''
    else if (arg?.startsWith('--config=') && config === undefined) config = arg.slice(9)
    else throw new Error(`Unknown or repeated argument: ${arg}`)
  }
  if (config !== undefined && (!config || config.startsWith('--')))
    throw new Error('Specify a configuration path after --config.')
  return { config, effect }
}

async function selectAntiSlopConfiguration(
  cwd: string,
  config?: string,
  requireExisting = false,
): Promise<{ root: string; path?: string }> {
  const current = await realpath(cwd)
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(current + (config ?? '')))
    throw new Error('The configuration path contains unsafe characters.')
  if (config === undefined) {
    if (!requireExisting) return { root: current }
    const candidates = [join(current, 'biome.json'), join(current, 'biome.jsonc')]
    const present = (await Promise.all(candidates.map(pathExists))).flatMap((exists, index) =>
      exists ? [candidates[index]] : [],
    )
    if (present.length !== 1) throw new Error('Select exactly one existing Biome configuration with --config.')
    return { root: current, path: present[0] }
  }
  const logical = resolve(cwd)
  const requested = resolve(logical, config)
  const fromCurrent = relative(logical, requested)
  const withinCurrent = fromCurrent !== '..' && !fromCurrent.startsWith(`..${sep}`) && !isAbsolute(fromCurrent)
  const path = withinCurrent ? resolve(current, fromCurrent) : resolve(current, config)
  if (!['biome.json', 'biome.jsonc'].includes(basename(path)))
    throw new Error('--config must select biome.json or biome.jsonc.')
  const root = dirname(path)
  if ((await realpath(root)) !== root) throw new Error('The configuration directory has an unsafe path.')
  if (!(await pathExists(path))) throw new Error('The selected Biome configuration does not exist.')
  return { root, path }
}

async function inspectCommandUpdate(
  root: string,
  configurationPath: string,
): Promise<{
  preview: UpdatePreview
  bundleHash: string
  collisions: string[]
  newRules: string[]
}> {
  const names = [...bundledFiles, ...effectBundledFiles]
  const incoming = await readBundledAntiSlop(names)
  const paths = [...pluginPaths, ...effectPluginPaths]
  const first = await inspectPortUpdate(
    root,
    incoming.files,
    bundledFiles,
    effectBundledFiles,
    paths,
    {},
    configurationPath,
  )
  const conflicts: Record<string, 'incoming'> = {}
  const rules: Record<string, 'enable'> = {}
  const collisions: string[] = []
  const newRules: string[] = []
  for (const comparison of first.comparisons) {
    if (
      comparison.base === null &&
      comparison.incoming !== null &&
      paths.includes(`./tools/biome/anti-slop/rules/${comparison.name}`)
    ) {
      rules[comparison.name] = 'enable'
      newRules.push(comparison.name)
    }
    if (
      comparison.local !== comparison.base &&
      comparison.incoming !== comparison.base &&
      comparison.local !== comparison.incoming
    ) {
      if (comparison.incoming === null)
        throw new Error(`The locally modified file was removed upstream: ${comparison.name}`)
      conflicts[comparison.name] = 'incoming'
      collisions.push(comparison.name)
    }
  }
  const preview = await inspectPortUpdate(
    root,
    incoming.files,
    bundledFiles,
    effectBundledFiles,
    paths,
    { conflicts, rules },
    configurationPath,
  )
  return { preview, bundleHash: incoming.hash, collisions, newRules }
}

async function executeAntiSlopUpdate(args: string, ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
  try {
    if (!ctx.hasUI) {
      ctx.ui.notify('A confirmation dialog is required. No files changed.', 'error')
      return
    }
    const options = parseAntiSlopArguments(args, false)
    const target = await selectAntiSlopConfiguration(ctx.cwd, options.config, true)
    if (!target.path || !(await isTrustedTarget(target.root, ctx, pi))) {
      ctx.ui.notify('Project trust is not established for the selected target.', 'error')
      return
    }
    const plan = await inspectCommandUpdate(target.root, target.path)
    if (plan.preview.issues.length || plan.preview.pending.length) {
      ctx.ui.notify([...plan.preview.issues, ...plan.preview.pending].join('\n'), 'error')
      return
    }
    const removed = plan.preview.changes
      .filter((change) => change.action === 'remove')
      .map((change) => basename(change.path))
    const message = [
      `Config: ${target.path ? relative(await realpath(ctx.cwd), target.path) : basename(target.root)}`,
      `Changes: ${plan.preview.changes.length}. New rules: ${plan.newRules.length}. Effect rules: ${plan.preview.effectEnabled ? 'enabled' : 'disabled'}`,
      ...(plan.collisions.length
        ? [`Overwrites: ${plan.collisions.join(', ')}`, 'Approval replaces these with incoming versions.']
        : []),
      ...(removed.length ? [`Removed files: ${removed.join(', ')}`] : []),
    ].join('\n')
    if (message.split('\n').length > 5 || message.split('\n').some((line) => line.length > 78)) {
      ctx.ui.notify('The confirmation details do not fit. No files changed.', 'error')
      return
    }
    if (!(await ctx.ui.confirm('Update Biome anti-slop rules?', message))) {
      ctx.ui.notify('No files changed.', 'info')
      return
    }
    const freshTarget = await selectAntiSlopConfiguration(ctx.cwd, options.config, true)
    if (
      freshTarget.root !== target.root ||
      freshTarget.path !== target.path ||
      !(await isTrustedTarget(target.root, ctx, pi))
    ) {
      ctx.ui.notify('Project trust or target changed during approval. No files changed.', 'error')
      return
    }
    const fresh = await inspectCommandUpdate(target.root, target.path)
    if (fresh.preview.hash !== plan.preview.hash || fresh.bundleHash !== plan.bundleHash) {
      ctx.ui.notify('The target or bundled files changed during approval. No files changed.', 'error')
      return
    }
    await applyCommandUpdate(fresh.preview)
    ctx.ui.notify('Biome anti-slop rules were updated. Run Biome.', 'info')
  } catch (error) {
    ctx.ui.notify(String(error), 'error')
  }
}

async function executeAntiSlopRemoval(args: string, ctx: ExtensionContext, pi: ExtensionAPI): Promise<void> {
  try {
    if (!ctx.hasUI) {
      ctx.ui.notify('A confirmation dialog is required. No files changed.', 'error')
      return
    }
    const options = parseAntiSlopArguments(args, false)
    const target = await selectAntiSlopConfiguration(ctx.cwd, options.config, true)
    if (!target.path || !(await isTrustedTarget(target.root, ctx, pi))) {
      ctx.ui.notify('Project trust is not established for the selected target.', 'error')
      return
    }
    const plan = await inspectCommandRemoval(target.root, target.path)
    const lines = [
      `Config: ${relative(await realpath(ctx.cwd), target.path)}`,
      `Remove registration and ${plan.changes.length - 1} managed files.`,
      'Existing configuration exclusions stay.',
    ]
    for (const path of plan.retained) {
      const last = lines.at(-1) ?? ''
      if (last.startsWith('Keep: ') && `${last}, ${path}`.length <= 78) lines[lines.length - 1] = `${last}, ${path}`
      else lines.push(`Keep: ${path}`)
    }
    if (lines.length > 5 || lines.some((line) => line.length > 78)) {
      ctx.ui.notify(
        `Retained files do not fit in the confirmation. No files changed: ${plan.retained.join(', ')}`,
        'error',
      )
      return
    }
    if (!(await ctx.ui.confirm('Remove Biome anti-slop rules?', lines.join('\n')))) {
      ctx.ui.notify('No files changed.', 'info')
      return
    }
    const freshTarget = await selectAntiSlopConfiguration(ctx.cwd, options.config, true)
    if (
      freshTarget.root !== target.root ||
      freshTarget.path !== target.path ||
      !(await isTrustedTarget(target.root, ctx, pi))
    ) {
      ctx.ui.notify('Project trust or target changed during approval. No files changed.', 'error')
      return
    }
    const fresh = await inspectCommandRemoval(target.root, target.path)
    if (fresh.hash !== plan.hash) {
      ctx.ui.notify('The target changed during approval. No files changed.', 'error')
      return
    }
    await applyCommandRemoval(fresh)
    ctx.ui.notify('Biome anti-slop registration and managed files were removed.', 'info')
  } catch (error) {
    ctx.ui.notify(String(error), 'error')
  }
}

function registerBiomeAntiSlopCommands(pi: ExtensionAPI): void {
  pi.registerCommand('anti-slop-remove', {
    description: 'Remove repository-owned Biome anti-slop rules.',
    handler: async (args: string, ctx: ExtensionContext) => executeAntiSlopRemoval(args, ctx, pi),
  })
  pi.registerCommand('anti-slop-update', {
    description: 'Update repository-owned Biome anti-slop rules.',
    handler: async (args: string, ctx: ExtensionContext) => executeAntiSlopUpdate(args, ctx, pi),
  })
  pi.registerCommand('anti-slop-install', {
    description: 'Install repository-owned Biome anti-slop rules.',
    handler: async (args: string, ctx: ExtensionContext) => {
      try {
        if (!ctx.hasUI) {
          ctx.ui.notify('A confirmation dialog is required. No files changed.', 'error')
          return
        }
        const options = parseAntiSlopArguments(args, true)
        const target = await selectAntiSlopConfiguration(ctx.cwd, options.config)
        if (!(await isTrustedTarget(target.root, ctx, pi))) {
          ctx.ui.notify('Project trust is not established for the selected target.', 'error')
          return
        }
        const preview = await inspectBiomeAntiSlop(target.root, pi, undefined, options.effect, target.path)
        if (preview.issues.length) {
          ctx.ui.notify(preview.issues.join('\n'), 'error')
          return
        }
        const message = [
          `Config: ${relative(await realpath(ctx.cwd), preview.configurationPath) || basename(preview.configurationPath)}`,
          `Rules: ${pluginPaths.length + (options.effect ? effectPluginPaths.length : 0)}. Effect rules: ${options.effect ? 'enabled' : 'disabled'}`,
          `Not installed: ${preview.missingRules[0]}`,
          `Not installed: ${preview.missingRules[1]}`,
          'Rule limitations: see tools/biome/anti-slop/UPSTREAM.md.',
        ].join('\n')
        if (message.split('\n').some((line) => line.length > 78)) {
          ctx.ui.notify('The confirmation details do not fit. No files changed.', 'error')
          return
        }
        if (!(await ctx.ui.confirm('Install Biome anti-slop rules?', message))) {
          ctx.ui.notify('No files changed.', 'info')
          return
        }
        const freshTarget = await selectAntiSlopConfiguration(ctx.cwd, options.config)
        if (
          freshTarget.root !== target.root ||
          freshTarget.path !== target.path ||
          !(await isTrustedTarget(target.root, ctx, pi))
        ) {
          ctx.ui.notify('Project trust or target changed during approval. No files changed.', 'error')
          return
        }
        const fresh = await inspectBiomeAntiSlop(target.root, pi, undefined, options.effect, target.path)
        if (fresh.hash !== preview.hash || fresh.issues.length) {
          ctx.ui.notify('The target or bundled files changed during approval. No files changed.', 'error')
          return
        }
        await installBiomeAntiSlop(fresh)
        ctx.ui.notify('Biome anti-slop rules were installed. Run Biome.', 'info')
      } catch (error) {
        ctx.ui.notify(String(error), 'error')
      }
    },
  })
}

export { registerBiomeAntiSlopCommands }
