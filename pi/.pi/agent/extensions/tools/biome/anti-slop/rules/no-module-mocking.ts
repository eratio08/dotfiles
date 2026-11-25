// Checks Jest and Vitest module-mocking calls.
// It prevents tests from replacing dependencies through module interception instead of real interfaces.
import {
  defineRule,
  type JsCallExpression,
  type JsIdentifierExpression,
  registerDiagnostic,
  type SemanticRuleContext,
  semantic,
} from '@biomejs/runtime/plugin'
import { decodeAsciiEscapes, memberTarget, unwrapExpression } from './shared.ts'

function isFrameworkObject(object: JsIdentifierExpression, context: SemanticRuleContext): boolean {
  if (!object.name) return false
  const name = decodeAsciiEscapes(object.name.text)
  const binding = context.model.binding(object.name)
  if (!binding) return name === 'vi' || name === 'jest'
  const declaration = binding.syntax().parent
  if (declaration?.kind !== 'JS_NAMED_IMPORT_SPECIFIER' && declaration?.kind !== 'JS_SHORTHAND_NAMED_IMPORT_SPECIFIER')
    return false
  const clause = declaration
    .ancestors()
    .find((parent) => parent.kind === 'JS_IMPORT_NAMED_CLAUSE' || parent.kind === 'JS_IMPORT_COMBINED_CLAUSE')
  if (clause?.kind !== 'JS_IMPORT_NAMED_CLAUSE' && clause?.kind !== 'JS_IMPORT_COMBINED_CLAUSE') return false
  const rawSource = clause.source?.kind === 'JS_MODULE_SOURCE' ? (clause.source.valueToken ?? '') : ''
  const source = decodeAsciiEscapes(rawSource.slice(1, -1))
  const rawImported =
    declaration.kind === 'JS_NAMED_IMPORT_SPECIFIER'
      ? (declaration.name?.text ?? '')
      : (declaration.localName?.text ?? '')
  const imported = decodeAsciiEscapes(
    rawImported.startsWith('"') || rawImported.startsWith("'") ? rawImported.slice(1, -1) : rawImported,
  )
  return (source === 'vitest' && imported === 'vi') || (source === '@jest/globals' && imported === 'jest')
}

export const noModuleMocking = defineRule({
  query: semantic('JS_CALL_EXPRESSION'),
  run(node: JsCallExpression, context: SemanticRuleContext): void {
    const target = memberTarget(unwrapExpression(node.callee))
    if (target?.name !== 'mock' && target?.name !== 'doMock' && target?.name !== 'unstable_mockModule') return
    const object = unwrapExpression(target.object)
    if (object?.kind !== 'JS_IDENTIFIER_EXPRESSION' || !isFrameworkObject(object, context)) return
    registerDiagnostic(
      node,
      'error',
      'Replace module mocking with dependency injection through a real interface, service layer, or faithful test implementation.',
    )
  },
})
