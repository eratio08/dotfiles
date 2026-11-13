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
import {
  type AgentToolUpdateCallback,
  type ExtensionAPI,
  type ExtensionToolContext,
  withFileMutationQueue,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'
import { parseDocument } from 'yaml'
import { editBiomeConfiguration } from './biome-config.ts'
import {
  applyPortUpdate,
  checkUnknownBaseChanges,
  inspectPortUpdate,
  inspectTypeofConfiguration,
  makePortSnapshot,
  summarizePortUpdate,
  type UpdateDecisions,
  type UpdatePreview,
} from './update.ts'
import { type VerifyResult, verifyBiomeAntiSlop } from './verification.ts'

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
  'tests/no-service-constructor-imports.test.ts',
  'tagged-values.ts',
  'no-manual-effect-error-tag.ts',
  'tests/no-manual-effect-error-tag.test.ts',
  'no-manual-tag-comparison.ts',
  'tests/no-manual-tag-comparison.test.ts',
  'no-manual-tagged-construction.ts',
  'tests/no-manual-tagged-construction.test.ts',
  'prefer-effect-match.ts',
  'tests/prefer-effect-match.test.ts',
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
  'tests/no-reflect-get.test.ts',
  'no-module-mocking.ts',
  'tests/no-module-mocking.test.ts',
  'no-chained-type-assertions.ts',
  'tests/no-chained-type-assertions.test.ts',
  'no-conditional-empty-object-spread.ts',
  'tests/no-conditional-empty-object-spread.test.ts',
  'no-object-parameters.ts',
  'tests/no-object-parameters.test.ts',
  'no-unknown-parameters.ts',
  'tests/no-unknown-parameters.test.ts',
  'no-unknown-returns.ts',
  'tests/no-unknown-returns.test.ts',
  'no-unknown-type-aliases.ts',
  'tests/no-unknown-type-aliases.test.ts',
  'no-shape-in-symbol-names.ts',
  'tests/no-shape-in-symbol-names.test.ts',
  'tests/no-unsafe-dictionary-type.test.ts',
  'tests/run-biome-cases.ts',
  'widening-types.ts',
  'tests/no-known-value-widening.test.ts',
  'tests/no-widen-then-assert.test.ts',
  'tests/no-accumulating-spread.test.ts',
  'tests/no-reduce-accumulator-copy.test.ts',
  'no-array-filter-map.ts',
  'tests/no-array-filter-map.test.ts',
  'no-reflect-apply.ts',
  'no-runtime-typeof.ts',
  'tests/no-reflect-apply.test.ts',
  'tests/no-runtime-typeof.test.ts',
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
  effectSelection: 'automatic' | 'explicit'
  effectManifests: string[]
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

type UpdateResult = {
  content: [{ type: 'text'; text: string }]
  details: {
    status: string
    message: string
    preview: ReturnType<typeof summarizePortUpdate>
    backup?: string
    verification?: VerifyResult['details']
    focusedTests?: Awaited<ReturnType<typeof checkUnknownBaseChanges>>
  }
}

type InstallResult = {
  content: [{ type: 'text'; text: string }]
  details: { status: string; message: string; preview: InstallPreview }
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
  selectedPluginPaths = pluginPaths,
): Promise<ConfigurationInspection> {
  const issues: string[] = []
  const json = join(target, 'biome.json')
  const jsonc = join(target, 'biome.jsonc')
  const hasJson = await pathExists(json)
  const hasJsonc = await pathExists(jsonc)
  if (hasJson && hasJsonc) issues.push('Both Biome configuration files exist.')
  const configurationPath = hasJsonc ? jsonc : json
  let configurationBefore: string | null = null
  let configurationAfter = ''
  let resolvedConfiguration = ''
  let nestedConfiguration = false
  let configurationMetadata: number[] | null = null

  if (hasJson || hasJsonc) {
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
      if (!nestedConfiguration) args.push('--config-path', target)
      const inspected = await pi.exec(biomeBinary, args, { cwd: target, signal })
      if (inspected.code !== 0) issues.push('Biome could not resolve the existing configuration.')
      resolvedConfiguration = inspected.stdout + inspected.stderr
      if ([...pluginPaths, ...effectPluginPaths].some((path) => resolvedConfiguration.includes(path.slice(2)))) {
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

function declaresEffect(content: string): boolean {
  try {
    const manifest = JSON.parse(content) as {
      dependencies?: unknown
      devDependencies?: unknown
      peerDependencies?: unknown
      optionalDependencies?: unknown
    }
    return (['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const).some(
      (section) => {
        const dependencies = manifest[section]
        return Value.Check(Type.Object({}), dependencies) && Object.hasOwn(dependencies, 'effect')
      },
    )
  } catch {
    return false
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
  effect?: boolean,
): Promise<InstallPreview> {
  const target = await realpath(root)
  const gaps = [
    'Only upstream examples and selected edge cases are verified for the installed rules.',
    'Only the no-runtime-typeof type-guard option supports Pi reconfiguration. Per-rule severity configuration and fixes are not implemented.',
    'Biome noAccumulatingSpread can duplicate the reducer copy and spread diagnostics.',
    'The accumulating-spread companion covers selected Oxc examples; identical argument text and multiple writes can differ from Oxc.',
    'no-widen-then-assert skips ambiguous repeated source text because the Biome JavaScript AST exposes no source offsets.',
    'Biome 2.6.4 supports lint/plugin suppression, but the tested named suppression does not suppress JavaScript plugins.',
    'Biome 2.6.4 omits initial leading comments from the JavaScript plugin AST, so the safety-comment rule is not installed.',
    'Targets that rely on a parent configuration without a local configuration require manual review.',
    'Projects that typecheck vendored assets need compatible @biomejs/runtime declarations; dependency changes are not automatic.',
    'Verification runs only supported read-only lint and typecheck commands. Focused update tests require Bun.',
    'Targets outside the trusted Git repository require a session in that target.',
  ]
  const repository = await inspectRepository(target, pi, signal)
  const { gitStatus, repositoryFiles } = repository

  await inspectWorkspaceManifests(target, repositoryFiles, repository.issues)
  const effectManifests = repositoryFiles
    .filter((file) => file.path.endsWith('/package.json') && declaresEffect(file.content))
    .map((file) => file.path)
  const effectEnabled = effect ?? effectManifests.length > 0
  const effectSelection = effect === undefined ? 'automatic' : 'explicit'
  const assetNames = (effectEnabled ? [...bundledFiles, ...effectBundledFiles] : bundledFiles).filter(
    (name) => !name.startsWith('tests/'),
  )
  const selectedPluginPaths = effectEnabled ? [...pluginPaths, ...effectPluginPaths] : pluginPaths
  const config = await inspectBiomeConfiguration(target, repository.directories, pi, signal, selectedPluginPaths)
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
        effectEnabled,
        effectSelection,
        effectManifests,
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
    effectSelection,
    effectManifests,
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

function hasExplicitApproval(
  ctx: ExtensionToolContext,
  operation: 'install' | 'update' | 'configure',
  hash: string,
): boolean {
  const entry = ctx.sessionManager
    .getBranch()
    .findLast((item) => item.type === 'message' && item.message.role === 'user')
  if (entry?.type !== 'message' || entry.message.role !== 'user') return false
  const content = entry.message.content
  const text = Value.Check(Type.String(), content)
    ? content
    : Array.isArray(content) &&
        content.length === 1 &&
        content[0]?.type === 'text' &&
        Value.Check(Type.String(), content[0].text)
      ? content[0].text
      : ''
  return text.trim() === `approve biome-anti-slop ${operation} ${hash}`
}

async function isTrustedTarget(
  root: string,
  ctx: ExtensionToolContext,
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

type BiomeToolParams = {
  operation: 'inspect' | 'install' | 'check' | 'inspect-update' | 'update' | 'inspect-configure' | 'configure'
  root?: string
  previewHash?: string
  effect?: boolean
  allowInTypeGuards?: boolean
  decisions?: UpdateDecisions
}

async function executePortChange(
  pi: ExtensionAPI,
  root: string,
  params: BiomeToolParams,
  ctx: ExtensionToolContext,
  signal?: AbortSignal,
): Promise<UpdateResult | VerifyResult> {
  const configuring = params.operation === 'inspect-configure' || params.operation === 'configure'
  if (configuring && !Value.Check(Type.Boolean(), params.allowInTypeGuards)) {
    const details = { status: 'blocked', message: 'Specify allowInTypeGuards.', checks: [] }
    return { content: [{ type: 'text', text: JSON.stringify(details) }], details }
  }
  const incoming = await readBundledAntiSlop([...bundledFiles, ...effectBundledFiles])
  const inspect = (files: Map<string, Buffer>): Promise<UpdatePreview> =>
    configuring
      ? inspectTypeofConfiguration(root, files, params.allowInTypeGuards === true)
      : inspectPortUpdate(
          root,
          files,
          bundledFiles,
          effectBundledFiles,
          [...pluginPaths, ...effectPluginPaths],
          params.decisions,
        )
  const preview = await inspect(incoming.files)
  const updateResult = (
    status: string,
    message: string,
    extra?: {
      backup?: string
      verification?: VerifyResult['details']
      focusedTests?: Awaited<ReturnType<typeof checkUnknownBaseChanges>>
    },
  ): UpdateResult => {
    const details = { status, message, preview: summarizePortUpdate(preview), ...extra }
    return { content: [{ type: 'text', text: JSON.stringify(details) }], details }
  }
  if (params.operation === 'inspect-update' || params.operation === 'inspect-configure')
    return updateResult(
      'preview',
      `Review the proposal. Without interactive UI, reply exactly: approve biome-anti-slop ${configuring ? 'configure' : 'update'} ${preview.hash}`,
    )
  if (preview.issues.length) return updateResult('blocked', 'The update requires manual review.')
  if (!params.previewHash || params.previewHash !== preview.hash)
    return updateResult('blocked', 'Inspect again and use the current preview.')
  if (ctx.hasUI) {
    if (
      !(await ctx.ui.confirm(
        configuring ? 'Configure Biome anti-slop rule?' : 'Update Biome anti-slop port?',
        JSON.stringify(summarizePortUpdate(preview), null, 2),
      ))
    )
      return updateResult('declined', 'No files changed.')
  } else if (!hasExplicitApproval(ctx, configuring ? 'configure' : 'update', preview.hash))
    return updateResult('blocked', 'Explicit user approval of the current preview is required.')
  if (!(await isTrustedTarget(root, ctx, pi, signal)))
    return updateResult('blocked', 'Project trust changed during approval.')
  const freshIncoming = await readBundledAntiSlop([...bundledFiles, ...effectBundledFiles])
  const fresh = await inspect(freshIncoming.files)
  if (fresh.hash !== preview.hash)
    return updateResult('blocked', 'The target or bundled files changed during approval.')
  const repository = await inspectRepository(root, pi, signal)
  const config = await inspectBiomeConfiguration(root, repository.directories, pi, signal)
  const focusedTests =
    fresh.baseAvailable && !configuring
      ? []
      : await checkUnknownBaseChanges(fresh, freshIncoming.files, config.biomeBinary, config.version, pi, signal)
  if (focusedTests.some((check) => check.status !== 'passed'))
    return updateResult('blocked', 'A focused test failed or was unavailable. No files changed.', {
      focusedTests,
    })
  const testedIncoming = await readBundledAntiSlop([...bundledFiles, ...effectBundledFiles])
  const tested = await inspect(testedIncoming.files)
  if (tested.hash !== preview.hash)
    return updateResult('blocked', 'The target or bundled files changed during focused tests.', { focusedTests })
  const backup = await applyPortUpdate(tested, true, signal)
  try {
    if (focusedTests.length)
      await writeFile(join(backup, 'focused-tests.backup'), JSON.stringify(focusedTests, null, 2), {
        flag: 'wx',
        mode: 0o600,
      })
    const verification = await verifyBiomeAntiSlop(
      { root, directories: repository.directories, biomeBinary: config.biomeBinary, biomeVersion: config.version },
      pi,
      signal,
    )
    await writeFile(join(backup, 'verification.backup'), JSON.stringify(verification.details, null, 2), {
      flag: 'wx',
      mode: 0o600,
    })
    return updateResult(
      configuring ? 'configured' : fresh.pending.length ? 'partial' : 'updated',
      configuring
        ? 'The option was changed. Review verification.'
        : 'The update was applied. Review verification and pending decisions.',
      { backup, verification: verification.details, focusedTests },
    )
  } catch (error) {
    return updateResult(
      'partial',
      `Files changed, but verification could not be recorded: ${String(error)}. Backup: ${backup}.`,
      { backup, focusedTests },
    )
  }
}

function formatInstallApproval(preview: InstallPreview): string {
  const rules = preview.effectEnabled ? [...pluginPaths, ...effectPluginPaths] : pluginPaths

  return [
    `Project: ${preview.root}`,
    `Biome: ${preview.biomeVersion}\nEffect rules: ${preview.effectEnabled ? 'enabled' : 'disabled'} (${preview.effectSelection})`,
    `Rules:\n${rules.map((path) => `- ${basename(path, '.ts')}`).join('\n')}`,
    `Not installed:\n${preview.missingRules.map((name) => `- ${name}`).join('\n')}`,
    `Files: copy rules, licenses, and snapshot to tools/biome/anti-slop; ${preview.configurationBefore === null ? 'create' : 'back up and update'} ${relative(preview.root, preview.configurationPath)}.`,
    `Limitations:\n${preview.gaps.map((gap) => `- ${gap}`).join('\n')}`,
  ].join('\n\n')
}

function registerBiomeAntiSlopTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'biome_anti_slop',
    label: 'Biome anti-slop',
    description:
      'Inspect, install, update, configure, or check an explicitly partial repository-owned Biome anti-slop port.',
    promptSnippet: 'Inspect, install, update, configure, or check repository-owned Biome anti-slop rules.',
    promptGuidelines: ['Inspect first. The port is incomplete and installation requires user approval.'],
    parameters: Type.Object({
      operation: Type.Union([
        Type.Literal('inspect'),
        Type.Literal('install'),
        Type.Literal('check'),
        Type.Literal('inspect-update'),
        Type.Literal('update'),
        Type.Literal('inspect-configure'),
        Type.Literal('configure'),
      ]),
      root: Type.Optional(Type.String()),
      previewHash: Type.Optional(Type.String()),
      effect: Type.Optional(Type.Boolean()),
      allowInTypeGuards: Type.Optional(Type.Boolean()),
      decisions: Type.Optional(
        Type.Object({
          conflicts: Type.Optional(
            Type.Record(Type.String(), Type.Union([Type.Literal('incoming'), Type.Literal('local')])),
          ),
          rules: Type.Optional(
            Type.Record(Type.String(), Type.Union([Type.Literal('enable'), Type.Literal('disabled')])),
          ),
        }),
      ),
    }),
    async execute(
      _id: string,
      params: BiomeToolParams,
      signal: AbortSignal | undefined,
      _onUpdate:
        | AgentToolUpdateCallback<InstallResult['details'] | VerifyResult['details'] | UpdateResult['details']>
        | undefined,
      ctx: ExtensionToolContext,
    ): Promise<InstallResult | VerifyResult | UpdateResult> {
      const root = await realpath(resolve(ctx.cwd, params.root ?? '.'))
      if (!(await isTrustedTarget(root, ctx, pi, signal))) {
        const details = {
          status: 'blocked',
          message: 'Project trust is not established for the selected target.',
          checks: [],
        }
        return { content: [{ type: 'text', text: JSON.stringify(details) }], details }
      }
      if (params.operation === 'check') {
        const repository = await inspectRepository(root, pi, signal)
        const config = await inspectBiomeConfiguration(root, repository.directories, pi, signal)
        return verifyBiomeAntiSlop(
          { root, directories: repository.directories, biomeBinary: config.biomeBinary, biomeVersion: config.version },
          pi,
          signal,
        )
      }
      if (
        params.operation === 'inspect-update' ||
        params.operation === 'update' ||
        params.operation === 'inspect-configure' ||
        params.operation === 'configure'
      )
        return executePortChange(pi, root, params, ctx, signal)
      const preview = await inspectBiomeAntiSlop(root, pi, signal, params.effect)
      const result = (status: string, message: string): InstallResult => {
        const details = { status, message, preview }
        return { content: [{ type: 'text', text: JSON.stringify(details) }], details }
      }

      if (params.operation === 'inspect') {
        return result(
          'preview',
          `Review the partial port and proposed files before installation. Without interactive UI, reply exactly: approve biome-anti-slop install ${preview.hash}`,
        )
      }
      if (preview.issues.length) return result('blocked', 'The target requires manual review.')
      if (!params.previewHash || params.previewHash !== preview.hash)
        return result('blocked', 'Inspect again and use the current preview.')
      if (ctx.hasUI) {
        const approved = await ctx.ui.confirm('Install partial Biome anti-slop port?', formatInstallApproval(preview))
        if (!approved) return result('declined', 'No files changed.')
      } else if (!hasExplicitApproval(ctx, 'install', preview.hash)) {
        return result('blocked', 'Explicit user approval of the current preview is required.')
      }
      if (!(await isTrustedTarget(preview.root, ctx, pi, signal)))
        return result('blocked', 'Project trust changed during approval.')
      const fresh = await inspectBiomeAntiSlop(preview.root, pi, signal, params.effect)
      if (fresh.hash !== preview.hash) return result('blocked', 'The target or bundled files changed during approval.')
      await installBiomeAntiSlop(fresh, signal)
      return result('installed', 'The partial port was installed. Run Biome.')
    },
  })
}

export { registerBiomeAntiSlopTool }
