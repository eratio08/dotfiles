import { decodeAsciiEscapes, memberTarget, unwrapExpression } from "./shared.ts";
import { defineRule, registerDiagnostic, semantic, type JsCallExpression, type SemanticRuleContext } from "@biomejs/runtime/plugin";

export const noReflectGet = defineRule({
  query: semantic("JS_CALL_EXPRESSION"),
  run(node: JsCallExpression, ctx: SemanticRuleContext): void {
    const target = memberTarget(unwrapExpression(node.callee));
    const object = unwrapExpression(target?.object);
    if (target?.name !== "get" || object?.kind !== "JS_IDENTIFIER_EXPRESSION" || !object.name ||
      decodeAsciiEscapes(object.name.valueToken ?? "") !== "Reflect" || ctx.model.binding(object.name)) return;
    registerDiagnostic(node, "error", "Replace `Reflect.get` with typed property access. Parse dynamic input into a named domain type before reading it.");
  },
});


