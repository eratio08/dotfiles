// Checks cases where a known value flows into an explicit broad or anonymous type that discards useful evidence.
// It prevents avoidable type widening.
import {
  type AnyJsAstNode,
  type AnyJsExpression,
  type AnyTsType,
  defineRule,
  type JsArrowFunctionExpression,
  type JsAssignmentExpression,
  type JsCallExpression,
  type JsFunctionDeclaration,
  type JsFunctionExpression,
  type JsPropertyClassMember,
  type JsReturnStatement,
  type JsVariableDeclarator,
  registerDiagnostic,
  type SemanticRuleContext,
  semantic,
  type TsAsExpression,
  type TsDeclareFunctionDeclaration,
  type TsTypeAssertionExpression,
} from '@biomejs/runtime/plugin'
import { unwrapArrayExpression } from './array-method.ts'
import { bindingKey, containsUnknown, decodeAsciiEscapes, isEmptyObject } from './shared.ts'
import { classifyWideningTarget, isUnsafeValueType } from './widening-types.ts'

type LocalFunction =
  | JsFunctionDeclaration
  | JsFunctionExpression
  | JsArrowFunctionExpression
  | TsDeclareFunctionDeclaration
type Assertion = TsAsExpression | TsTypeAssertionExpression

function knownValue(
  ctx: SemanticRuleContext,
  expression: AnyJsExpression | undefined,
  visited = new Set<string>(),
): boolean {
  const node = unwrapArrayExpression(expression)
  if (!node) return false
  if (
    node.kind.endsWith('_LITERAL_EXPRESSION') ||
    node.kind === 'JS_TEMPLATE_EXPRESSION' ||
    node.kind === 'JS_ARRAY_EXPRESSION' ||
    node.kind === 'JS_OBJECT_EXPRESSION' ||
    node.kind === 'JS_ARROW_FUNCTION_EXPRESSION' ||
    node.kind === 'JS_CLASS_EXPRESSION' ||
    node.kind === 'JS_FUNCTION_EXPRESSION' ||
    node.kind === 'JS_NEW_EXPRESSION' ||
    node.kind === 'JS_UNARY_EXPRESSION'
  )
    return true
  if (node.kind !== 'JS_IDENTIFIER_EXPRESSION' || !node.name) return false
  const binding = ctx.model.binding(node.name)
  if (!binding || binding.allWrites().length) return false
  const key = bindingKey(binding)
  if (visited.has(key)) return false
  visited.add(key)
  const declaration = binding.syntax().parent
  if (declaration?.kind !== 'JS_VARIABLE_DECLARATOR' || declaration.id?.kind !== 'JS_IDENTIFIER_BINDING') return false
  const variables = declaration.ancestors().find((parent) => parent.kind === 'JS_VARIABLE_DECLARATION')
  if (variables?.kind !== 'JS_VARIABLE_DECLARATION' || variables.kindToken !== 'const') return false
  return knownValue(ctx, declaration.initializer?.expression, visited)
}

function sameBoundTypeReference(
  ctx: SemanticRuleContext,
  source: AnyTsType | undefined,
  target: AnyTsType | undefined,
): boolean {
  if (
    source?.kind !== 'TS_REFERENCE_TYPE' ||
    target?.kind !== 'TS_REFERENCE_TYPE' ||
    source.name?.kind !== 'JS_REFERENCE_IDENTIFIER' ||
    target.name?.kind !== 'JS_REFERENCE_IDENTIFIER' ||
    source.typeArguments?.tsTypeArgumentList.length ||
    target.typeArguments?.tsTypeArgumentList.length
  )
    return false

  const sourceBinding = ctx.model.binding(source.name)
  const targetBinding = ctx.model.binding(target.name)
  return (
    sourceBinding !== undefined &&
    targetBinding !== undefined &&
    bindingKey(sourceBinding) === bindingKey(targetBinding)
  )
}

function reportFlow(
  ctx: SemanticRuleContext,
  expression: AnyJsExpression | undefined,
  type: AnyTsType | undefined,
  subject: string,
): void {
  if (!expression) return
  const target = classifyWideningTarget(ctx.model, type)
  if (!target) return
  const unwrapped = unwrapArrayExpression(expression)
  if ((target === 'open dictionary' || target === 'generic container') && isEmptyObject(unwrapped)) return
  if (unwrapped?.kind === 'JS_IDENTIFIER_EXPRESSION' && unwrapped.name) {
    const declaration = ctx.model.binding(unwrapped.name)?.syntax().parent
    const sourceType =
      declaration?.kind === 'JS_VARIABLE_DECLARATOR' ? annotationType(declaration.variableAnnotation) : undefined
    if (sameBoundTypeReference(ctx, sourceType, type)) return
  }
  if (!knownValue(ctx, expression)) return
  registerDiagnostic(
    expression,
    'error',
    `The explicit ${target} type on ${subject} discards known type evidence. Keep inference, validate with \`satisfies\`, or use a named owner contract.`,
  )
}

function annotationType(
  annotation: JsVariableDeclarator['variableAnnotation'] | JsPropertyClassMember['propertyAnnotation'],
): AnyTsType | undefined {
  if (annotation?.kind === 'TS_TYPE_ANNOTATION') return annotation.ty
  return annotation?.typeAnnotation?.ty
}

function returnType(node: AnyJsAstNode): AnyTsType | undefined {
  if (node.kind === 'JS_GETTER_CLASS_MEMBER' || node.kind === 'JS_GETTER_OBJECT_MEMBER') return node.returnType?.ty
  if (
    node.kind !== 'JS_FUNCTION_DECLARATION' &&
    node.kind !== 'JS_FUNCTION_EXPRESSION' &&
    node.kind !== 'JS_ARROW_FUNCTION_EXPRESSION' &&
    node.kind !== 'JS_METHOD_CLASS_MEMBER' &&
    node.kind !== 'JS_METHOD_OBJECT_MEMBER' &&
    node.kind !== 'TS_DECLARE_FUNCTION_DECLARATION'
  )
    return undefined
  const type = node.returnTypeAnnotation?.ty
  return type?.kind === 'TS_PREDICATE_RETURN_TYPE' || type?.kind === 'TS_ASSERTS_RETURN_TYPE' ? undefined : type
}

function functionName(node: AnyJsAstNode): string {
  if (
    (node.kind === 'JS_FUNCTION_DECLARATION' ||
      node.kind === 'JS_FUNCTION_EXPRESSION' ||
      node.kind === 'TS_DECLARE_FUNCTION_DECLARATION') &&
    node.id
  )
    return decodeAsciiEscapes(node.id.text)
  const parent = node.parent
  if (parent?.kind === 'JS_INITIALIZER_CLAUSE' && parent.parent?.kind === 'JS_VARIABLE_DECLARATOR')
    return decodeAsciiEscapes(parent.parent.id?.text ?? 'anonymous function')
  if (node.kind === 'JS_METHOD_CLASS_MEMBER' || node.kind === 'JS_METHOD_OBJECT_MEMBER')
    return node.name?.text ?? 'anonymous function'
  return 'anonymous function'
}

function localFunction(ctx: SemanticRuleContext, expression: AnyJsExpression | undefined): LocalFunction | undefined {
  const node = unwrapArrayExpression(expression)
  if (node?.kind === 'JS_ARROW_FUNCTION_EXPRESSION' || node?.kind === 'JS_FUNCTION_EXPRESSION') return node
  if (node?.kind !== 'JS_IDENTIFIER_EXPRESSION' || !node.name) return undefined
  const declaration = ctx.model.binding(node.name)?.syntax().parent
  if (declaration?.kind === 'JS_FUNCTION_DECLARATION' || declaration?.kind === 'TS_DECLARE_FUNCTION_DECLARATION')
    return declaration
  if (declaration?.kind !== 'JS_VARIABLE_DECLARATOR') return undefined
  const initial = unwrapArrayExpression(declaration.initializer?.expression)
  return initial?.kind === 'JS_ARROW_FUNCTION_EXPRESSION' || initial?.kind === 'JS_FUNCTION_EXPRESSION'
    ? initial
    : undefined
}

function knownCallArgument(
  ctx: SemanticRuleContext,
  expression: AnyJsExpression | undefined,
  visited = new Set<string>(),
): boolean {
  let node = expression
  while (
    node?.kind === 'JS_PARENTHESIZED_EXPRESSION' ||
    node?.kind === 'TS_NON_NULL_ASSERTION_EXPRESSION' ||
    node?.kind === 'TS_SATISFIES_EXPRESSION'
  )
    node = node.expression
  if (!node) return false
  if (node.kind === 'TS_AS_EXPRESSION' || node.kind === 'TS_TYPE_ASSERTION_EXPRESSION')
    return node.ty !== undefined && !isUnsafeValueType(ctx.model, node.ty)
  if (node.kind === 'JS_CALL_EXPRESSION') {
    const owner = localFunction(ctx, node.callee)
    const type = owner && returnType(owner)
    return type !== undefined && !isUnsafeValueType(ctx.model, type)
  }
  if (node.kind !== 'JS_IDENTIFIER_EXPRESSION' || !node.name) return knownValue(ctx, node)
  const binding = ctx.model.binding(node.name)
  if (!binding) return false
  const key = bindingKey(binding)
  if (visited.has(key)) return false
  visited.add(key)
  const declaration = binding.syntax().parent
  let type: AnyTsType | undefined
  if (declaration?.kind === 'JS_FORMAL_PARAMETER') {
    type = declaration.typeAnnotation?.ty
  } else if (declaration?.kind === 'JS_VARIABLE_DECLARATOR') {
    type = annotationType(declaration.variableAnnotation)
  }
  if (type) return !isUnsafeValueType(ctx.model, type)
  if (
    declaration?.kind !== 'JS_VARIABLE_DECLARATOR' ||
    declaration.id?.kind !== 'JS_IDENTIFIER_BINDING' ||
    binding.allWrites().length
  )
    return false
  const variables = declaration.ancestors().find((parent) => parent.kind === 'JS_VARIABLE_DECLARATION')
  if (variables?.kind !== 'JS_VARIABLE_DECLARATION' || variables.kindToken !== 'const') return false
  return knownCallArgument(ctx, declaration.initializer?.expression, visited)
}

export const wideningVariable = defineRule({
  query: semantic('JS_VARIABLE_DECLARATOR'),
  run(node: JsVariableDeclarator, ctx: SemanticRuleContext): void {
    if (node.id?.kind === 'JS_IDENTIFIER_BINDING')
      reportFlow(
        ctx,
        node.initializer?.expression,
        annotationType(node.variableAnnotation),
        `binding \`${decodeAsciiEscapes(node.id.text)}\``,
      )
  },
})

export const wideningProperty = defineRule({
  query: semantic('JS_PROPERTY_CLASS_MEMBER'),
  run(node: JsPropertyClassMember, ctx: SemanticRuleContext): void {
    reportFlow(
      ctx,
      node.value?.expression,
      annotationType(node.propertyAnnotation),
      `property \`${node.name?.text ?? ''}\``,
    )
  },
})

export const wideningAssignment = defineRule({
  query: semantic('JS_ASSIGNMENT_EXPRESSION'),
  run(node: JsAssignmentExpression, ctx: SemanticRuleContext): void {
    if (node.operatorToken !== '=' || node.left?.kind !== 'JS_IDENTIFIER_ASSIGNMENT') return
    const declaration = ctx.model.binding(node.left)?.syntax().parent
    if (declaration?.kind === 'JS_VARIABLE_DECLARATOR' && declaration.id?.kind === 'JS_IDENTIFIER_BINDING') {
      reportFlow(
        ctx,
        node.right,
        annotationType(declaration.variableAnnotation),
        `binding \`${decodeAsciiEscapes(declaration.id.text)}\``,
      )
    }
  },
})

export const wideningReturn = defineRule({
  query: semantic('JS_RETURN_STATEMENT'),
  run(node: JsReturnStatement, ctx: SemanticRuleContext): void {
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
          parent.kind === 'JS_CONSTRUCTOR_CLASS_MEMBER',
      )
    if (owner) reportFlow(ctx, node.argument, returnType(owner), `return value of \`${functionName(owner)}\``)
  },
})

export const wideningArrow = defineRule({
  query: semantic('JS_ARROW_FUNCTION_EXPRESSION'),
  run(node: JsArrowFunctionExpression, ctx: SemanticRuleContext): void {
    if (node.body && node.body.kind !== 'JS_FUNCTION_BODY')
      reportFlow(ctx, node.body, returnType(node), `return value of \`${functionName(node)}\``)
  },
})

function reportAssertion(node: Assertion, ctx: SemanticRuleContext): void {
  let parent = node.parent
  while (parent?.kind === 'JS_PARENTHESIZED_EXPRESSION') parent = parent.parent
  if (parent?.kind === 'TS_AS_EXPRESSION' || parent?.kind === 'TS_TYPE_ASSERTION_EXPRESSION') return
  reportFlow(ctx, node.expression, node.ty, 'assertion')
}

export const wideningAs = defineRule({
  query: semantic('TS_AS_EXPRESSION'),
  run(node: TsAsExpression, ctx: SemanticRuleContext): void {
    reportAssertion(node, ctx)
  },
})

export const wideningAngle = defineRule({
  query: semantic('TS_TYPE_ASSERTION_EXPRESSION'),
  run(node: TsTypeAssertionExpression, ctx: SemanticRuleContext): void {
    reportAssertion(node, ctx)
  },
})

export const wideningPredicateArgument = defineRule({
  query: semantic('JS_CALL_EXPRESSION'),
  run(node: JsCallExpression, ctx: SemanticRuleContext): void {
    const owner = localFunction(ctx, node.callee)
    const predicate = owner?.returnTypeAnnotation?.ty
    if (
      !owner ||
      predicate?.kind !== 'TS_PREDICATE_RETURN_TYPE' ||
      predicate.parameterName?.kind !== 'JS_REFERENCE_IDENTIFIER'
    )
      return
    const parameters = owner.parameters
    const list = parameters?.kind === 'JS_PARAMETERS' ? parameters.items : parameters ? [parameters] : []
    const index = list.findIndex(
      (parameter) =>
        parameter.kind === 'JS_FORMAL_PARAMETER' && parameter.binding?.text === predicate.parameterName?.text,
    )
    const parameter = list[index]
    const argument = node.arguments?.args[index]
    if (
      parameter?.kind !== 'JS_FORMAL_PARAMETER' ||
      !containsUnknown(parameter.typeAnnotation?.ty) ||
      !argument ||
      argument.kind === 'JS_SPREAD' ||
      !knownCallArgument(ctx, argument)
    )
      return
    const subject = `argument for parameter \`${parameter.binding?.text ?? ''}\` of \`${functionName(owner)}\``
    registerDiagnostic(
      argument,
      'error',
      `The explicit unknown type on ${subject} discards known type evidence. Keep inference, validate with \`satisfies\`, or use a named owner contract.`,
    )
  },
})
