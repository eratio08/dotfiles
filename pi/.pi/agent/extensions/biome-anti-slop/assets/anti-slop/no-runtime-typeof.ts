// Checks runtime `typeof` expressions.
// It prevents using them instead of decoding external values at I/O boundaries, except for `undefined` checks and enabled type-guard cases.
import { ast, defineRule, type JsUnaryExpression, registerDiagnostic } from '@biomejs/runtime/plugin'
import { decodeAsciiEscapes, unwrapExpression } from './shared.ts'

const allowInTypeGuards = false

function isExistenceProbe(node: JsUnaryExpression): boolean {
  let parent = node.parent
  while (parent?.kind === 'JS_PARENTHESIZED_EXPRESSION') parent = parent.parent
  if (parent?.kind !== 'JS_BINARY_EXPRESSION' || !['===', '!==', '==', '!='].includes(parent.operatorToken ?? ''))
    return false
  const left = unwrapExpression(parent.left)
  const right = unwrapExpression(parent.right)
  const other = left?.kind === 'JS_STRING_LITERAL_EXPRESSION' ? left : right
  return (
    other?.kind === 'JS_STRING_LITERAL_EXPRESSION' &&
    decodeAsciiEscapes((other.valueToken ?? '').slice(1, -1)) === 'undefined'
  )
}

function isInsideTypeGuard(node: JsUnaryExpression): boolean {
  for (const parent of node.ancestors()) {
    if (
      parent.kind === 'JS_FUNCTION_DECLARATION' ||
      parent.kind === 'JS_FUNCTION_EXPRESSION' ||
      parent.kind === 'JS_FUNCTION_EXPORT_DEFAULT_DECLARATION' ||
      parent.kind === 'JS_ARROW_FUNCTION_EXPRESSION' ||
      parent.kind === 'JS_METHOD_CLASS_MEMBER' ||
      parent.kind === 'JS_METHOD_OBJECT_MEMBER'
    ) {
      const type = parent.returnTypeAnnotation?.ty?.kind
      return type === 'TS_PREDICATE_RETURN_TYPE' || type === 'TS_ASSERTS_RETURN_TYPE'
    }
    if (
      parent.kind === 'JS_GETTER_CLASS_MEMBER' ||
      parent.kind === 'JS_GETTER_OBJECT_MEMBER' ||
      parent.kind === 'JS_SETTER_CLASS_MEMBER' ||
      parent.kind === 'JS_SETTER_OBJECT_MEMBER' ||
      parent.kind === 'JS_CONSTRUCTOR_CLASS_MEMBER'
    )
      return false
  }
  return false
}

export const noRuntimeTypeof = defineRule({
  query: ast('JS_UNARY_EXPRESSION'),
  run(node: JsUnaryExpression): void {
    if (node.operatorToken !== 'typeof' || isExistenceProbe(node) || (allowInTypeGuards && isInsideTypeGuard(node)))
      return
    registerDiagnostic(
      node,
      'error',
      'A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.',
    )
  },
})
