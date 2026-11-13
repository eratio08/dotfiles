// Checks for chained TypeScript `as` or angle-bracket assertions.
// It prevents stacking unchecked claims about one value while allowing chains made only of `const` assertions.
import {
  type AnyJsExpression,
  ast,
  defineRule,
  registerDiagnostic,
  type TsAsExpression,
  type TsTypeAssertionExpression,
} from '@biomejs/runtime/plugin'
import { unwrapExpression } from './shared.ts'

function checkAssertionChain(node: TsAsExpression | TsTypeAssertionExpression): void {
  let parent = node.parent
  while (parent?.kind === 'JS_PARENTHESIZED_EXPRESSION') parent = parent.parent
  if (parent?.kind === 'TS_AS_EXPRESSION' || parent?.kind === 'TS_TYPE_ASSERTION_EXPRESSION') return
  let current: AnyJsExpression | undefined = node
  let count = 0
  let nonConst = false
  while (current?.kind === 'TS_AS_EXPRESSION' || current?.kind === 'TS_TYPE_ASSERTION_EXPRESSION') {
    count++
    if (
      current.ty?.kind !== 'TS_REFERENCE_TYPE' ||
      current.ty.name?.kind !== 'JS_REFERENCE_IDENTIFIER' ||
      current.ty.name.text !== 'const'
    )
      nonConst = true
    current = unwrapExpression(current.expression)
  }
  if (count > 1 && nonConst)
    registerDiagnostic(
      node,
      'error',
      'This assertion chain discards type evidence. Keep the original precise type, or parse untrusted input at its boundary before narrowing it.',
    )
}

export const chainedAsAssertion = defineRule({ query: ast('TS_AS_EXPRESSION'), run: checkAssertionChain })
export const chainedAngleAssertion = defineRule({
  query: ast('TS_TYPE_ASSERTION_EXPRESSION'),
  run: checkAssertionChain,
})
