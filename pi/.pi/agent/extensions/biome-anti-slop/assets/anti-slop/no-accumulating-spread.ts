// Checks for array or object spreads that copy a growing accumulator in reducers or loops.
// It prevents repeated copies that can cause quadratic time and memory use.
import {
  type AnyJsAstNode,
  type Binding,
  defineRule,
  type JsSpread,
  registerDiagnostic,
  type SemanticRuleContext,
} from '@biomejs/runtime/plugin'
import { enclosingReducer } from './reducer.ts'
import { bindingKey, semantic } from './shared.ts'

function isLoopAccumulator(node: JsSpread, binding: Binding, context: SemanticRuleContext): boolean {
  const declaration = binding.syntax().parent
  if (declaration?.kind !== 'JS_VARIABLE_DECLARATOR' || declaration.id?.kind !== 'JS_IDENTIFIER_BINDING') return false
  const variables = declaration.ancestors().find((parent) => parent.kind === 'JS_VARIABLE_DECLARATION')
  if (variables?.kind !== 'JS_VARIABLE_DECLARATION' || variables.kindToken !== 'let') return false
  const container = node
    .ancestors()
    .find((parent) => parent.kind === 'JS_ARRAY_EXPRESSION' || parent.kind === 'JS_OBJECT_EXPRESSION')
  if (!container) return false
  let expression: AnyJsAstNode = container
  let parent = expression.parent
  while (
    parent?.kind === 'JS_PARENTHESIZED_EXPRESSION' ||
    parent?.kind === 'TS_AS_EXPRESSION' ||
    parent?.kind === 'TS_TYPE_ASSERTION_EXPRESSION' ||
    parent?.kind === 'TS_NON_NULL_ASSERTION_EXPRESSION' ||
    parent?.kind === 'TS_SATISFIES_EXPRESSION'
  ) {
    expression = parent
    parent = parent.parent
  }
  if (
    parent?.kind !== 'JS_ASSIGNMENT_EXPRESSION' ||
    parent.operatorToken !== '=' ||
    parent.left?.kind !== 'JS_IDENTIFIER_ASSIGNMENT' ||
    parent.right?.text !== expression.text
  )
    return false
  const assigned = context.model.binding(parent.left)
  if (!assigned || bindingKey(assigned) !== bindingKey(binding)) return false
  const loops = parent
    .ancestors()
    .filter(
      (ancestor) =>
        ancestor.kind === 'JS_FOR_STATEMENT' ||
        ancestor.kind === 'JS_FOR_IN_STATEMENT' ||
        ancestor.kind === 'JS_FOR_OF_STATEMENT' ||
        ancestor.kind === 'JS_WHILE_STATEMENT' ||
        ancestor.kind === 'JS_DO_WHILE_STATEMENT',
    )
  const declarationAncestors = declaration.ancestors()
  return loops.some(
    (loop) => !declarationAncestors.some((ancestor) => ancestor.kind === loop.kind && ancestor.text === loop.text),
  )
}

export const noAccumulatingSpread = defineRule({
  query: semantic('JS_SPREAD'),
  run(node: JsSpread, context: SemanticRuleContext): void {
    if (node.argument?.kind !== 'JS_IDENTIFIER_EXPRESSION' || !node.argument.name) return
    const binding = context.model.binding(node.argument.name)
    if (!binding) return
    const reducer = enclosingReducer(node, context.model, 'first-or-second')
    if (reducer?.parameterCount === 2 && bindingKey(reducer.accumulator) === bindingKey(binding)) {
      registerDiagnostic(
        node,
        'error',
        'Do not spread accumulators in Array.prototype.reduce(). Growing copies can cause quadratic work.',
      )
    } else if (isLoopAccumulator(node, binding, context)) {
      registerDiagnostic(node, 'error', 'Do not spread accumulators in loops. Growing copies can cause quadratic work.')
    }
  },
})
