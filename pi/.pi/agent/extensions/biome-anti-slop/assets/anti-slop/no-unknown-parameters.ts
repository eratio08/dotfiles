// Checks function parameters typed as `unknown` or a union containing it.
// It prevents unknown inputs from escaping an I/O boundary, except `cause` and type-predicate subjects.
import {
  defineRule,
  type JsFormalParameter,
  type JsRestParameter,
  registerDiagnostic,
  semantic,
  type TsThisParameter,
} from '@biomejs/runtime/plugin'
import { type Parameter, parameterName, predicateSubject } from './parameter-contract.ts'
import { containsUnknown } from './shared.ts'

function checkParameter(node: Parameter): void {
  const type = node.typeAnnotation?.ty
  if (!type || !containsUnknown(type)) return
  const name = parameterName(node)
  if (name === 'cause' || predicateSubject(node) === name) return
  registerDiagnostic(
    type,
    'error',
    `Parameter \`${name}\` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.`,
  )
}

export const unknownFormalParameter = defineRule({
  query: semantic('JS_FORMAL_PARAMETER'),
  run(node: JsFormalParameter): void {
    checkParameter(node)
  },
})

export const unknownRestParameter = defineRule({
  query: semantic('JS_REST_PARAMETER'),
  run(node: JsRestParameter): void {
    checkParameter(node)
  },
})

export const unknownThisParameter = defineRule({
  query: semantic('TS_THIS_PARAMETER'),
  run(node: TsThisParameter): void {
    checkParameter(node)
  },
})
