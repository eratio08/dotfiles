// Checks calls to the global `Reflect.get` function.
// It prevents untyped property access instead of typed access or parsing dynamic input into a domain type.
import {
  defineRule,
  type JsCallExpression,
  registerDiagnostic,
  type SemanticRuleContext,
} from '@biomejs/runtime/plugin'
import { decodeAsciiEscapes, memberTarget, semantic, unwrapExpression } from './shared.ts'

export const noReflectGet = defineRule({
  query: semantic('JS_CALL_EXPRESSION'),
  run(node: JsCallExpression, ctx: SemanticRuleContext): void {
    const target = memberTarget(unwrapExpression(node.callee))
    const object = unwrapExpression(target?.object)
    if (
      target?.name !== 'get' ||
      object?.kind !== 'JS_IDENTIFIER_EXPRESSION' ||
      !object.name ||
      decodeAsciiEscapes(object.name.valueToken ?? '') !== 'Reflect' ||
      ctx.model.binding(object.name)
    )
      return
    registerDiagnostic(
      node,
      'error',
      'Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.',
    )
  },
})
