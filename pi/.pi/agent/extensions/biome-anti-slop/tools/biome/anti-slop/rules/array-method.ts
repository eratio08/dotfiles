import type { AnyJsExpression, AnyTsType, SemanticModel } from "@biomejs/runtime/plugin";
import { memberTarget } from "./shared.ts";

export function unwrapArrayExpression(node: AnyJsExpression | undefined): AnyJsExpression | undefined {
  while (node?.kind === "JS_PARENTHESIZED_EXPRESSION" ||
    node?.kind === "TS_AS_EXPRESSION" ||
    node?.kind === "TS_TYPE_ASSERTION_EXPRESSION" ||
    node?.kind === "TS_NON_NULL_ASSERTION_EXPRESSION" ||
    node?.kind === "TS_SATISFIES_EXPRESSION") node = node.expression;
  return node;
}

export function arrayMethodTarget(node: AnyJsExpression | undefined): { name: string; object: AnyJsExpression } | undefined {
  return memberTarget(unwrapArrayExpression(node));
}

function isArrayAnnotation(type: AnyTsType | undefined): boolean {
  if (type?.kind === "TS_ARRAY_TYPE" || type?.kind === "TS_TUPLE_TYPE") return true;
  if (type?.kind === "TS_PARENTHESIZED_TYPE") return isArrayAnnotation(type.ty);
  if (type?.kind === "TS_TYPE_OPERATOR_TYPE" && type.operatorToken === "readonly") return isArrayAnnotation(type.ty);
  return type?.kind === "TS_REFERENCE_TYPE" && (type.name?.text === "Array" || type.name?.text === "ReadonlyArray");
}

export function isKnownArrayExpression(model: SemanticModel, expression: AnyJsExpression | undefined, visited = new Set<string>()): boolean {
  const node = unwrapArrayExpression(expression);
  if (node?.kind === "JS_ARRAY_EXPRESSION") return true;
  if (node?.kind === "JS_CALL_EXPRESSION") {
    const method = arrayMethodTarget(node.callee);
    return method !== undefined &&
      ["map", "filter", "flatMap", "slice", "concat", "toSorted", "toReversed", "toSpliced"].includes(method.name) &&
      isKnownArrayExpression(model, method.object, visited);
  }
  if (node?.kind !== "JS_IDENTIFIER_EXPRESSION" || !node.name) return false;
  const binding = model.binding(node.name);
  if (!binding || binding.allWrites().length > 0) return false;
  const identifier = binding.syntax();
  const key = `${identifier.text}\0${binding.scope().syntax().text}`;
  if (visited.has(key)) return false;
  visited.add(key);
  const declaration = identifier.parent;
  if (declaration?.kind === "JS_FORMAL_PARAMETER" && declaration.binding?.kind === "JS_IDENTIFIER_BINDING") {
    return isArrayAnnotation(declaration.typeAnnotation?.ty);
  }
  if (declaration?.kind !== "JS_VARIABLE_DECLARATOR" || declaration.id?.kind !== "JS_IDENTIFIER_BINDING") return false;
  const annotation = declaration.variableAnnotation;
  if (annotation?.kind === "TS_TYPE_ANNOTATION") return isArrayAnnotation(annotation.ty);
  if (annotation?.kind === "TS_DEFINITE_VARIABLE_ANNOTATION") return isArrayAnnotation(annotation.typeAnnotation?.ty);
  const variables = declaration.ancestors().find(parent => parent.kind === "JS_VARIABLE_DECLARATION");
  if (variables?.kind !== "JS_VARIABLE_DECLARATION" || variables.kindToken !== "const") return false;
  return isKnownArrayExpression(model, declaration.initializer?.expression, visited);
}


