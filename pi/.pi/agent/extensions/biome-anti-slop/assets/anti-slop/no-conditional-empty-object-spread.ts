// Checks for object spreads that use a conditional empty object to omit fields.
// It prevents this pattern without changing omission semantics.
import { ast, defineRule, type JsSpread, registerDiagnostic } from '@biomejs/runtime/plugin'
import { isEmptyObject, unwrapExpression } from './shared.ts'

export const conditionalEmptyObjectSpread = defineRule({
  query: ast('JS_SPREAD'),
  run(node: JsSpread): void {
    if (node.parent?.kind !== 'JS_OBJECT_MEMBER_LIST' || node.parent.parent?.kind !== 'JS_OBJECT_EXPRESSION') return
    const argument = unwrapExpression(node.argument)
    if (
      argument?.kind !== 'JS_CONDITIONAL_EXPRESSION' ||
      (!isEmptyObject(argument.consequent) && !isEmptyObject(argument.alternate))
    )
      return
    registerDiagnostic(
      node,
      'error',
      'This conditional spread hides property omission behind an empty object. Build the object in separate statements and add the property only when present.',
    )
  },
})
