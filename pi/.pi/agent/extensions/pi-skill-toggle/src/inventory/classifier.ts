import { getDisableModelInvocation } from '../frontmatter/validation.ts'
import type { FrontmatterDocument, SkillInvocationMode, SkillSource } from '../types.ts'

function classifyInvocationMode(doc: FrontmatterDocument): SkillInvocationMode {
  return getDisableModelInvocation(doc) ? 'manual-only' : 'agent-invocable'
}

function formatSourceKind(kind: SkillSource['kind'] | string): string {
  switch (kind) {
    case 'global':
      return 'Global'
    case 'user':
      return 'User'
    case 'project':
      return 'Project'
    case 'project-legacy':
      return 'Project (.agents)'
    default:
      return 'Unknown'
  }
}

function sourceCategory(source: SkillSource): 'global' | 'user' | 'project' | 'unknown' {
  if (source.kind === 'project-legacy') return 'project'
  if (source.kind === 'global' || source.kind === 'user' || source.kind === 'project') return source.kind
  return 'unknown'
}

function sourceBadge(source: SkillSource): string {
  return sourceCategory(source)
}

export { classifyInvocationMode, formatSourceKind, sourceBadge, sourceCategory }
