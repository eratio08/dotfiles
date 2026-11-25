// Checks chains of conditional expressions that compare the same value to literals.
// It prevents long literal-branching ternaries and favors Effect `Match`.
import {
  type AnyJsExpression,
  ast,
  defineRule,
  type JsConditionalExpression,
  registerDiagnostic,
} from '@biomejs/runtime/plugin'

function isLiteral(node: AnyJsExpression | undefined): boolean {
  return (
    node?.kind === 'JS_STRING_LITERAL_EXPRESSION' ||
    node?.kind === 'JS_NUMBER_LITERAL_EXPRESSION' ||
    node?.kind === 'JS_BOOLEAN_LITERAL_EXPRESSION' ||
    node?.kind === 'JS_NULL_LITERAL_EXPRESSION' ||
    node?.kind === 'JS_BIGINT_LITERAL_EXPRESSION' ||
    node?.kind === 'JS_REGEX_LITERAL_EXPRESSION' ||
    (node?.kind === 'JS_TEMPLATE_EXPRESSION' &&
      !node.tag &&
      node.elements.every((item) => item.kind === 'JS_TEMPLATE_CHUNK_ELEMENT'))
  )
}

function comparedValue(node: AnyJsExpression | undefined): string | undefined {
  if (node?.kind !== 'JS_BINARY_EXPRESSION' || !['==', '===', '!=', '!=='].includes(node.operatorToken ?? ''))
    return undefined
  if (isLiteral(node.left)) return node.right?.text
  if (isLiteral(node.right)) return node.left?.text
  return undefined
}

export const preferEffectMatch = defineRule({
  query: ast('JS_CONDITIONAL_EXPRESSION'),
  run(node: JsConditionalExpression): void {
    if (node.parent?.kind === 'JS_CONDITIONAL_EXPRESSION') return
    const value = comparedValue(node.test)
    if (value === undefined) return

    let alternate = node.alternate
    if (alternate?.kind !== 'JS_CONDITIONAL_EXPRESSION') return
    while (alternate?.kind === 'JS_CONDITIONAL_EXPRESSION') {
      if (comparedValue(alternate.test) !== value) return
      alternate = alternate.alternate
    }

    registerDiagnostic(node, 'error', 'Use Match from Effect instead of a chained literal ternary.')
  },
})
