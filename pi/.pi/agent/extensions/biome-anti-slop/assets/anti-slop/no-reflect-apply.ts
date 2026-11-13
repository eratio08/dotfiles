// Checks calls to the global `Reflect.apply` function.
// It prevents calls that bypass ordinary typed function calls and favors named interfaces for dynamic dispatch.
import {
  defineRule,
  type JsCallExpression,
  registerDiagnostic,
  type SemanticRuleContext,
  semantic,
} from '@biomejs/runtime/plugin'
import { decodeAsciiEscapes, memberTarget, unwrapExpression } from './shared.ts'

export const noReflectApply = defineRule({
  query: semantic('JS_CALL_EXPRESSION'),
  run(node: JsCallExpression, ctx: SemanticRuleContext): void {
    const target = memberTarget(unwrapExpression(node.callee))
    const object = unwrapExpression(target?.object)
    if (
      target?.name !== 'apply' ||
      object?.kind !== 'JS_IDENTIFIER_EXPRESSION' ||
      !object.name ||
      decodeAsciiEscapes(object.name.valueToken ?? '') !== 'Reflect' ||
      ctx.model.binding(object.name)
    )
      return
    registerDiagnostic(
      node,
      'error',
      'Replace `Reflect.apply` with a typed function call. Model dynamic dispatch behind a named interface.',
    )
  },
})
