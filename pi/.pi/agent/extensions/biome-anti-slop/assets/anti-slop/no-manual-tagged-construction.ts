// Checks object literals with a literal string `_tag`.
// It prevents manual tagged-value construction while allowing direct `Match.when` and `Match.not` patterns.
import { ast, defineRule, type JsObjectExpression, registerDiagnostic } from '@biomejs/runtime/plugin'
import { decodeAsciiEscapes } from './shared.ts'
import { isMatchPatternObject } from './tagged-values.ts'

export const manualTaggedConstruction = defineRule({
  query: ast('JS_OBJECT_EXPRESSION'),
  run(node: JsObjectExpression): void {
    if (isMatchPatternObject(node)) return
    const tag = node.members.find((member) => {
      if (member.kind !== 'JS_PROPERTY_OBJECT_MEMBER' || member.value?.kind !== 'JS_STRING_LITERAL_EXPRESSION')
        return false
      const name = member.name
      if (name?.kind === 'JS_COMPUTED_MEMBER_NAME') {
        return (
          name.expression?.kind === 'JS_STRING_LITERAL_EXPRESSION' &&
          decodeAsciiEscapes(name.expression.text.slice(1, -1)) === '_tag'
        )
      }
      if (name?.kind !== 'JS_LITERAL_MEMBER_NAME') return false
      const text = name.text
      return decodeAsciiEscapes(text.startsWith('"') || text.startsWith("'") ? text.slice(1, -1) : text) === '_tag'
    })
    if (tag)
      registerDiagnostic(
        tag,
        'error',
        'Use the existing Schema tagged `.make`, tagged class/error constructor, or Data.taggedEnum variant constructor instead of writing a literal `_tag` object.',
      )
  },
})
