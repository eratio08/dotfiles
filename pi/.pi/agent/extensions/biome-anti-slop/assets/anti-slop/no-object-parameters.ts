// Checks function parameters typed as `object`, including aliases and unions.
// It prevents broad inputs from bypassing owner-defined types and boundary parsing.
import {
  defineRule,
  type JsFormalParameter,
  type JsRestParameter,
  registerDiagnostic,
  type SemanticRuleContext,
  semantic,
  type TsThisParameter,
} from '@biomejs/runtime/plugin'
import { type Parameter, parameterName } from './parameter-contract.ts'
import { matchesResolvedType } from './widening-types.ts'

function checkParameter(node: Parameter, context: SemanticRuleContext): void {
  const type = node.typeAnnotation?.ty
  if (!type || !matchesResolvedType(context.model, type, 'object')) return
  registerDiagnostic(
    type,
    'error',
    `Parameter \`${parameterName(node)}\` uses the broad \`object\` type. Accept a named owner type; parse external input at its boundary before calling this function.`,
  )
}

export const objectFormalParameter = defineRule({
  query: semantic('JS_FORMAL_PARAMETER'),
  run(node: JsFormalParameter, context: SemanticRuleContext): void {
    checkParameter(node, context)
  },
})

export const objectRestParameter = defineRule({
  query: semantic('JS_REST_PARAMETER'),
  run(node: JsRestParameter, context: SemanticRuleContext): void {
    checkParameter(node, context)
  },
})

export const objectThisParameter = defineRule({
  query: semantic('TS_THIS_PARAMETER'),
  run(node: TsThisParameter, context: SemanticRuleContext): void {
    checkParameter(node, context)
  },
})
