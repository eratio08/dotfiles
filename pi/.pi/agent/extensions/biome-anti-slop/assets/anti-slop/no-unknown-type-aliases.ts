// Checks type aliases that resolve to `unknown`.
// It prevents aliases from hiding the unknown type outside allowed boundaries.
import {
  defineRule,
  registerDiagnostic,
  type SemanticRuleContext,
  type TsTypeAliasDeclaration,
} from '@biomejs/runtime/plugin'
import { decodeAsciiEscapes, semantic } from './shared.ts'
import { matchesResolvedType } from './widening-types.ts'

export const unknownTypeAlias = defineRule({
  query: semantic('TS_TYPE_ALIAS_DECLARATION'),
  run(node: TsTypeAliasDeclaration, context: SemanticRuleContext): void {
    if (!node.bindingIdentifier || !matchesResolvedType(context.model, node.ty, 'unknown')) return
    const name = decodeAsciiEscapes(node.bindingIdentifier.text)
    registerDiagnostic(
      node.bindingIdentifier,
      'error',
      `Type alias \`${name}\` hides \`unknown\`. Keep \`unknown\` explicit at the parsing boundary or on an allowed \`cause\` field; otherwise use the parsed owner type.`,
    )
  },
})
