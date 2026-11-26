// Checks explicit return types that resolve to `unknown` or a promise of `unknown`.
// It prevents functions from exposing unparsed values as return contracts.
import {
  type AnyTsType,
  defineRule,
  registerDiagnostic,
  type SemanticRuleContext,
  type TsConstructorType,
  type TsFunctionType,
  type TsReturnTypeAnnotation,
  type TsTypeAnnotation,
} from '@biomejs/runtime/plugin'
import { semantic } from './shared.ts'
import { matchesResolvedType } from './widening-types.ts'

function checkReturn(type: AnyTsType | undefined, context: SemanticRuleContext): void {
  if (type && matchesResolvedType(context.model, type, 'unknown-return')) {
    registerDiagnostic(
      type,
      'error',
      'This function exposes `unknown` to its caller. Parse the value at its boundary and return a named domain type.',
    )
  }
}

export const unknownReturnAnnotation = defineRule({
  query: semantic('TS_RETURN_TYPE_ANNOTATION'),
  run(node: TsReturnTypeAnnotation, context: SemanticRuleContext): void {
    const type = node.ty
    if (type?.kind !== 'TS_PREDICATE_RETURN_TYPE' && type?.kind !== 'TS_ASSERTS_RETURN_TYPE') checkReturn(type, context)
  },
})

export const unknownFunctionTypeReturn = defineRule({
  query: semantic('TS_FUNCTION_TYPE'),
  run(node: TsFunctionType, context: SemanticRuleContext): void {
    const type = node.returnType
    if (type?.kind !== 'TS_PREDICATE_RETURN_TYPE' && type?.kind !== 'TS_ASSERTS_RETURN_TYPE') checkReturn(type, context)
  },
})

export const unknownConstructorTypeReturn = defineRule({
  query: semantic('TS_CONSTRUCTOR_TYPE'),
  run(node: TsConstructorType, context: SemanticRuleContext): void {
    checkReturn(node.returnType, context)
  },
})

export const unknownGetterReturn = defineRule({
  query: semantic('TS_TYPE_ANNOTATION'),
  run(node: TsTypeAnnotation, context: SemanticRuleContext): void {
    const owner = node.parent
    if (
      owner?.kind === 'JS_GETTER_CLASS_MEMBER' ||
      owner?.kind === 'JS_GETTER_OBJECT_MEMBER' ||
      owner?.kind === 'TS_GETTER_SIGNATURE_CLASS_MEMBER' ||
      owner?.kind === 'TS_GETTER_SIGNATURE_TYPE_MEMBER' ||
      owner?.kind === 'TS_CONSTRUCT_SIGNATURE_TYPE_MEMBER'
    )
      checkReturn(node.ty, context)
  },
})
