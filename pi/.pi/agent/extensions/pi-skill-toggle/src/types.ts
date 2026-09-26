type SkillInvocationMode = 'agent-invocable' | 'manual-only'

type SkillSource =
  | { kind: 'global'; root: string }
  | { kind: 'user'; root: string }
  | { kind: 'project'; root: string }
  | { kind: 'project-legacy'; root: string }
  | { kind: 'unknown'; root: string }

type LocatedSkillFile = { filePath: string; source: SkillSource; editable: boolean }

type SkillDiagnosticSeverity = 'info' | 'warning' | 'error'

type SkillDiagnostic = { severity: SkillDiagnosticSeverity; message: string }

type SkillRecord = {
  id: string
  name: string
  description: string
  filePath: string
  baseDir: string
  source: SkillSource
  editable: boolean
  mode: SkillInvocationMode
  diagnostics: SkillDiagnostic[]
}

type SkillDraft = { skill: SkillRecord; desiredMode: SkillInvocationMode }

type FrontmatterDocument = {
  raw: string
  hasFrontmatter: boolean
  frontmatterStart: number
  frontmatterEnd: number
  contentStart: number
  frontmatterText: string
  bodyText: string
  fields: Record<string, unknown>
  lineEnding: '\n' | '\r\n'
}

type FrontmatterPatch = { oldText: string; newText: string }

type SkillChange = {
  skill: SkillRecord
  filePath: string
  from: SkillInvocationMode
  to: SkillInvocationMode
  patch: FrontmatterPatch
}

type ApplyResult = {
  applied: SkillChange[]
  skipped: Array<{ skill: SkillRecord; reason: string }>
  errors: Array<{ skill?: SkillRecord; message: string }>
}

type SkillToggleUiResult = { action: 'apply' | 'cancel'; drafts: SkillDraft[] }

export type {
  ApplyResult,
  FrontmatterDocument,
  FrontmatterPatch,
  LocatedSkillFile,
  SkillChange,
  SkillDiagnostic,
  SkillDiagnosticSeverity,
  SkillDraft,
  SkillInvocationMode,
  SkillRecord,
  SkillSource,
  SkillToggleUiResult,
}
