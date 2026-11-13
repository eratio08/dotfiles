import type { AnyJsAstNode, AnyJsExpression, Binding, SemanticModel } from "@biomejs/runtime/plugin";
import { arrayMethodTarget, unwrapArrayExpression } from "./array-method.ts";
import { bindingKey } from "./shared.ts";

export function enclosingReducer(node: AnyJsAstNode, model: SemanticModel, callbackPosition: "first" | "first-or-second" = "first"): { accumulator: Binding; initialValue: AnyJsExpression | undefined; parameterCount: number } | undefined {
  for (const parent of node.ancestors()) {
    if (parent.kind === "JS_FUNCTION_DECLARATION" || parent.kind === "JS_METHOD_OBJECT_MEMBER" ||
      parent.kind === "JS_METHOD_CLASS_MEMBER" || parent.kind === "JS_GETTER_OBJECT_MEMBER" ||
      parent.kind === "JS_SETTER_OBJECT_MEMBER" || parent.kind === "JS_GETTER_CLASS_MEMBER" ||
      parent.kind === "JS_SETTER_CLASS_MEMBER" || parent.kind === "JS_CONSTRUCTOR_CLASS_MEMBER") return undefined;
    if (parent.kind !== "JS_ARROW_FUNCTION_EXPRESSION" && parent.kind !== "JS_FUNCTION_EXPRESSION") continue;
    let argument: AnyJsAstNode = parent;
    let owner = argument.parent;
    while (owner?.kind === "JS_PARENTHESIZED_EXPRESSION" || owner?.kind === "TS_AS_EXPRESSION" ||
      owner?.kind === "TS_TYPE_ASSERTION_EXPRESSION" || owner?.kind === "TS_NON_NULL_ASSERTION_EXPRESSION" ||
      owner?.kind === "TS_SATISFIES_EXPRESSION") {
      argument = owner;
      owner = owner.parent;
    }
    while (owner && callbackPosition === "first-or-second") {
      if (owner.kind === "JS_CALL_ARGUMENT_LIST" && owner.parent?.kind === "JS_CALL_ARGUMENTS" &&
        owner.parent.parent?.kind === "JS_CALL_EXPRESSION") {
        const call = owner.parent.parent;
        const method = arrayMethodTarget(call.callee);
        if ((method?.name === "reduce" || method?.name === "reduceRight") && (call.arguments?.args.length ?? 0) <= 2) break;
      }
      argument = owner;
      owner = owner.parent;
    }
    if (owner?.kind !== "JS_CALL_ARGUMENT_LIST" || owner.parent?.kind !== "JS_CALL_ARGUMENTS") return undefined;
    const call = owner.parent.parent;
    if (call?.kind !== "JS_CALL_EXPRESSION") return undefined;
    const args = call.arguments?.args ?? [];
    const method = arrayMethodTarget(call.callee);
    const callbackIsFirst = args[0]?.text === argument.text;
    const callbackIsSecond = args[1]?.text === argument.text;
    if (!method || (method.name !== "reduce" && method.name !== "reduceRight") ||
      args.length > 2 || callbackIsFirst === callbackIsSecond || (!callbackIsFirst && callbackPosition === "first")) return undefined;
    const parameters = parent.parameters;
    const first = parameters?.kind === "JS_PARAMETERS" ? parameters.items[0] : parameters;
    const identifier = first?.kind === "JS_FORMAL_PARAMETER" ? first.binding : first;
    if (identifier?.kind !== "JS_IDENTIFIER_BINDING") return undefined;
    const accumulator = model.asBinding(identifier);
    if (!accumulator) return undefined;
    const initialValue = callbackIsFirst ? args[1] : undefined;
    return { accumulator, initialValue: initialValue?.kind === "JS_SPREAD" ? undefined : initialValue, parameterCount: parameters?.kind === "JS_PARAMETERS" ? parameters.items.length : 1 };
  }
  return undefined;
}

export function referencesAccumulator(model: SemanticModel, expression: AnyJsExpression | undefined, accumulator: Binding, visited = new Set<string>()): boolean {
  const node = unwrapArrayExpression(expression);
  if (node?.kind !== "JS_IDENTIFIER_EXPRESSION" || !node.name) return false;
  const binding = model.binding(node.name);
  if (!binding) return false;
  const key = bindingKey(binding);
  if (key === bindingKey(accumulator)) return true;
  if (visited.has(key) || binding.allWrites().length > 0) return false;
  visited.add(key);
  const declaration = binding.syntax().parent;
  if (declaration?.kind !== "JS_VARIABLE_DECLARATOR" || declaration.id?.kind !== "JS_IDENTIFIER_BINDING") return false;
  const variables = declaration.ancestors().find(parent => parent.kind === "JS_VARIABLE_DECLARATION");
  if (variables?.kind !== "JS_VARIABLE_DECLARATION" || variables.kindToken !== "const") return false;
  return referencesAccumulator(model, declaration.initializer?.expression, accumulator, visited);
}


