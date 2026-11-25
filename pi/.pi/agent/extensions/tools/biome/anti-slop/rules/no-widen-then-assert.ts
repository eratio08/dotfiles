// Checks local const values widened to a broad type and later narrowed with an assertion.
// It prevents erasing and then re-asserting known type evidence.
import {
  type AnyJsAstNode,
  type AnyJsExpression,
  type AnyTsType,
  type Binding,
  defineRule,
  registerDiagnostic,
  type SemanticRuleContext,
  semantic,
  type TsAsExpression,
  type TsTypeAssertionExpression,
} from '@biomejs/runtime/plugin'
import { bindingKey, decodeAsciiEscapes, unwrapExpression } from './shared.ts'

type BroadTypeKind = 'top' | 'object' | 'record'
type KnownEvidence = { type: AnyTsType | undefined }
type Assertion = TsAsExpression | TsTypeAssertionExpression

function unwrapType(type: AnyTsType | undefined): AnyTsType | undefined {
  while (type?.kind === 'TS_PARENTHESIZED_TYPE') type = type.ty
  return type
}

function isUnknownOrAny(type: AnyTsType | undefined): boolean {
  const kind = unwrapType(type)?.kind
  return kind === 'TS_UNKNOWN_TYPE' || kind === 'TS_ANY_TYPE'
}

function isBroadRecordKey(type: AnyTsType | undefined): boolean {
  type = unwrapType(type)
  if (type?.kind === 'TS_STRING_TYPE' || type?.kind === 'TS_NUMBER_TYPE' || type?.kind === 'TS_SYMBOL_TYPE') return true
  if (type?.kind === 'TS_UNION_TYPE') return type.types.every(isBroadRecordKey)
  return type?.kind === 'TS_REFERENCE_TYPE' && type.name?.text === 'PropertyKey'
}

function isBroadRecord(type: AnyTsType | undefined): boolean {
  type = unwrapType(type)
  if (type?.kind === 'TS_REFERENCE_TYPE') {
    const args = type.typeArguments?.tsTypeArgumentList ?? []
    if (type.name?.text === 'Readonly') return isBroadRecord(args[0])
    return type.name?.text === 'Record' && args.length === 2 && isBroadRecordKey(args[0]) && isUnknownOrAny(args[1])
  }
  if (type?.kind !== 'TS_OBJECT_TYPE' || type.members.length !== 1) return false
  const member = type.members[0]
  return (
    member?.kind === 'TS_INDEX_SIGNATURE_TYPE_MEMBER' &&
    isBroadRecordKey(member.parameter?.typeAnnotation?.ty) &&
    isUnknownOrAny(member.typeAnnotation?.ty)
  )
}

function broadTypeKind(type: AnyTsType | undefined): BroadTypeKind | undefined {
  const kind = unwrapType(type)?.kind
  if (kind === 'TS_UNKNOWN_TYPE' || kind === 'TS_ANY_TYPE') return 'top'
  if (kind === 'TS_NON_PRIMITIVE_TYPE') return 'object'
  return isBroadRecord(type) ? 'record' : undefined
}

function definitelyObject(type: AnyTsType | undefined): boolean {
  type = unwrapType(type)
  if (!type) return false
  if (
    [
      'TS_ARRAY_TYPE',
      'TS_CONSTRUCTOR_TYPE',
      'TS_FUNCTION_TYPE',
      'TS_MAPPED_TYPE',
      'TS_NON_PRIMITIVE_TYPE',
      'TS_TUPLE_TYPE',
    ].includes(type.kind)
  )
    return true
  if (type.kind === 'TS_OBJECT_TYPE') return type.members.length > 0
  if (type.kind === 'TS_INTERSECTION_TYPE') return type.types.every(definitelyObject)
  return type.kind === 'TS_TYPE_OPERATOR_TYPE' && type.operatorToken === 'readonly' && definitelyObject(type.ty)
}

function narrowerRecord(type: AnyTsType | undefined): boolean {
  type = unwrapType(type)
  if (type?.kind === 'TS_OBJECT_TYPE')
    return type.members.some((member) => member.kind !== 'TS_INDEX_SIGNATURE_TYPE_MEMBER')
  if (type?.kind !== 'TS_REFERENCE_TYPE') return false
  const args = type.typeArguments?.tsTypeArgumentList ?? []
  if (type.name?.text === 'Readonly') return narrowerRecord(args[0])
  return type.name?.text === 'Record' && args.length === 2 && args[1] !== undefined && !isUnknownOrAny(args[1])
}

function functionBoundary(node: AnyJsAstNode): string {
  const boundary = node
    .ancestors()
    .find(
      (parent) =>
        parent.kind === 'JS_ARROW_FUNCTION_EXPRESSION' ||
        parent.kind === 'JS_FUNCTION_DECLARATION' ||
        parent.kind === 'JS_FUNCTION_EXPRESSION' ||
        parent.kind === 'TS_DECLARE_FUNCTION_DECLARATION' ||
        parent.kind === 'TS_DECLARE_FUNCTION_EXPORT_DEFAULT_DECLARATION' ||
        parent.kind === 'JS_METHOD_CLASS_MEMBER' ||
        parent.kind === 'JS_METHOD_OBJECT_MEMBER' ||
        parent.kind === 'JS_GETTER_CLASS_MEMBER' ||
        parent.kind === 'JS_GETTER_OBJECT_MEMBER' ||
        parent.kind === 'JS_SETTER_CLASS_MEMBER' ||
        parent.kind === 'JS_SETTER_OBJECT_MEMBER' ||
        parent.kind === 'JS_CONSTRUCTOR_CLASS_MEMBER',
    )
  return boundary ? `${boundary.kind}\0${boundary.text}` : ''
}

function knownEvidence(
  ctx: SemanticRuleContext,
  expression: AnyJsExpression | undefined,
  boundary: string,
  visited: Set<string>,
): KnownEvidence | undefined {
  const node = unwrapExpression(expression)
  if (!node) return undefined
  if (node.kind === 'TS_AS_EXPRESSION' || node.kind === 'TS_TYPE_ASSERTION_EXPRESSION') {
    return node.ty && !broadTypeKind(node.ty) ? { type: node.ty } : undefined
  }
  if (
    node.kind.endsWith('_LITERAL_EXPRESSION') ||
    node.kind === 'JS_TEMPLATE_EXPRESSION' ||
    node.kind === 'JS_ARRAY_EXPRESSION' ||
    node.kind === 'JS_ARROW_FUNCTION_EXPRESSION' ||
    node.kind === 'JS_CLASS_EXPRESSION' ||
    node.kind === 'JS_FUNCTION_EXPRESSION' ||
    node.kind === 'JS_NEW_EXPRESSION' ||
    node.kind === 'JS_OBJECT_EXPRESSION'
  )
    return { type: undefined }
  if (node.kind !== 'JS_IDENTIFIER_EXPRESSION' || !node.name) return undefined
  const binding = ctx.model.binding(node.name)
  if (!binding) return undefined
  const key = bindingKey(binding)
  if (visited.has(key)) return undefined
  visited.add(key)
  const declaration = binding.syntax().parent
  if (functionBoundary(binding.syntax()) !== boundary) return undefined
  const annotation =
    declaration?.kind === 'JS_FORMAL_PARAMETER'
      ? declaration.typeAnnotation
      : declaration?.kind === 'JS_VARIABLE_DECLARATOR'
        ? declaration.variableAnnotation
        : undefined
  const type =
    annotation?.kind === 'TS_TYPE_ANNOTATION'
      ? annotation.ty
      : annotation?.kind === 'TS_DEFINITE_VARIABLE_ANNOTATION'
        ? annotation.typeAnnotation?.ty
        : undefined
  if (type) return broadTypeKind(type) ? undefined : { type }
  if (
    declaration?.kind !== 'JS_VARIABLE_DECLARATOR' ||
    declaration.id?.kind !== 'JS_IDENTIFIER_BINDING' ||
    binding.allWrites().length
  )
    return undefined
  const variables = declaration.ancestors().find((parent) => parent.kind === 'JS_VARIABLE_DECLARATION')
  if (variables?.kind !== 'JS_VARIABLE_DECLARATION' || variables.kindToken !== 'const') return undefined
  return knownEvidence(ctx, declaration.initializer?.expression, boundary, visited)
}

function widenedBinding(
  ctx: SemanticRuleContext,
  binding: Binding,
): { kind: BroadTypeKind; evidence: KnownEvidence; declaration: AnyJsAstNode; boundary: string } | undefined {
  const declaration = binding.syntax().parent
  if (
    declaration?.kind !== 'JS_VARIABLE_DECLARATOR' ||
    declaration.id?.kind !== 'JS_IDENTIFIER_BINDING' ||
    !declaration.initializer?.expression ||
    binding.allWrites().length
  )
    return undefined
  const variables = declaration.ancestors().find((parent) => parent.kind === 'JS_VARIABLE_DECLARATION')
  if (variables?.kind !== 'JS_VARIABLE_DECLARATION' || variables.kindToken !== 'const') return undefined
  const annotation = declaration.variableAnnotation
  const declaredType = annotation?.kind === 'TS_TYPE_ANNOTATION' ? annotation.ty : undefined
  const initial = unwrapExpression(declaration.initializer.expression)
  const assertion =
    initial?.kind === 'TS_AS_EXPRESSION' || initial?.kind === 'TS_TYPE_ASSERTION_EXPRESSION' ? initial : undefined
  const initialKind = broadTypeKind(assertion?.ty)
  const kind = broadTypeKind(declaredType) ?? initialKind
  if (!kind) return undefined
  const boundary = functionBoundary(declaration)
  const evidence = knownEvidence(
    ctx,
    assertion && initialKind ? assertion.expression : declaration.initializer.expression,
    boundary,
    new Set([bindingKey(binding)]),
  )
  return evidence ? { kind, evidence, declaration, boundary } : undefined
}

function followsDeclaration(assertion: Assertion, declaration: AnyJsAstNode): boolean {
  const root = assertion.ancestors().at(-1)
  if (!root) return false
  const source = root.text
  const declaredAt = source.lastIndexOf(declaration.text)
  const assertedAt = source.indexOf(assertion.text)
  return declaredAt >= 0 && assertedAt >= declaredAt + declaration.text.length
}

function checkAssertion(node: Assertion, ctx: SemanticRuleContext): void {
  const expression = unwrapExpression(node.expression)
  if (expression?.kind !== 'JS_IDENTIFIER_EXPRESSION' || !expression.name || !node.ty) return
  const binding = ctx.model.binding(expression.name)
  if (!binding) return
  const widened = widenedBinding(ctx, binding)
  if (!widened || widened.boundary !== functionBoundary(node) || !followsDeclaration(node, widened.declaration)) return
  const asserted = unwrapType(node.ty)
  if (!asserted || broadTypeKind(asserted)) return
  const original = unwrapType(widened.evidence.type)
  const sameType = original && original.text.replace(/\s+/g, '') === asserted.text.replace(/\s+/g, '')
  if (
    widened.kind !== 'top' &&
    !sameType &&
    (widened.kind === 'object' ? !definitelyObject(asserted) : !narrowerRecord(asserted))
  )
    return
  const name = decodeAsciiEscapes(expression.name.valueToken ?? '')
  registerDiagnostic(
    node,
    'error',
    `Binding "${name}" discards type evidence and later recreates it with an assertion. Keep the precise type from initialization through use; parse boundary input once.`,
  )
}

export const noWidenThenAssertAs = defineRule({
  query: semantic('TS_AS_EXPRESSION'),
  run(node: TsAsExpression, context: SemanticRuleContext): void {
    checkAssertion(node, context)
  },
})

export const noWidenThenAssertAngle = defineRule({
  query: semantic('TS_TYPE_ASSERTION_EXPRESSION'),
  run(node: TsTypeAssertionExpression, context: SemanticRuleContext): void {
    checkAssertion(node, context)
  },
})
