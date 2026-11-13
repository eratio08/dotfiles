import { ast, defineRule, registerDiagnostic, type AnyJsAstNode } from "@biomejs/runtime/plugin";
import { decodeAsciiEscapes } from "./shared.ts";

function reportSymbol(node: AnyJsAstNode): void {
  if ((node.kind === "JS_NAME" || node.kind === "JS_PRIVATE_NAME") &&
    (node.parent?.kind === "JS_STATIC_MEMBER_EXPRESSION" || node.parent?.kind === "JS_STATIC_MEMBER_ASSIGNMENT")) return;
  if ((node.kind === "JS_LITERAL_MEMBER_NAME" || node.kind === "JS_LITERAL_EXPORT_NAME" || node.kind === "TS_LITERAL_ENUM_MEMBER_NAME") && node.token("value")?.kind !== "IDENT") return;
  const name = decodeAsciiEscapes(node.text.replace(/^#/, ""));
  if (!name.toLowerCase().includes("shape")) return;
  registerDiagnostic(node, "error", `Rename symbol "${name}" for its domain role; "shape" describes structure rather than ownership.`);
}

export const forbiddenBinding = defineRule({ query: ast("JS_IDENTIFIER_BINDING"), run: reportSymbol });
export const forbiddenReference = defineRule({ query: ast("JS_REFERENCE_IDENTIFIER"), run: reportSymbol });
export const forbiddenAssignment = defineRule({ query: ast("JS_IDENTIFIER_ASSIGNMENT"), run: reportSymbol });
export const forbiddenName = defineRule({ query: ast("JS_NAME"), run: reportSymbol });
export const forbiddenMemberName = defineRule({ query: ast("JS_LITERAL_MEMBER_NAME"), run: reportSymbol });
export const forbiddenPrivateName = defineRule({ query: ast("JS_PRIVATE_NAME"), run: reportSymbol });
export const forbiddenPrivateDeclaration = defineRule({ query: ast("JS_PRIVATE_CLASS_MEMBER_NAME"), run: reportSymbol });
export const forbiddenTypeBinding = defineRule({ query: ast("TS_IDENTIFIER_BINDING"), run: reportSymbol });
export const forbiddenTypeParameter = defineRule({ query: ast("TS_TYPE_PARAMETER_NAME"), run: reportSymbol });
export const forbiddenExportName = defineRule({ query: ast("JS_LITERAL_EXPORT_NAME"), run: reportSymbol });
export const forbiddenEnumMember = defineRule({ query: ast("TS_LITERAL_ENUM_MEMBER_NAME"), run: reportSymbol });
export const forbiddenLabel = defineRule({ query: ast("JS_LABEL"), run: reportSymbol });
export const forbiddenJsxReference = defineRule({ query: ast("JSX_REFERENCE_IDENTIFIER"), run: reportSymbol });
export const forbiddenJsxName = defineRule({ query: ast("JSX_NAME"), run: reportSymbol });


