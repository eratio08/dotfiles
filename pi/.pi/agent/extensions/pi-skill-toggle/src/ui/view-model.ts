import { formatSourceKind, sourceBadge } from '../inventory/classifier.ts'
import type { SkillInvocationMode, SkillRecord } from '../types.ts'

function modeLabel(mode: SkillInvocationMode): string {
  return mode === 'manual-only' ? 'Manual-only' : 'Agent-invocable'
}

function toggleMode(mode: SkillInvocationMode): SkillInvocationMode {
  return mode === 'manual-only' ? 'agent-invocable' : 'manual-only'
}

function skillSearchText(skill: SkillRecord): string {
  return [
    skill.name,
    skill.description,
    skill.filePath,
    skill.source.kind,
    sourceBadge(skill.source),
    formatSourceKind(skill.source.kind),
    modeLabel(skill.mode),
  ]
    .join(' ')
    .toLowerCase()
}

function filterSkills(skills: SkillRecord[], query: string): SkillRecord[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return skills
  return skills.filter((skill) => {
    const haystack = skillSearchText(skill)
    return tokens.every((token) => haystack.includes(token))
  })
}

export { filterSkills, modeLabel, skillSearchText, toggleMode }
