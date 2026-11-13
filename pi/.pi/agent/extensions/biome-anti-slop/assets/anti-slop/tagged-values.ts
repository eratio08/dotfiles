import type { AnyJsAstNode, AnyJsExpression, JsBinaryExpression, JsObjectExpression } from '@biomejs/runtime/plugin'
import { decodeAsciiEscapes, memberTarget } from './shared.ts'

export function tagMember(node: AnyJsExpression | undefined): { name: string; object: AnyJsExpression } | undefined {
  const member = memberTarget(node)
  return member?.name === '_tag' ? member : undefined
}

export function tagComparison(node: JsBinaryExpression): { name: string; object: AnyJsExpression } | undefined {
  if (!['==', '===', '!=', '!=='].includes(node.operatorToken ?? '')) return undefined
  if (node.right?.kind === 'JS_STRING_LITERAL_EXPRESSION') return tagMember(node.left)
  if (node.left?.kind === 'JS_STRING_LITERAL_EXPRESSION') return tagMember(node.right)
  return undefined
}

export function isInsideBroadEffectHandler(node: AnyJsAstNode): boolean {
  const callback = node
    .ancestors()
    .find((parent) => parent.kind === 'JS_ARROW_FUNCTION_EXPRESSION' || parent.kind === 'JS_FUNCTION_EXPRESSION')
  const list = callback?.parent
  const args = list?.kind === 'JS_CALL_ARGUMENT_LIST' ? list.parent : undefined
  const call = args?.kind === 'JS_CALL_ARGUMENTS' ? args.parent : undefined
  if (call?.kind !== 'JS_CALL_EXPRESSION' || call.callee?.kind !== 'JS_STATIC_MEMBER_EXPRESSION') return false
  const callee = memberTarget(call.callee)
  return (
    callee?.object.kind === 'JS_IDENTIFIER_EXPRESSION' &&
    decodeAsciiEscapes(callee.object.name?.text ?? '') === 'Effect' &&
    ['catch', 'catchAll', 'catchIf'].includes(callee.name)
  )
}

export function isMatchPatternObject(node: JsObjectExpression): boolean {
  const list = node.parent
  const args = list?.kind === 'JS_CALL_ARGUMENT_LIST' ? list.parent : undefined
  const call = args?.kind === 'JS_CALL_ARGUMENTS' ? args.parent : undefined
  if (call?.kind !== 'JS_CALL_EXPRESSION' || call.callee?.kind !== 'JS_STATIC_MEMBER_EXPRESSION') return false
  const callee = memberTarget(call.callee)
  return (
    callee?.object.kind === 'JS_IDENTIFIER_EXPRESSION' &&
    decodeAsciiEscapes(callee.object.name?.text ?? '') === 'Match' &&
    (callee.name === 'when' || callee.name === 'not')
  )
}
