type SkillInvocationMode = 'agent-invocable' | 'manual-only'

type SkillSource =
  | { kind: 'global'; root: string }
  | { kind: 'user'; root: string }
  | { kind: 'project'; root: string }
  | { kind: 'project-legacy'; root: string }
  | { kind: 'unknown'; root: string }

interface LocatedSkillFile {
  filePath: string
  source: SkillSource
  editable: boolean
}

type SkillDiagnosticSeverity = 'info' | 'warning' | 'error'

interface SkillDiagnostic {
  severity: SkillDiagnosticSeverity
  message: string
}

interface SkillRecord {
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

interface SkillDraft {
  skill: SkillRecord
  desiredMode: SkillInvocationMode
}

interface FrontmatterDocument {
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

interface FrontmatterPatch {
  oldText: string
  newText: string
}

interface SkillChange {
  skill: SkillRecord
  filePath: string
  from: SkillInvocationMode
  to: SkillInvocationMode
  patch: FrontmatterPatch
}

interface ApplyResult {
  applied: SkillChange[]
  skipped: Array<{ skill: SkillRecord; reason: string }>
  errors: Array<{ skill?: SkillRecord; message: string }>
}

interface SkillToggleUiResult {
  action: 'apply' | 'cancel'
  drafts: SkillDraft[]
}

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
