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

function appendBiomePlugins(source: string, pluginPaths: string[]): string {
  const errors: Jsonc.ParseError[] = []
  const root = Jsonc.parseTree(source, errors, { allowTrailingComma: true })
  if (errors.length || root?.type !== 'object') throw new Error('Biome configuration is not valid JSONC.')
  const keys = (root.children ?? []).map((property) => property.children?.[0]?.value)
  if (new Set(keys).size !== keys.length) throw new Error('Biome configuration has duplicate keys.')
  const plugins = Jsonc.findNodeAtLocation(root, ['plugins'])
  if (plugins && plugins.type !== 'array') throw new Error('Biome plugins must be an array.')
  const existing = new Set(plugins?.children?.map((node) => node.value))
  const added = pluginPaths.filter((path) => !existing.has(path))
  if (!added.length) return source
  const entries = added.map((path) => JSON.stringify(path)).join(', ')
  return plugins
    ? appendConfigurationItem(source, plugins, entries)
    : appendConfigurationItem(source, root, `"plugins": [${entries}]`)
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

export { appendBiomePlugins, type BiomeConfigurationEdit, editBiomeConfiguration }
