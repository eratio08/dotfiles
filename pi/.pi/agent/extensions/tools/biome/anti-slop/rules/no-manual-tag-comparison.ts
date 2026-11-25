// Checks `_tag` comparisons and switches outside broad Effect catch handlers.
// It prevents manual tagged-value branching where Effect Match or Predicate helpers fit.
import {
  ast,
  defineRule,
  type JsBinaryExpression,
  type JsSwitchStatement,
  registerDiagnostic,
} from '@biomejs/runtime/plugin'
import { isInsideBroadEffectHandler, tagComparison, tagMember } from './tagged-values.ts'

export const manualTagComparison = defineRule({
  query: ast('JS_BINARY_EXPRESSION', 'JS_SWITCH_STATEMENT'),
  run(node: JsBinaryExpression | JsSwitchStatement): void {
    const tag = node.kind === 'JS_BINARY_EXPRESSION' ? tagComparison(node) : tagMember(node.discriminant)
    if (!tag || isInsideBroadEffectHandler(node)) return
    registerDiagnostic(
      node,
      'error',
      node.kind === 'JS_BINARY_EXPRESSION'
        ? 'Use Match.tag/Match.tags for tagged-value branching, or Predicate.isTagged for a simple reusable predicate.'
        : 'Use Match.value(value).pipe(Match.tag/Match.tags/Match.tagsExhaustive) or the tagged enum `$match` helper instead of switching on `_tag`.',
    )
  },
})
