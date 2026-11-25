import type {
  AnyTsType,
  Binding,
  SemanticModel,
  TsReferenceType,
  TsTypeAliasDeclaration,
} from '@biomejs/runtime/plugin'
import { bindingKey } from './shared.ts'

type WideningTarget = 'unknown' | 'object' | 'open dictionary' | 'anonymous object' | 'generic container'
type Substitutions = ReadonlyMap<string, AnyTsType>

function transparentType(type: AnyTsType | undefined): AnyTsType | undefined {
  while (
    type?.kind === 'TS_PARENTHESIZED_TYPE' ||
    (type?.kind === 'TS_TYPE_OPERATOR_TYPE' && type.operatorToken === 'readonly')
  )
    type = type.ty
  return type
}

function referenceBinding(model: SemanticModel, type: TsReferenceType): Binding | undefined {
  return type.name?.kind === 'JS_REFERENCE_IDENTIFIER' ? model.binding(type.name) : undefined
}

function aliasArguments(
  model: SemanticModel,
  alias: TsTypeAliasDeclaration,
  reference: TsReferenceType,
  substitutions: Substitutions,
): Map<string, AnyTsType> | undefined {
  const values = reference.typeArguments?.tsTypeArgumentList ?? []
  const result = new Map(substitutions)
  for (const [index, parameter] of (alias.typeParameters?.items ?? []).entries()) {
    const binding = parameter.name && model.asBinding(parameter.name)
    const value = values[index] ?? parameter.default?.ty
    if (!binding || !value) return undefined
    result.set(bindingKey(binding), value)
  }
  return result
}

function broadKey(
  model: SemanticModel,
  type: AnyTsType | undefined,
  substitutions: Substitutions,
  visited: Set<string>,
): boolean {
  type = transparentType(type)
  if (!type) return false
  if (type.kind === 'TS_STRING_TYPE' || type.kind === 'TS_NUMBER_TYPE' || type.kind === 'TS_SYMBOL_TYPE') return true
  if (type.kind === 'TS_UNION_TYPE') return type.types.some((item) => broadKey(model, item, substitutions, visited))
  if (type.kind !== 'TS_REFERENCE_TYPE' || type.name?.kind !== 'JS_REFERENCE_IDENTIFIER') return false
  const binding = referenceBinding(model, type)
  if (!binding) return type.name.text === 'PropertyKey'
  const key = bindingKey(binding)
  if (visited.has(key)) return false
  const next = new Set(visited).add(key)
  const substitution = substitutions.get(key)
  if (substitution) return broadKey(model, substitution, substitutions, next)
  const declaration = binding.syntax().parent
  if (declaration?.kind !== 'TS_TYPE_ALIAS_DECLARATION' || declaration.typeParameters?.items.length) return false
  return broadKey(model, declaration.ty, substitutions, next)
}

export function classifyWideningTarget(
  model: SemanticModel,
  type: AnyTsType | undefined,
  substitutions: Substitutions = new Map(),
  visited = new Set<string>(),
  inAlias = false,
): WideningTarget | undefined {
  type = transparentType(type)
  if (!type) return undefined
  if (type.kind === 'TS_UNKNOWN_TYPE') return 'unknown'
  if (type.kind === 'TS_NON_PRIMITIVE_TYPE') return 'object'
  if (type.kind === 'TS_OBJECT_TYPE') {
    if (type.members.some((member) => member.kind === 'TS_INDEX_SIGNATURE_TYPE_MEMBER')) return 'open dictionary'
    return !inAlias && type.members.length > 0 ? 'anonymous object' : undefined
  }
  if (type.kind === 'TS_MAPPED_TYPE')
    return !inAlias || broadKey(model, type.keysType, substitutions, visited) ? 'open dictionary' : undefined
  if (type.kind !== 'TS_REFERENCE_TYPE' || type.name?.kind !== 'JS_REFERENCE_IDENTIFIER') return undefined
  const name = type.name.text
  const args = type.typeArguments?.tsTypeArgumentList ?? []
  const binding = referenceBinding(model, type)
  if (!binding) {
    if (['Readonly', 'Partial', 'Required', 'NonNullable'].includes(name))
      return classifyWideningTarget(model, args[0], substitutions, visited, inAlias)
    if (name === 'Record' && (!args[0] || broadKey(model, args[0], substitutions, visited))) return 'open dictionary'
    return undefined
  }
  const key = bindingKey(binding)
  if (visited.has(key)) return undefined
  const next = new Set(visited).add(key)
  const substitution = substitutions.get(key)
  if (substitution) return classifyWideningTarget(model, substitution, substitutions, next, inAlias)
  const alias = binding.syntax().parent
  if (alias?.kind !== 'TS_TYPE_ALIAS_DECLARATION') return undefined
  const mapped = aliasArguments(model, alias, type, substitutions)
  if (!mapped) return undefined
  const resolved = classifyWideningTarget(model, alias.ty, mapped, next, true)
  return alias.typeParameters?.items.length
    ? resolved === 'open dictionary'
      ? 'generic container'
      : undefined
    : resolved
}

export function matchesResolvedType(
  model: SemanticModel,
  type: AnyTsType | undefined,
  target: 'object' | 'unknown' | 'unknown-return',
  substitutions: Substitutions = new Map(),
  visited = new Set<string>(),
): boolean {
  if (!type) return false
  if (type.kind === 'TS_PARENTHESIZED_TYPE') return matchesResolvedType(model, type.ty, target, substitutions, visited)
  if (type.kind === 'TS_UNION_TYPE')
    return type.types.some((item) => matchesResolvedType(model, item, target, substitutions, visited))
  if (type.kind === 'TS_NON_PRIMITIVE_TYPE') return target === 'object'
  if (type.kind === 'TS_UNKNOWN_TYPE') return target !== 'object'
  if (type.kind !== 'TS_REFERENCE_TYPE' || type.name?.kind !== 'JS_REFERENCE_IDENTIFIER') return false
  const args = type.typeArguments?.tsTypeArgumentList ?? []
  const binding = referenceBinding(model, type)
  if (binding) {
    const key = bindingKey(binding)
    if (visited.has(key)) return false
    const next = new Set(visited).add(key)
    const substitution = substitutions.get(key)
    if (substitution && args.length === 0) return matchesResolvedType(model, substitution, target, substitutions, next)
    const alias = binding.syntax().parent
    if (alias?.kind === 'TS_TYPE_ALIAS_DECLARATION') {
      const mapped = aliasArguments(model, alias, type, substitutions)
      if (mapped) return matchesResolvedType(model, alias.ty, target, mapped, next)
    }
  }
  return (
    target === 'unknown-return' &&
    (type.name.text === 'Promise' || type.name.text === 'PromiseLike') &&
    matchesResolvedType(model, args[0], target, substitutions, visited)
  )
}

export function unsafeDictionaryValue(
  model: SemanticModel,
  type: AnyTsType | undefined,
  substitutions: Substitutions = new Map(),
  visited = new Set<string>(),
): ReturnType<typeof isUnsafeValueType> {
  type = transparentType(type)
  if (!type) return undefined
  if (type.kind === 'TS_OBJECT_TYPE') {
    for (const member of type.members) {
      if (member.kind === 'TS_INDEX_SIGNATURE_TYPE_MEMBER') {
        const unsafe = isUnsafeValueType(model, member.typeAnnotation?.ty, substitutions)
        if (unsafe) return unsafe
      }
    }
    return undefined
  }
  if (type.kind === 'TS_MAPPED_TYPE') return isUnsafeValueType(model, type.mappedType?.ty, substitutions)
  if (type.kind !== 'TS_REFERENCE_TYPE' || type.name?.kind !== 'JS_REFERENCE_IDENTIFIER') return undefined
  const args = type.typeArguments?.tsTypeArgumentList ?? []
  const binding = referenceBinding(model, type)
  if (!binding) {
    if (type.name.text === 'Record') return isUnsafeValueType(model, args[1], substitutions)
    if (['Readonly', 'Partial', 'Required', 'NonNullable', 'Pick', 'Omit'].includes(type.name.text))
      return unsafeDictionaryValue(model, args[0], substitutions, visited)
    return undefined
  }
  const key = bindingKey(binding)
  if (visited.has(key)) return undefined
  const next = new Set(visited).add(key)
  const substitution = substitutions.get(key)
  if (substitution) return unsafeDictionaryValue(model, substitution, substitutions, next)
  const alias = binding.syntax().parent
  if (alias?.kind !== 'TS_TYPE_ALIAS_DECLARATION') return undefined
  const mapped = aliasArguments(model, alias, type, substitutions)
  return mapped && unsafeDictionaryValue(model, alias.ty, mapped, next)
}

export function isUnsafeValueType(
  model: SemanticModel,
  type: AnyTsType | undefined,
  substitutions: Substitutions = new Map(),
  visited = new Set<string>(),
): 'any' | 'empty-object' | 'object' | 'union' | 'unknown' | undefined {
  type = transparentType(type)
  if (!type) return undefined
  if (type.kind === 'TS_ANY_TYPE') return 'any'
  if (type.kind === 'TS_UNKNOWN_TYPE') return 'unknown'
  if (type.kind === 'TS_NON_PRIMITIVE_TYPE') return 'object'
  if (type.kind === 'TS_OBJECT_TYPE')
    return type.members.every(
      (member) =>
        member.kind === 'TS_PROPERTY_SIGNATURE_TYPE_MEMBER' &&
        member.optionalToken !== undefined &&
        transparentType(member.typeAnnotation?.ty)?.kind === 'TS_NEVER_TYPE',
    )
      ? 'empty-object'
      : undefined
  if (type.kind === 'TS_UNION_TYPE')
    return type.types.some((item) => isUnsafeValueType(model, item, substitutions, visited)) ? 'union' : undefined
  if (type.kind === 'TS_INTERSECTION_TYPE') {
    const members = type.types.map((item) => isUnsafeValueType(model, item, substitutions, visited))
    if (members.includes('any')) return 'any'
    return members.length > 0 && members.every(Boolean) ? members[0] : undefined
  }
  if (type.kind !== 'TS_REFERENCE_TYPE' || type.name?.kind !== 'JS_REFERENCE_IDENTIFIER') return undefined
  const args = type.typeArguments?.tsTypeArgumentList ?? []
  const binding = referenceBinding(model, type)
  if (!binding)
    return ['Readonly', 'Partial', 'Required', 'NonNullable'].includes(type.name.text)
      ? isUnsafeValueType(model, args[0], substitutions, visited)
      : undefined
  const key = bindingKey(binding)
  if (visited.has(key)) return undefined
  const next = new Set(visited).add(key)
  const substitution = substitutions.get(key)
  if (substitution) return isUnsafeValueType(model, substitution, substitutions, next)
  const alias = binding.syntax().parent
  if (alias?.kind === 'TS_INTERFACE_DECLARATION') {
    const scope = model.scopeHoistedTo(binding.syntax())?.syntax().text
    if (scope === undefined) return undefined
    const declarations = model
      .allBindings()
      .filter(
        (candidate) =>
          candidate.syntax().text === binding.syntax().text &&
          candidate.syntax().parent?.kind === 'TS_INTERFACE_DECLARATION' &&
          model.scopeHoistedTo(candidate.syntax())?.syntax().text === scope,
      )
    return declarations.length === 1 &&
      !alias.extendsClause &&
      alias.members.every(
        (member) =>
          member.kind === 'TS_PROPERTY_SIGNATURE_TYPE_MEMBER' &&
          member.optionalToken !== undefined &&
          transparentType(member.typeAnnotation?.ty)?.kind === 'TS_NEVER_TYPE',
      )
      ? 'empty-object'
      : undefined
  }
  if (alias?.kind !== 'TS_TYPE_ALIAS_DECLARATION') return undefined
  const mapped = aliasArguments(model, alias, type, substitutions)
  return mapped && isUnsafeValueType(model, alias.ty, mapped, next)
}
