// Checks `_tag` comparisons and switches inside broad Effect catch handlers.
// It prevents manual error branching where Effect tagged handlers can select the error type.
import {
  ast,
  defineRule,
  type JsBinaryExpression,
  type JsSwitchStatement,
  registerDiagnostic,
} from '@biomejs/runtime/plugin'
import { memberTarget } from './shared.ts'
import { isInsideBroadEffectHandler, tagComparison, tagMember } from './tagged-values.ts'

export const manualEffectErrorTag = defineRule({
  query: ast('JS_BINARY_EXPRESSION', 'JS_SWITCH_STATEMENT'),
  run(node: JsBinaryExpression | JsSwitchStatement): void {
    const tag = node.kind === 'JS_BINARY_EXPRESSION' ? tagComparison(node) : tagMember(node.discriminant)
    if (!tag || !isInsideBroadEffectHandler(node)) return
    const reason = memberTarget(tag.object)?.name === 'reason'
    registerDiagnostic(
      node,
      'error',
      reason
        ? 'Use Effect.catchReason or Effect.catchReasons instead of manually discriminating a tagged `reason` in a broad Effect catch handler.'
        : 'Use Effect.catchTag or Effect.catchTags instead of manually discriminating a tagged error in a broad Effect catch handler.',
    )
  },
})
