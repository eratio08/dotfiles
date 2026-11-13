import { defineRule, registerDiagnostic, semantic, type AnyTsType, type SemanticRuleContext, type TsIndexSignatureClassMember, type TsIndexSignatureTypeMember, type TsMappedType, type TsObjectType, type TsReferenceType } from "@biomejs/runtime/plugin";
import { isUnsafeValueType, unsafeDictionaryValue } from "./widening-types.ts";

type DictionaryType = TsReferenceType | TsObjectType | TsMappedType;

function reportDictionary(node: DictionaryType, ctx: SemanticRuleContext): void {
  if (node.ancestors().some(parent => parent.kind === "TS_TYPE_CONSTRAINT_CLAUSE")) return;
  if (node.kind === "TS_REFERENCE_TYPE" && !node.typeArguments?.tsTypeArgumentList.length &&
    node.name?.kind === "JS_REFERENCE_IDENTIFIER" &&
    ctx.model.binding(node.name)?.syntax().parent?.kind === "TS_TYPE_ALIAS_DECLARATION" &&
    !node.ancestors().some(parent => parent.kind === "TS_TYPE_ALIAS_DECLARATION")) return;
  const unsafe = unsafeDictionaryValue(ctx.model, node);
  if (!unsafe) return;
  for (const parent of node.ancestors()) {
    if ((parent.kind === "TS_REFERENCE_TYPE" || parent.kind === "TS_OBJECT_TYPE" ||
      parent.kind === "TS_MAPPED_TYPE" || parent.kind === "TS_PARENTHESIZED_TYPE" ||
      parent.kind === "TS_TYPE_OPERATOR_TYPE") && unsafeDictionaryValue(ctx.model, parent as AnyTsType)) return;
  }
  registerDiagnostic(node, "error", `This dictionary's ${unsafe} value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.`);
}

function reportIndex(node: TsIndexSignatureTypeMember | TsIndexSignatureClassMember, ctx: SemanticRuleContext): void {
  if (node.parent?.kind === "TS_TYPE_MEMBER_LIST" && node.parent.parent?.kind === "TS_OBJECT_TYPE") return;
  const unsafe = isUnsafeValueType(ctx.model, node.typeAnnotation?.ty);
  if (unsafe) registerDiagnostic(node, "error", `This dictionary's ${unsafe} value type gives callers no concrete value contract. Use an owner/schema-derived value type; parse external payloads before insertion.`);
}

export const unsafeDictionaryReference = defineRule({
  query: semantic("TS_REFERENCE_TYPE"),
  run(node: TsReferenceType, ctx: SemanticRuleContext): void { reportDictionary(node, ctx); },
});

export const unsafeDictionaryObject = defineRule({
  query: semantic("TS_OBJECT_TYPE"),
  run(node: TsObjectType, ctx: SemanticRuleContext): void { reportDictionary(node, ctx); },
});

export const unsafeDictionaryMapped = defineRule({
  query: semantic("TS_MAPPED_TYPE"),
  run(node: TsMappedType, ctx: SemanticRuleContext): void { reportDictionary(node, ctx); },
});

export const unsafeDictionaryIndex = defineRule({
  query: semantic("TS_INDEX_SIGNATURE_TYPE_MEMBER"),
  run(node: TsIndexSignatureTypeMember, ctx: SemanticRuleContext): void { reportIndex(node, ctx); },
});

export const unsafeDictionaryClassIndex = defineRule({
  query: semantic("TS_INDEX_SIGNATURE_CLASS_MEMBER"),
  run(node: TsIndexSignatureClassMember, ctx: SemanticRuleContext): void { reportIndex(node, ctx); },
});


