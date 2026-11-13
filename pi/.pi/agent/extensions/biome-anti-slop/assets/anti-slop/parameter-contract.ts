import type { AnyJsAstNode, JsFormalParameter, JsRestParameter, TsThisParameter } from '@biomejs/runtime/plugin'
import { decodeAsciiEscapes } from './shared.ts'

export type Parameter = JsFormalParameter | JsRestParameter | TsThisParameter

export function parameterName(node: Parameter): string {
  if (node.kind === 'TS_THIS_PARAMETER') return 'this'
  const binding = node.binding
  return binding?.kind === 'JS_IDENTIFIER_BINDING' ? decodeAsciiEscapes(binding.text) : (binding?.text ?? '')
}

export function predicateSubject(node: Parameter): string | undefined {
  const owner = node
    .ancestors()
    .find(
      (parent) =>
        parent.kind === 'JS_FUNCTION_DECLARATION' ||
        parent.kind === 'JS_FUNCTION_EXPRESSION' ||
        parent.kind === 'JS_ARROW_FUNCTION_EXPRESSION' ||
        parent.kind === 'JS_METHOD_CLASS_MEMBER' ||
        parent.kind === 'JS_METHOD_OBJECT_MEMBER' ||
        parent.kind === 'JS_GETTER_CLASS_MEMBER' ||
        parent.kind === 'JS_GETTER_OBJECT_MEMBER' ||
        parent.kind === 'JS_SETTER_CLASS_MEMBER' ||
        parent.kind === 'JS_SETTER_OBJECT_MEMBER' ||
        parent.kind === 'JS_CONSTRUCTOR_CLASS_MEMBER' ||
        parent.kind === 'TS_DECLARE_FUNCTION_DECLARATION' ||
        parent.kind === 'TS_FUNCTION_TYPE' ||
        parent.kind === 'TS_CONSTRUCTOR_TYPE' ||
        parent.kind === 'TS_CALL_SIGNATURE_TYPE_MEMBER' ||
        parent.kind === 'TS_CONSTRUCT_SIGNATURE_TYPE_MEMBER' ||
        parent.kind === 'TS_METHOD_SIGNATURE_TYPE_MEMBER' ||
        parent.kind === 'TS_CONSTRUCTOR_SIGNATURE_CLASS_MEMBER',
    )
  let result: AnyJsAstNode | undefined
  if (owner?.kind === 'TS_FUNCTION_TYPE') result = owner.returnType
  else if (
    owner?.kind === 'JS_FUNCTION_DECLARATION' ||
    owner?.kind === 'JS_FUNCTION_EXPRESSION' ||
    owner?.kind === 'JS_ARROW_FUNCTION_EXPRESSION' ||
    owner?.kind === 'JS_METHOD_CLASS_MEMBER' ||
    owner?.kind === 'JS_METHOD_OBJECT_MEMBER' ||
    owner?.kind === 'TS_DECLARE_FUNCTION_DECLARATION' ||
    owner?.kind === 'TS_CALL_SIGNATURE_TYPE_MEMBER' ||
    owner?.kind === 'TS_METHOD_SIGNATURE_TYPE_MEMBER'
  )
    result = owner.returnTypeAnnotation?.ty
  if (
    (result?.kind === 'TS_PREDICATE_RETURN_TYPE' || result?.kind === 'TS_ASSERTS_RETURN_TYPE') &&
    result.parameterName?.kind === 'JS_REFERENCE_IDENTIFIER'
  )
    return decodeAsciiEscapes(result.parameterName.text)
  return undefined
}
