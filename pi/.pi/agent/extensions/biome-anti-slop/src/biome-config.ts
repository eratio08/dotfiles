import * as Jsonc from 'jsonc-parser'

type BiomeConfigurationEdit = {
  before: string
  after: string
  nested: boolean
}

function appendConfigurationItem(source: string, container: Jsonc.Node, item: string): string {
  const close = container.offset + container.length - 1
  const children = container.children ?? []
  const last = children.at(-1)
  const end = last ? last.offset + last.length : container.offset + 1
  const gap = source.slice(end, close)
  const scanner = Jsonc.createScanner(gap)
  let trailingComma = false

  while (true) {
    const token = scanner.scan()
    if (token === Jsonc.SyntaxKind.EOF) break
    if (token === Jsonc.SyntaxKind.CommaToken) trailingComma = true
  }

  const afterLast = last && !trailingComma ? ',' : ''
  const lineStart = source.lastIndexOf('\n', close - 1) + 1
  const closeIndent = source.slice(lineStart, close)
  let insertion = item + (trailingComma ? ',' : '')

  if (/^[ \t]*$/.test(closeIndent) && lineStart > container.offset) {
    const lastLineStart = last ? source.lastIndexOf('\n', last.offset - 1) + 1 : lineStart
    const lastIndent = last ? source.slice(lastLineStart, last.offset).match(/^[ \t]*/)?.[0] : undefined
    const indent = lastIndent || `${closeIndent}  `
    const newline = source.includes('\r\n') ? '\r\n' : '\n'
    insertion = `${indent}${insertion}${newline}`
    return source.slice(0, end) + afterLast + source.slice(end, lineStart) + insertion + source.slice(lineStart)
  }

  if (last || gap.trim()) insertion = ` ${insertion}`
  return source.slice(0, end) + afterLast + source.slice(end, close) + insertion + source.slice(close)
}

type BiomePluginReferences = {
  plugins: string[]
  overrides: string[]
  inherited: boolean
}

function inspectBiomePluginReferences(source: string): BiomePluginReferences {
  const errors: Jsonc.ParseError[] = []
  const root = Jsonc.parseTree(source, errors, { allowTrailingComma: true })
  if (errors.length || root?.type !== 'object') throw new Error('The Biome configuration cannot be reviewed safely.')
  function propertyNames(node: Jsonc.Node): void {
    const keys = node.children?.map((property) => property.children?.[0]?.value) ?? []
    if (new Set(keys).size !== keys.length) throw new Error('The Biome configuration has duplicate keys.')
  }
  function pluginPaths(node: Jsonc.Node | undefined): string[] {
    if (!node || node.type === 'null') return []
    if (node.type !== 'array') throw new Error('The Biome plugins cannot be reviewed safely.')
    const paths = (node.children ?? []).map((entry) => {
      if (entry.type === 'string') return entry.value as string
      if (entry.type !== 'object') throw new Error('The Biome plugins cannot be reviewed safely.')
      propertyNames(entry)
      const path = Jsonc.findNodeAtLocation(entry, ['path'])
      const resolution = Jsonc.findNodeAtLocation(entry, ['resolutionKind'])
      if (
        path?.type !== 'string' ||
        (resolution &&
          resolution.type !== 'null' &&
          (resolution.type !== 'string' || !['config', 'project'].includes(resolution.value)))
      )
        throw new Error('The Biome plugins cannot be reviewed safely.')
      return path.value as string
    })
    if (paths.some((path) => /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(path)))
      throw new Error('The Biome plugin path contains unsafe characters.')
    return paths
  }
  propertyNames(root)
  const plugins = pluginPaths(Jsonc.findNodeAtLocation(root, ['plugins']))
  const overridesNode = Jsonc.findNodeAtLocation(root, ['overrides'])
  const overrides: string[] = []
  if (overridesNode && overridesNode.type !== 'null') {
    if (overridesNode.type !== 'array') throw new Error('The Biome overrides cannot be reviewed safely.')
    for (const override of overridesNode.children ?? []) {
      if (override.type !== 'object') throw new Error('The Biome overrides cannot be reviewed safely.')
      propertyNames(override)
      overrides.push(...pluginPaths(Jsonc.findNodeAtLocation(override, ['plugins'])))
    }
  }
  const rootSetting = Jsonc.findNodeAtLocation(root, ['root'])
  const extended = Jsonc.findNodeAtLocation(root, ['extends'])
  if (rootSetting && !['boolean', 'null'].includes(rootSetting.type))
    throw new Error('The Biome root setting cannot be reviewed safely.')
  if (
    extended &&
    extended.type !== 'null' &&
    !(extended.type === 'string' && extended.value === '//') &&
    !(extended.type === 'array' && (extended.children ?? []).every((node) => node.type === 'string'))
  )
    throw new Error('The Biome extends setting cannot be reviewed safely.')
  const inherited =
    rootSetting?.value === false ||
    !!(extended && extended.type !== 'null' && (extended.type !== 'array' || (extended.children?.length ?? 0) > 0))
  return { plugins, overrides, inherited }
}

function removeAntiSlopRegistration(source: string, pluginPath: string): string {
  const errors: Jsonc.ParseError[] = []
  const root = Jsonc.parseTree(source, errors, { allowTrailingComma: true })
  if (errors.length || root?.type !== 'object') throw new Error('The Biome configuration cannot be reviewed safely.')
  const keys = root.children?.map((property) => property.children?.[0]?.value) ?? []
  if (new Set(keys).size !== keys.length) throw new Error('The Biome configuration has duplicate keys.')
  const plugins = Jsonc.findNodeAtLocation(root, ['plugins'])
  if (plugins?.type !== 'array') throw new Error('The Biome plugins cannot be reviewed safely.')
  const entries = plugins.children ?? []
  const matches = entries.flatMap((entry, index) => (entry.value === pluginPath ? [index] : []))
  if (matches.length !== 1) throw new Error('The anti-slop registration cannot be identified safely.')
  const index = matches[0] ?? -1
  const item = entries[index]
  if (!item) throw new Error('The anti-slop registration cannot be identified safely.')
  const previous = entries[index - 1]
  const next = entries[index + 1]
  const start = next || !previous ? item.offset + item.length : previous.offset + previous.length
  const end = next ? next.offset : previous ? item.offset : plugins.offset + plugins.length - 1
  const scanner = Jsonc.createScanner(source.slice(start, end))
  let comma = -1
  while (scanner.scan() !== Jsonc.SyntaxKind.EOF) {
    if (scanner.getToken() === Jsonc.SyntaxKind.CommaToken) {
      comma = start + scanner.getTokenOffset()
      break
    }
  }
  if (comma < 0 && entries.length > 1) throw new Error('The Biome plugins cannot be edited safely.')
  const edits = [{ offset: item.offset, length: item.length }]
  if (comma >= 0) edits.push({ offset: comma, length: 1 })
  const after = Jsonc.applyEdits(
    source,
    edits.map(({ offset, length }) => ({ offset, length, content: '' })),
  )
  const check: Jsonc.ParseError[] = []
  const tree = Jsonc.parseTree(after, check, { allowTrailingComma: true })
  if (check.length || !tree) throw new Error('The Biome plugins cannot be edited safely.')
  return after
}

function editBiomeConfiguration(source: string, pluginPaths: string[]): BiomeConfigurationEdit {
  const errors: Jsonc.ParseError[] = []
  const root = Jsonc.parseTree(source, errors, { allowTrailingComma: true })
  if (errors.length || root?.type !== 'object') throw new Error('Biome configuration is not valid JSONC.')

  const names = new Set<string>()
  for (const property of root.children ?? []) {
    const key = property.children?.[0]?.value
    if (property.children?.[0]?.type !== 'string' || names.has(key))
      throw new Error('Biome configuration has duplicate or invalid keys.')
    names.add(key)
  }

  const rootSetting = Jsonc.findNodeAtLocation(root, ['root'])
  const extendsSetting = Jsonc.findNodeAtLocation(root, ['extends'])
  const nested = rootSetting?.value === false || extendsSetting?.value === '//'
  if (nested && extendsSetting && extendsSetting.value !== '//') {
    throw new Error('Nested configurations with custom extends require manual review.')
  }

  const plugins = Jsonc.findNodeAtLocation(root, ['plugins'])
  if (plugins && plugins.type !== 'array') throw new Error('Biome plugins must be an array.')
  if (plugins?.children?.some((child) => child.type === 'string' && pluginPaths.includes(child.value))) {
    throw new Error('The anti-slop plugin is already configured.')
  }

  const entries = pluginPaths.map((path) => JSON.stringify(path)).join(', ')
  let after = plugins
    ? appendConfigurationItem(source, plugins, entries)
    : appendConfigurationItem(source, root, `"plugins": [${entries}]`)
  const withPlugin = Jsonc.parseTree(after, [], { allowTrailingComma: true })
  if (!withPlugin) throw new Error('Unable to safely edit Biome configuration.')
  const overrides = Jsonc.findNodeAtLocation(withPlugin, ['overrides'])
  if (overrides && overrides.type !== 'array') throw new Error('Biome overrides must be an array.')
  const exclusion = JSON.stringify({
    includes: ['**/tools/biome/anti-slop/**'],
    formatter: { enabled: false },
    linter: { enabled: false },
    assist: { enabled: false },
  })
  after = overrides
    ? appendConfigurationItem(after, overrides, exclusion)
    : appendConfigurationItem(after, withPlugin, `"overrides": [${exclusion}]`)
  const check: Jsonc.ParseError[] = []
  Jsonc.parseTree(after, check, { allowTrailingComma: true })
  if (check.length) throw new Error('Unable to safely edit Biome configuration.')

  return { before: source, after, nested }
}

export { type BiomeConfigurationEdit, editBiomeConfiguration, inspectBiomePluginReferences, removeAntiSlopRegistration }
