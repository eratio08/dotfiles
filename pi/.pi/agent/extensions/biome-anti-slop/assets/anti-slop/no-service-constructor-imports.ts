// Checks project-local named imports that start with `make` and an uppercase letter outside test and spec files.
// It prevents production code from bypassing Effect service Layers through constructor imports.
import {
  ast,
  defineRule,
  type JsNamedImportSpecifier,
  type JsShorthandNamedImportSpecifier,
  type RuleContext,
  registerDiagnostic,
} from '@biomejs/runtime/plugin'
import { decodeAsciiEscapes } from './shared.ts'

function checkServiceImport(
  node: JsNamedImportSpecifier | JsShorthandNamedImportSpecifier,
  context: RuleContext,
): void {
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(context.filePath.replace(/\\/g, '/'))) return
  const clause = node
    .ancestors()
    .find((parent) => parent.kind === 'JS_IMPORT_NAMED_CLAUSE' || parent.kind === 'JS_IMPORT_COMBINED_CLAUSE')
  if (clause?.kind !== 'JS_IMPORT_NAMED_CLAUSE' && clause?.kind !== 'JS_IMPORT_COMBINED_CLAUSE') return
  const rawSource = clause.source?.kind === 'JS_MODULE_SOURCE' ? (clause.source.valueToken ?? '') : ''
  const source = decodeAsciiEscapes(rawSource.slice(1, -1))
  if (!source.startsWith('./') && !source.startsWith('../')) return
  const rawName = node.kind === 'JS_NAMED_IMPORT_SPECIFIER' ? (node.name?.text ?? '') : (node.localName?.text ?? '')
  const name = decodeAsciiEscapes(rawName.startsWith('"') || rawName.startsWith("'") ? rawName.slice(1, -1) : rawName)
  if (!/^make[A-Z]/.test(name)) return
  registerDiagnostic(
    node,
    'error',
    `Do not import Effect service constructor "${name}" into runtime code. Import the owning Layer, yield the contextual service, and allow its requirements to propagate to the composition root.`,
  )
}

export const serviceImport = defineRule({ query: ast('JS_NAMED_IMPORT_SPECIFIER'), run: checkServiceImport })
export const shorthandServiceImport = defineRule({
  query: ast('JS_SHORTHAND_NAMED_IMPORT_SPECIFIER'),
  run: checkServiceImport,
})
