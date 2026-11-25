// Checks function parameters typed as `unknown` or a union containing it.
// It prevents unknown inputs from escaping an I/O boundary, except `cause` and type-predicate subjects.
import {
  type AnyJsExpression,
  defineRule,
  type JsFormalParameter,
  type JsRestParameter,
  registerDiagnostic,
  type SemanticRuleContext,
  semantic,
  type TsThisParameter,
} from '@biomejs/runtime/plugin'
import { type Parameter, parameterName, predicateSubject } from './parameter-contract.ts'
import { containsUnknown, decodeAsciiEscapes, memberTarget, unwrapExpression } from './shared.ts'

function checkParameter(node: Parameter, context: SemanticRuleContext): void {
  const type = node.typeAnnotation?.ty
  if (!type || !containsUnknown(type)) return
  const name = parameterName(node)
  if (name === 'cause' || predicateSubject(node) === name || isSchemaInput(node, context)) return
  registerDiagnostic(
    type,
    'error',
    `Parameter \`${name}\` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.`,
  )
}

export const unknownFormalParameter = defineRule({
  query: semantic('JS_FORMAL_PARAMETER'),
  run(node: JsFormalParameter, context: SemanticRuleContext): void {
    checkParameter(node, context)
  },
})

export const unknownRestParameter = defineRule({
  query: semantic('JS_REST_PARAMETER'),
  run(node: JsRestParameter, context: SemanticRuleContext): void {
    checkParameter(node, context)
  },
})

export const unknownThisParameter = defineRule({
  query: semantic('TS_THIS_PARAMETER'),
  run(node: TsThisParameter, context: SemanticRuleContext): void {
    checkParameter(node, context)
  },
})

function isEffectImport(expression: AnyJsExpression, context: SemanticRuleContext, name: string): boolean {
  const object = unwrapExpression(expression)
  if (object?.kind !== 'JS_IDENTIFIER_EXPRESSION' || !object.name) return false
  const declaration = context.model.binding(object.name)?.syntax().parent
  if (declaration?.kind !== 'JS_NAMED_IMPORT_SPECIFIER' && declaration?.kind !== 'JS_SHORTHAND_NAMED_IMPORT_SPECIFIER')
    return false
  const clause = declaration
    .ancestors()
    .find((parent) => parent.kind === 'JS_IMPORT_NAMED_CLAUSE' || parent.kind === 'JS_IMPORT_COMBINED_CLAUSE')
  if (clause?.kind !== 'JS_IMPORT_NAMED_CLAUSE' && clause?.kind !== 'JS_IMPORT_COMBINED_CLAUSE') return false
  const source = clause.source?.kind === 'JS_MODULE_SOURCE' ? (clause.source.valueToken ?? '') : ''
  const imported =
    declaration.kind === 'JS_NAMED_IMPORT_SPECIFIER' ? declaration.name?.text : declaration.localName?.text
  return decodeAsciiEscapes(source.slice(1, -1)) === 'effect' && decodeAsciiEscapes(imported ?? '') === name
}

function isConcreteSchema(expression: AnyJsExpression | undefined, context: SemanticRuleContext, depth = 0): boolean {
  if (depth > 8) return false
  let schema = unwrapExpression(expression)
  if (schema?.kind === 'JS_IDENTIFIER_EXPRESSION' && schema.name) {
    const binding = context.model.binding(schema.name)
    const declaration = binding?.syntax().parent
    if (!binding || binding.allWrites().length || declaration?.kind !== 'JS_VARIABLE_DECLARATOR') return false
    const variables = declaration.ancestors().find((parent) => parent.kind === 'JS_VARIABLE_DECLARATION')
    if (variables?.kind !== 'JS_VARIABLE_DECLARATION' || variables.kindToken !== 'const') return false
    schema = unwrapExpression(declaration.initializer?.expression)
  }
  if (!schema) return false
  if (schema.kind !== 'JS_CALL_EXPRESSION') {
    const primitive = memberTarget(schema)
    return (
      !!primitive &&
      ['String', 'Number', 'Boolean', 'BigInt', 'Symbol', 'Null', 'Undefined'].includes(primitive.name) &&
      isEffectImport(primitive.object, context, 'Schema')
    )
  }
  const factory = memberTarget(schema.callee)
  if (!factory) return false
  if (factory.name === 'annotate') return isConcreteSchema(factory.object, context, depth + 1)
  if (factory.name === 'pipe') {
    const refinements = schema.arguments?.args ?? []
    return (
      refinements.every((argument) => {
        if (argument.kind !== 'JS_CALL_EXPRESSION') return false
        const refinement = memberTarget(argument.callee)
        return (
          !!refinement &&
          ['check', 'refine'].includes(refinement.name) &&
          isEffectImport(refinement.object, context, 'Schema')
        )
      }) && isConcreteSchema(factory.object, context, depth + 1)
    )
  }
  if (!isEffectImport(factory.object, context, 'Schema')) return false
  if (['Struct', 'TaggedStruct', 'Array', 'Tuple', 'Record', 'Literal', 'Literals'].includes(factory.name)) return true
  const argument = schema.arguments?.args[0]
  if (!argument || argument.kind === 'JS_SPREAD') return false
  if (factory.name === 'Union') {
    const members = unwrapExpression(argument)
    return (
      members?.kind === 'JS_ARRAY_EXPRESSION' &&
      members.elements.length > 0 &&
      members.elements.every(
        (member) =>
          member.kind !== 'JS_SPREAD' &&
          member.kind !== 'JS_ARRAY_HOLE' &&
          isConcreteSchema(member, context, depth + 1),
      )
    )
  }
  if (factory.name === 'UndefinedOr') return isConcreteSchema(argument, context, depth + 1)
  if (factory.name !== 'declare') return false
  const predicate = memberTarget(unwrapExpression(argument))
  if (!predicate) return false
  if (predicate.name === 'isObject' && isEffectImport(predicate.object, context, 'Predicate')) return true
  const object = unwrapExpression(predicate.object)
  return (
    predicate.name === 'isArray' &&
    object?.kind === 'JS_IDENTIFIER_EXPRESSION' &&
    object.name?.text === 'Array' &&
    !context.model.binding(object.name)
  )
}

function isSchemaInput(node: Parameter, context: SemanticRuleContext): boolean {
  if (node.kind !== 'JS_FORMAL_PARAMETER' || node.binding?.kind !== 'JS_IDENTIFIER_BINDING') return false
  const binding = context.model.asBinding(node.binding)
  if (binding?.allReferences().length !== 1 || binding.allWrites().length) return false
  const reference = binding.allReferences()[0]?.syntax().parent
  if (reference?.kind !== 'JS_IDENTIFIER_EXPRESSION') return false
  const list = reference.parent
  const args = list?.kind === 'JS_CALL_ARGUMENT_LIST' ? list.parent : undefined
  const call = args?.kind === 'JS_CALL_ARGUMENTS' ? args.parent : undefined
  if (call?.kind !== 'JS_CALL_EXPRESSION' || call.arguments?.args[0]?.text !== reference.text) return false
  const factory = unwrapExpression(call.callee)
  if (factory?.kind !== 'JS_CALL_EXPRESSION') return false
  const decoder = memberTarget(factory.callee)
  const schema = factory.arguments?.args[0]
  if (!schema || schema.kind === 'JS_SPREAD') return false
  return (
    !!decoder &&
    [
      'decodeUnknownSync',
      'decodeUnknownResult',
      'decodeUnknownOption',
      'decodeUnknownExit',
      'decodeUnknownEffect',
      'decodeUnknownPromise',
    ].includes(decoder.name) &&
    isEffectImport(decoder.object, context, 'Schema') &&
    isConcreteSchema(schema, context)
  )
}
