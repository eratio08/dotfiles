// Checks copies of growing `reduce` or `reduceRight` accumulators made with `Object.assign`, `Array.from`, or array copy methods.
// It prevents repeated copying as values accumulate.
import {
  type AnyJsExpression,
  defineRule,
  type JsCallExpression,
  registerDiagnostic,
  type SemanticRuleContext,
  semantic,
} from '@biomejs/runtime/plugin'
import { arrayMethodTarget, isKnownArrayExpression, unwrapArrayExpression } from './array-method.ts'
import { enclosingReducer, referencesAccumulator } from './reducer.ts'
import { decodeAsciiEscapes } from './shared.ts'

function isGlobalCopyOwner(ctx: SemanticRuleContext, expression: AnyJsExpression, name: string): boolean {
  const node = unwrapArrayExpression(expression)
  return (
    node?.kind === 'JS_IDENTIFIER_EXPRESSION' &&
    node.name !== undefined &&
    decodeAsciiEscapes(node.name.valueToken ?? '') === name &&
    !ctx.model.binding(node.name)
  )
}

export const noReduceAccumulatorCopy = defineRule({
  query: semantic('JS_CALL_EXPRESSION'),
  run(node: JsCallExpression, ctx: SemanticRuleContext): void {
    const method = arrayMethodTarget(node.callee)
    if (!method) return
    const reducer = enclosingReducer(node, ctx.model)
    if (!reducer) return
    const args = node.arguments?.args ?? []
    const isAccumulator = (expression: (typeof args)[number]): boolean =>
      expression.kind !== 'JS_SPREAD' && referencesAccumulator(ctx.model, expression, reducer.accumulator)
    let copies = false
    if (method.name === 'assign' && isGlobalCopyOwner(ctx, method.object, 'Object')) {
      const first = args[0]
      copies =
        first?.kind !== 'JS_SPREAD' &&
        unwrapArrayExpression(first)?.kind === 'JS_OBJECT_EXPRESSION' &&
        args.slice(1).some(isAccumulator)
    } else if (method.name === 'from' && isGlobalCopyOwner(ctx, method.object, 'Array')) {
      copies = args[0] !== undefined && isAccumulator(args[0])
    } else if (['concat', 'slice', 'toSpliced', 'toSorted', 'toReversed', 'with'].includes(method.name)) {
      copies =
        isKnownArrayExpression(ctx.model, reducer.initialValue) &&
        referencesAccumulator(ctx.model, method.object, reducer.accumulator)
    }
    if (copies)
      registerDiagnostic(
        node,
        'error',
        'Do not copy the reducer accumulator on every iteration; growing copies can cause quadratic work. Mutate a fresh, locally owned accumulator and return it, or use an iterator pipeline/flatMap.',
      )
  },
})
