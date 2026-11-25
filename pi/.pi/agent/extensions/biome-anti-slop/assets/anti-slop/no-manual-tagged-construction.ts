// Checks object literals with a literal string `_tag`.
// It prevents manual tagged-value construction while allowing direct `Match.when` and `Match.not` patterns.
import {
  type AnyJsAstNode,
  ast,
  defineRule,
  type JsObjectExpression,
  registerDiagnostic,
} from '@biomejs/runtime/plugin'
import { decodeAsciiEscapes, memberTarget } from './shared.ts'
import { isMatchPatternObject } from './tagged-values.ts'

export const manualTaggedConstruction = defineRule({
  query: ast('JS_OBJECT_EXPRESSION'),
  run(node: JsObjectExpression): void {
    if (isMatchPatternObject(node) || isAssertionPatternObject(node)) return
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

function isAssertionPatternObject(node: JsObjectExpression): boolean {
  let pattern: AnyJsAstNode = node
  let parent = pattern.parent
  while (
    parent &&
    [
      'JS_OBJECT_EXPRESSION',
      'JS_OBJECT_MEMBER_LIST',
      'JS_PROPERTY_OBJECT_MEMBER',
      'JS_ARRAY_EXPRESSION',
      'JS_ARRAY_ELEMENT_LIST',
      'JS_PARENTHESIZED_EXPRESSION',
      'TS_AS_EXPRESSION',
      'TS_SATISFIES_EXPRESSION',
    ].includes(parent.kind)
  ) {
    pattern = parent
    parent = parent.parent
  }
  if (parent?.kind !== 'JS_CALL_ARGUMENT_LIST' || parent.parent?.kind !== 'JS_CALL_ARGUMENTS') return false
  const call = parent.parent.parent
  if (call?.kind !== 'JS_CALL_EXPRESSION' || call.arguments?.args.length !== 1) return false
  if (call.arguments.args[0]?.text !== pattern.text) return false
  const matcher = memberTarget(call.callee)
  if (!matcher) return false
  if (matcher.name === 'objectContaining') {
    return matcher.object.kind === 'JS_IDENTIFIER_EXPRESSION' && matcher.object.name?.text === 'expect'
  }
  if (!['toMatchObject', 'toEqual', 'toStrictEqual', 'toContainEqual'].includes(matcher.name)) return false
  let receiver = matcher.object
  while (receiver.kind === 'JS_STATIC_MEMBER_EXPRESSION') {
    const modifier = memberTarget(receiver)
    if (!modifier || !['not', 'rejects', 'resolves'].includes(modifier.name)) return false
    receiver = modifier.object
  }
  return (
    receiver.kind === 'JS_CALL_EXPRESSION' &&
    receiver.callee?.kind === 'JS_IDENTIFIER_EXPRESSION' &&
    receiver.callee.name?.text === 'expect'
  )
}
