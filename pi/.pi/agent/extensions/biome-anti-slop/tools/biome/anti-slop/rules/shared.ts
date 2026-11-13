import type { AnyJsExpression, AnyTsType, Binding } from "@biomejs/runtime/plugin";

export function decodeAsciiEscapes(value: string): string {
  return value.replace(/\\(?:u\{([0-9a-f]{1,6})\}|u([0-9a-f]{4})|x([0-9a-f]{2})|([0-3][0-7]{0,2}|[4-7][0-7]?)|(\r\n|[\n\r\u2028\u2029])|([\s\S]))/gi,
    (_match, wide: string | undefined, unicode: string | undefined, hex: string | undefined, octal: string | undefined, line: string | undefined, literal: string | undefined): string => {
      if (line) return "";
      if (wide || unicode || hex || octal) {
        const code = parseInt(wide ?? unicode ?? hex ?? octal ?? "", octal ? 8 : 16);
        return code <= 0x7f ? String.fromCharCode(code) : "\0";
      }
      return literal && !"bfnrtv".includes(literal) ? literal : "\0";
    });
}

export function memberTarget(node: AnyJsExpression | undefined): { name: string; object: AnyJsExpression } | undefined {
  if (node?.kind === "JS_STATIC_MEMBER_EXPRESSION" && node.object && node.member) {
    return { name: decodeAsciiEscapes(node.member.text), object: node.object };
  }
  if (node?.kind === "JS_COMPUTED_MEMBER_EXPRESSION" && node.object && node.member?.kind === "JS_STRING_LITERAL_EXPRESSION") {
    return { name: decodeAsciiEscapes(node.member.text.slice(1, -1)), object: node.object };
  }
  return undefined;
}

export function isEmptyObject(node: AnyJsExpression | undefined): boolean {
  return node?.kind === "JS_OBJECT_EXPRESSION" && node.members.length === 0;
}

export function unwrapExpression(node: AnyJsExpression | undefined): AnyJsExpression | undefined {
  while (node?.kind === "JS_PARENTHESIZED_EXPRESSION") node = node.expression;
  return node;
}

export function bindingKey(binding: Binding): string {
  return `${binding.syntax().text}\0${binding.scope().syntax().text}`;
}

export function containsUnknown(type: AnyTsType | undefined): boolean {
  while (type?.kind === "TS_PARENTHESIZED_TYPE") type = type.ty;
  return type?.kind === "TS_UNKNOWN_TYPE" || (type?.kind === "TS_UNION_TYPE" && type.types.some(containsUnknown));
}


