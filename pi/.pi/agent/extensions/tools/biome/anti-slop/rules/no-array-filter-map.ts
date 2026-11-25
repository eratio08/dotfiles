// Checks for adjacent array `filter` and `map` passes in either order.
// It prevents multiple eager traversals when one transformation or a lazy iterator can do the work.
import {
  defineRule,
  type JsCallExpression,
  registerDiagnostic,
  type SemanticRuleContext,
  semantic,
} from '@biomejs/runtime/plugin'
import { arrayMethodTarget, isKnownArrayExpression, unwrapArrayExpression } from './array-method.ts'

export const noArrayFilterMap = defineRule({
  query: semantic('JS_CALL_EXPRESSION'),
  run(node: JsCallExpression, context: SemanticRuleContext): void {
    const outer = arrayMethodTarget(node.callee)
    if (!outer || (outer.name !== 'map' && outer.name !== 'filter')) return
    const innerCall = unwrapArrayExpression(outer.object)
    if (innerCall?.kind !== 'JS_CALL_EXPRESSION') return
    const inner = arrayMethodTarget(innerCall.callee)
    if (!inner || inner.name !== (outer.name === 'map' ? 'filter' : 'map')) return
    if (!isKnownArrayExpression(context.model, inner.object)) return
    registerDiagnostic(
      node,
      'error',
      `Avoid consecutive array \`${inner.name}\` and \`${outer.name}\` passes. Prefer \`.values().${inner.name}(...).${outer.name}(...).toArray()\` where iterator helpers are supported, or a single \`flatMap\`/mutating reducer. Preserve callback ordering, indexes, and filtering semantics.`,
    )
  },
})
