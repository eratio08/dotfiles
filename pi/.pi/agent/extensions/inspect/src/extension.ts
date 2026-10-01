import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { getCurrentSystemMessage, getCurrentTools, type SystemMessage, type Usage } from '@earendil-works/pi-ai'
import {
  type BuildSystemPromptOptions,
  buildSessionProjection,
  type ContextUsage,
  estimateTokens,
  parseSessionEntries,
  type SessionEntry,
  type SessionHeader,
  type SessionManager,
  type SessionProjection,
  type sessionEntryToContextMessages,
  type ToolInfo,
} from '@earendil-works/pi-coding-agent'

type CurrentSessionManager = Pick<
  SessionManager,
  'getHeader' | 'getSessionId' | 'getCwd' | 'getEntries' | 'getLeafId' | 'buildSessionProjection'
>

type ParsedSession = {
  header: SessionHeader | null
  sessionId: string
  cwd: string
  source: 'current' | 'saved'
  filePath?: string
  entries: SessionEntry[]
  branch?: SessionEntry[]
  leafId: string | null
  projection: SessionProjection
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateEntries(entries: SessionEntry[]): Map<string, SessionEntry> {
  const byId = new Map<string, SessionEntry>()

  for (const entry of entries) {
    const record = entry as unknown as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id.length === 0) {
      throw new Error('Session entry is missing a valid ID.')
    }
    if (record.parentId !== null && typeof record.parentId !== 'string') {
      throw new Error(`Session entry ${record.id} has an invalid parent ID.`)
    }
    if (byId.has(record.id)) {
      throw new Error(`Session file contains duplicate entry ID ${record.id}.`)
    }
    byId.set(record.id, entry)
  }

  return byId
}

function getSelectedBranch(
  _entries: SessionEntry[],
  leafId: string | null,
  byId: Map<string, SessionEntry>,
): SessionEntry[] {
  if (leafId === null) return []

  const branch: SessionEntry[] = []
  const visited = new Set<string>()
  let current = byId.get(leafId)

  if (!current) throw new Error(`Session leaf ${leafId} was not found.`)

  while (current) {
    if (visited.has(current.id)) {
      throw new Error(`Session branch contains a parent cycle at entry ${current.id}.`)
    }
    visited.add(current.id)
    branch.push(current)

    if (current.parentId === null) break

    const parent = byId.get(current.parentId)
    if (!parent) {
      throw new Error(`Session entry ${current.id} refers to missing parent ${current.parentId}.`)
    }
    current = parent
  }

  return branch.reverse()
}

function selectCurrentSession(sessionManager: CurrentSessionManager): ParsedSession {
  return {
    header: sessionManager.getHeader(),
    sessionId: sessionManager.getSessionId(),
    cwd: sessionManager.getCwd(),
    source: 'current',
    entries: sessionManager.getEntries(),
    leafId: sessionManager.getLeafId(),
    projection: sessionManager.buildSessionProjection(),
  }
}

function parseSavedSession(content: string, requestedLeafId?: string, filePath?: string): ParsedSession {
  if (!content.trim()) throw new Error('Session file is empty.')

  const records: unknown[] = []
  const lines = content.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue

    let record: unknown
    try {
      record = JSON.parse(line) as unknown
    } catch {
      throw new Error(`Session file contains malformed JSON on line ${index + 1}.`)
    }

    if (!isRecord(record)) {
      throw new Error(`Session file line ${index + 1} is not a JSON object.`)
    }
    records.push(record)
  }

  const firstRecord = records[0]
  if (!isRecord(firstRecord) || firstRecord.type !== 'session') {
    throw new Error('Session file does not start with a Pi session header.')
  }
  if (typeof firstRecord.id !== 'string' || firstRecord.id.length === 0) {
    throw new Error('Session header is missing a valid session ID.')
  }
  if (records.slice(1).some((record) => isRecord(record) && record.type === 'session')) {
    throw new Error('Session file contains more than one session header.')
  }

  const fileEntries = parseSessionEntries(content)
  if (fileEntries.length !== records.length) {
    throw new Error('Pi could not parse every session file entry.')
  }

  const headerEntry = fileEntries[0]
  if (headerEntry?.type !== 'session') {
    throw new Error('Session file does not contain a valid Pi session header.')
  }

  const entries = fileEntries.filter((entry): entry is SessionEntry => entry.type !== 'session')
  const byId = validateEntries(entries)
  const leafId = requestedLeafId ?? entries.at(-1)?.id ?? null

  if (leafId !== null && !byId.has(leafId)) {
    throw new Error(`Session leaf ${leafId} was not found.`)
  }

  const branch = getSelectedBranch(entries, leafId, byId)
  let projection: SessionProjection

  try {
    projection = buildSessionProjection(entries, leafId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Pi could not build the session projection: ${message}`)
  }

  const header = headerEntry as SessionHeader

  return {
    header,
    sessionId: header.id,
    cwd: typeof header.cwd === 'string' ? header.cwd : '',
    source: 'saved',
    filePath,
    entries,
    branch,
    leafId,
    projection,
  }
}

export { type ParsedSession, parseSavedSession, selectCurrentSession }

type SourceGroup =
  | 'systemPromptAndInstructionFiles'
  | 'toolDefinitionsAndPromptText'
  | 'toolCallsAndResults'
  | 'otherConversation'
  | 'unattributedContent'

type ContributionKind =
  | 'system-content'
  | 'prompt-section'
  | 'instruction-file'
  | 'tool-definition'
  | 'tool-prompt'
  | 'tool-call'
  | 'tool-result'
  | 'conversation'
  | 'unattributed'

type Contribution = {
  id: string
  label: string
  group: SourceGroup
  kind: ContributionKind
  tokens: number
  entryId?: string
  source?: string
  toolName?: string
  toolCallId?: string
  isError?: boolean
}

type ContributionDraft = Omit<Contribution, 'tokens'> & { chars: number }

type SourceGroupTotals = Record<SourceGroup, number>

type Baseline = {
  available: boolean
  source: 'saved' | 'current-configuration' | 'unavailable'
  tokens: number | null
  contributions: Contribution[]
  systemMessage?: MessageView
}

type RequestAnalysis = {
  index: number
  responseEntryId: string
  timestamp: string
  footprintTokens: number | null
  loadoutSource: Baseline['source']
  loadoutMessage?: MessageView
  inputEntryIds: string[]
  knownTokens: number
  loadoutTokens: number | null
  conversationTokens: number
  contributions: Contribution[]
  providerUsage?: Usage
  model?: string
}

type RequestExposure = {
  tokens: number | null
  knownTokens: number
  complete: boolean
}

type ToolStatistics = {
  name: string
  description?: string
  parameterSchema?: ToolInfo['parameters']
  callCount: number
  argumentTokens: number
  totalResultTokens: number
  averageResultTokens: number
  oneTimeInteractionTokens: number
  estimatedContextExposureTokens: number
  estimatedDefinitionExposureTokens: number
  estimatedPromptExposureTokens: number
  estimatedArgumentExposureTokens: number
  estimatedResultExposureTokens: number
}

type ToolInvocationStatistics = {
  toolName: string
  toolCallId: string
  callEntryId?: string
  resultEntryId?: string
  argumentTokens: number
  resultTokens: number
  isError: boolean | null
  oneTimeInteractionTokens: number
  latestRequestTokens: number
  latestRequestShare: number | null
}

type PromptStatistics = {
  id: string
  label: string
  source?: string
  kind: 'prompt-section' | 'instruction-file' | 'unattributed'
  cumulativeRequestExposure: number
  exposureShare: number | null
  latestRequestTokens: number
}

type EntryContextStatus = 'current' | 'compacted' | 'replaced' | 'omitted' | 'historical' | 'not-model-content'

type MessageView = {
  role: string
  content?: unknown
  summary?: string
  customType?: string
  toolCallId?: string
  toolName?: string
  isError?: boolean
  command?: string
  output?: string
  exitCode?: number
  cancelled?: boolean
  truncated?: boolean
  timestamp?: number
  sections?: SystemMessage['sections']
  toolsAdded?: SystemMessage['toolsAdded']
  toolsRemoved?: SystemMessage['toolsRemoved']
  model?: string
}

type EntryStatistics = {
  entryId: string
  entryType: string
  role?: string
  customType?: string
  timestamp: string
  contextStatus: EntryContextStatus
  messageAdditionTokens: number
  historicalTokens: number
  cumulativeRequestExposure: number
  exposureShare: number | null
  latestRequestIncluded: boolean
  toolCallIds: string[]
  rawMessages: MessageView[]
  effectiveMessages: MessageView[]
  providerUsage?: Usage
}

type SessionAnalysis = {
  sessionId: string
  cwd: string
  source: 'current' | 'saved'
  filePath?: string
  selectedLeafId: string | null
  analyzedAt: string
  tokenEstimateMethod: string
  baseline: Baseline
  latestRequestFootprintTokens: number | null
  requestCount: number
  requestExposure: RequestExposure
  oneTimeMessageAdditionsTokens: number
  sourceGroups: SourceGroupTotals
  sharedToolContextExposureTokens: number
  requests: RequestAnalysis[]
  tools: ToolStatistics[]
  toolInvocations: ToolInvocationStatistics[]
  promptSections: PromptStatistics[]
  entries: EntryStatistics[]
  warnings: string[]
}

type AnalysisOptions = {
  fallbackSystemMessage?: SystemMessage
  signal?: AbortSignal
}

type PromptSpan = {
  start: number
  end: number
  key: string
}

type AgentMessage = ReturnType<typeof sessionEntryToContextMessages>[number]
type AssistantMessage = Extract<AgentMessage, { role: 'assistant' }>

type MessageSource = {
  message: AgentMessage
  entryId: string
}

type ToolAccumulator = {
  callCount: number
  argumentTokens: number
  resultTokens: number
  resultCount: number
  estimatedContextExposureTokens: number
  estimatedDefinitionExposureTokens: number
  estimatedPromptExposureTokens: number
  estimatedArgumentExposureTokens: number
  estimatedResultExposureTokens: number
}

type ToolDefinitionInfo = Pick<ToolInfo, 'name' | 'description' | 'parameters'>

type ToolInvocationAccumulator = {
  toolName: string
  toolCallId: string
  callEntryId?: string
  resultEntryId?: string
  argumentTokens: number
  resultTokens: number
  isError: boolean | null
  latestRequestTokens: number
}

const estimatedImageChars = 4800
function createEmptyGroupTotals(): SourceGroupTotals {
  return {
    systemPromptAndInstructionFiles: 0,
    toolDefinitionsAndPromptText: 0,
    toolCallsAndResults: 0,
    otherConversation: 0,
    unattributedContent: 0,
  }
}

function sumTokens(contributions: readonly Contribution[]): number {
  return contributions.reduce((sum, contribution) => sum + contribution.tokens, 0)
}

function safeJson(value: unknown): string {
  return JSON.stringify(value) ?? ''
}

function allocateEstimate(totalTokens: number, drafts: readonly ContributionDraft[]): Contribution[] {
  if (drafts.length === 0) {
    if (totalTokens === 0) return []
    return [
      {
        id: 'unattributed',
        label: 'Unattributed content',
        group: 'unattributedContent',
        kind: 'unattributed',
        tokens: totalTokens,
      },
    ]
  }

  const totalChars = drafts.reduce((sum, draft) => sum + draft.chars, 0)
  if (totalChars === 0) {
    return drafts.map((draft, index) => ({
      id: draft.id,
      label: draft.label,
      group: draft.group,
      kind: draft.kind,
      tokens: index === 0 ? totalTokens : 0,
      ...(draft.entryId === undefined ? {} : { entryId: draft.entryId }),
      ...(draft.source === undefined ? {} : { source: draft.source }),
      ...(draft.toolName === undefined ? {} : { toolName: draft.toolName }),
      ...(draft.toolCallId === undefined ? {} : { toolCallId: draft.toolCallId }),
      ...(draft.isError === undefined ? {} : { isError: draft.isError }),
    }))
  }

  const tokenShares = drafts.map((draft) => (totalTokens * draft.chars) / totalChars)
  const allocations = tokenShares.map(Math.floor)
  let remainder = totalTokens - allocations.reduce((sum, tokens) => sum + tokens, 0)
  const order = tokenShares
    .map((share, index) => ({ index, fraction: share - Math.floor(share) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)

  for (let index = 0; remainder > 0; index += 1) {
    const target = order[index % order.length]
    if (target) allocations[target.index] = (allocations[target.index] ?? 0) + 1
    remainder -= 1
  }

  return drafts.map((draft, index) => ({
    id: draft.id,
    label: draft.label,
    group: draft.group,
    kind: draft.kind,
    tokens: allocations[index] ?? 0,
    ...(draft.entryId === undefined ? {} : { entryId: draft.entryId }),
    ...(draft.source === undefined ? {} : { source: draft.source }),
    ...(draft.toolName === undefined ? {} : { toolName: draft.toolName }),
    ...(draft.toolCallId === undefined ? {} : { toolCallId: draft.toolCallId }),
    ...(draft.isError === undefined ? {} : { isError: draft.isError }),
  }))
}

function findUniqueSpan(prompt: string, text: string, key: string): PromptSpan | undefined {
  if (!text) return undefined
  const start = prompt.indexOf(text)
  if (start < 0 || prompt.indexOf(text, start + text.length) >= 0) return undefined
  return { start, end: start + text.length, key }
}

function splitCurrentPrompt(
  prompt: string,
  options: BuildSystemPromptOptions,
): { content: string; sections: Record<string, string> } {
  const spans: PromptSpan[] = []

  for (const [index, file] of (options.contextFiles ?? []).entries()) {
    const text = `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>`
    const span = findUniqueSpan(prompt, text, `metering:instruction:${index}:${file.path}`)
    if (span) spans.push(span)
  }

  for (const [toolName, snippet] of Object.entries(options.toolSnippets ?? {})) {
    const span = findUniqueSpan(prompt, `- ${toolName}: ${snippet}`, `metering:tool-prompt:${toolName}`)
    if (span) spans.push(span)
  }

  spans.sort((left, right) => left.start - right.start || left.end - right.end)
  const sections: Record<string, string> = {}
  let content = ''
  let cursor = 0

  for (const span of spans) {
    if (span.start < cursor) continue
    content += prompt.slice(cursor, span.start)
    sections[span.key] = prompt.slice(span.start, span.end)
    cursor = span.end
  }

  content += prompt.slice(cursor)
  if (content) sections['metering:unattributed'] = content
  return { content: '', sections }
}

function buildCurrentSystemMessage(
  prompt: string,
  options: BuildSystemPromptOptions,
  activeToolNames: readonly string[],
  allTools: readonly Pick<ToolInfo, 'name' | 'description' | 'parameters'>[],
): SystemMessage {
  const activeTools = new Set(activeToolNames)
  const toolsAdded = allTools
    .filter((tool) => activeTools.has(tool.name))
    .map(({ name, description, parameters }) => ({ name, description, parameters }))
  const sections = splitCurrentPrompt(prompt, options)

  return {
    role: 'system',
    content: sections.content,
    ...(Object.keys(sections.sections).length === 0 ? {} : { sections: sections.sections }),
    ...(toolsAdded.length === 0 ? {} : { toolsAdded }),
    timestamp: Date.now(),
  }
}

function textContentDraft(text: string, fields: Omit<ContributionDraft, 'chars'>): ContributionDraft | undefined {
  if (!text) return undefined
  return { ...fields, chars: text.length }
}

function contentDrafts(
  content: string | readonly { type: string; text?: string }[],
  fields: Omit<ContributionDraft, 'chars' | 'id' | 'label'>,
  idPrefix: string,
  labelPrefix: string,
): ContributionDraft[] {
  if (typeof content === 'string') {
    const draft = textContentDraft(content, {
      ...fields,
      id: idPrefix,
      label: labelPrefix,
    })
    return draft ? [draft] : []
  }

  const drafts: ContributionDraft[] = []
  for (const [index, block] of content.entries()) {
    if (block.type === 'text' && block.text) {
      const draft = textContentDraft(block.text, {
        ...fields,
        id: `${idPrefix}:${index}`,
        label: labelPrefix,
      })
      if (draft) drafts.push(draft)
    } else if (block.type === 'image') {
      drafts.push({
        ...fields,
        id: `${idPrefix}:${index}`,
        label: `${labelPrefix} image`,
        chars: estimatedImageChars,
      })
    }
  }

  return drafts
}

function messageDrafts(message: MessageSource['message'], entryId: string): Contribution[] {
  if (message.role === 'system') return []

  if (message.role === 'assistant') {
    const drafts: ContributionDraft[] = []
    for (const [index, block] of message.content.entries()) {
      if (block.type === 'text' && block.text) {
        drafts.push({
          id: `entry:${entryId}:assistant-text:${index}`,
          label: 'Assistant text',
          group: 'otherConversation',
          kind: 'conversation',
          chars: block.text.length,
          entryId,
        })
      } else if (block.type === 'thinking' && block.thinking) {
        drafts.push({
          id: `entry:${entryId}:assistant-thinking:${index}`,
          label: 'Assistant thinking',
          group: 'otherConversation',
          kind: 'conversation',
          chars: block.thinking.length,
          entryId,
        })
      } else if (block.type === 'toolCall') {
        drafts.push({
          id: `tool-call:${block.id}`,
          label: `${block.name} arguments`,
          group: 'toolCallsAndResults',
          kind: 'tool-call',
          chars: block.name.length + safeJson(block.arguments).length,
          entryId,
          toolName: block.name,
          toolCallId: block.id,
        })
      }
    }
    return allocateEstimate(estimateTokens(message), drafts)
  }

  if (message.role === 'toolResult') {
    const drafts = contentDrafts(
      message.content,
      {
        group: 'toolCallsAndResults',
        kind: 'tool-result',
        entryId,
        toolName: message.toolName,
        toolCallId: message.toolCallId,
        isError: message.isError,
      },
      `tool-result:${message.toolCallId}`,
      `${message.toolName} result`,
    )
    return allocateEstimate(estimateTokens(message), drafts)
  }

  if (message.role === 'user') {
    const drafts = contentDrafts(
      message.content,
      { group: 'otherConversation', kind: 'conversation', entryId },
      `entry:${entryId}:user`,
      'User message',
    )
    return allocateEstimate(estimateTokens(message), drafts)
  }

  if (message.role === 'custom') {
    const drafts = contentDrafts(
      message.content,
      { group: 'otherConversation', kind: 'conversation', entryId, source: message.customType },
      `entry:${entryId}:custom`,
      `Extension message: ${message.customType}`,
    )
    return allocateEstimate(estimateTokens(message), drafts)
  }

  if (message.role === 'bashExecution') {
    const drafts: ContributionDraft[] = []
    const command = textContentDraft(message.command, {
      id: `entry:${entryId}:bash-command`,
      label: 'Bash command',
      group: 'otherConversation',
      kind: 'conversation',
      entryId,
    })
    const output = textContentDraft(message.output, {
      id: `entry:${entryId}:bash-output`,
      label: 'Bash output',
      group: 'otherConversation',
      kind: 'conversation',
      entryId,
    })
    if (command) drafts.push(command)
    if (output) drafts.push(output)
    return allocateEstimate(estimateTokens(message), drafts)
  }

  if (message.role === 'branchSummary' || message.role === 'compactionSummary') {
    const draft = textContentDraft(message.summary, {
      id: `entry:${entryId}:summary`,
      label: message.role === 'branchSummary' ? 'Branch summary' : 'Compaction summary',
      group: 'otherConversation',
      kind: 'conversation',
      entryId,
    })
    return allocateEstimate(estimateTokens(message), draft ? [draft] : [])
  }

  const role = (message as { role: string }).role
  return allocateEstimate(estimateTokens(message), [
    {
      id: `entry:${entryId}:unattributed`,
      label: `Unattributed ${role} content`,
      group: 'unattributedContent',
      kind: 'unattributed',
      chars: estimateTokens(message) * 4,
      entryId,
    },
  ])
}

function sectionDrafts(sectionName: string, section: string, tools: readonly { name: string }[]): ContributionDraft[] {
  if (sectionName.startsWith('metering:instruction:')) {
    const path = sectionName.split(':').slice(3).join(':')
    return [
      {
        id: `instruction:${path}`,
        label: path,
        group: 'systemPromptAndInstructionFiles',
        kind: 'instruction-file',
        source: path,
        chars: section.length,
      },
    ]
  }

  if (sectionName === 'metering:unattributed') {
    return [
      {
        id: 'unattributed:current-prompt',
        label: 'Unattributed current prompt text',
        group: 'unattributedContent',
        kind: 'unattributed',
        chars: section.length,
      },
    ]
  }

  if (sectionName.startsWith('metering:tool-prompt:')) {
    const toolName = sectionName.slice('metering:tool-prompt:'.length)
    return [
      {
        id: `tool-prompt:${toolName}`,
        label: `${toolName} prompt text`,
        group: 'toolDefinitionsAndPromptText',
        kind: 'tool-prompt',
        toolName,
        chars: section.length,
      },
    ]
  }

  if (sectionName === 'project_context') {
    const drafts: ContributionDraft[] = []
    const expression = /<project_instructions path="([^"]+)">[\s\S]*?<\/project_instructions>/g
    let cursor = 0
    for (const match of section.matchAll(expression)) {
      const start = match.index
      const text = match[0] ?? ''
      const path = match[1] ?? ''
      if (start === undefined || !path || !text) continue
      if (start > cursor) {
        drafts.push({
          id: `prompt-section:${sectionName}`,
          label: sectionName,
          group: 'systemPromptAndInstructionFiles',
          kind: 'prompt-section',
          source: sectionName,
          chars: start - cursor,
        })
      }
      drafts.push({
        id: `instruction:${path}`,
        label: path,
        group: 'systemPromptAndInstructionFiles',
        kind: 'instruction-file',
        source: path,
        chars: text.length,
      })
      cursor = start + text.length
    }
    if (cursor < section.length) {
      drafts.push({
        id: `prompt-section:${sectionName}`,
        label: sectionName,
        group: 'systemPromptAndInstructionFiles',
        kind: 'prompt-section',
        source: sectionName,
        chars: section.length - cursor,
      })
    }
    if (drafts.length > 0) return drafts
  }

  if (sectionName === 'tools') {
    const drafts: ContributionDraft[] = []
    const toolNames = tools.map((tool) => tool.name).sort((left, right) => right.length - left.length)
    const lines = section.match(/[^\n]*\n|[^\n]+$/g) ?? []
    for (const [index, line] of lines.entries()) {
      const content = line.endsWith('\n') ? line.slice(0, -1) : line
      const toolName = toolNames.find((name) => content.startsWith(`- ${name}:`))
      drafts.push({
        id: toolName ? `tool-prompt:${toolName}` : `prompt-section:${sectionName}:${index}`,
        label: toolName ? `${toolName} prompt text` : sectionName,
        group: toolName ? 'toolDefinitionsAndPromptText' : 'systemPromptAndInstructionFiles',
        kind: toolName ? 'tool-prompt' : 'prompt-section',
        ...(toolName ? { toolName } : { source: sectionName }),
        chars: line.length,
      })
    }
    if (drafts.length > 0) return drafts
  }

  return [
    {
      id: `prompt-section:${sectionName}`,
      label: sectionName,
      group: sectionName === 'rules' ? 'unattributedContent' : 'systemPromptAndInstructionFiles',
      kind: sectionName === 'rules' ? 'unattributed' : 'prompt-section',
      source: sectionName,
      chars: section.length,
    },
  ]
}

function loadoutDrafts(systemMessage: SystemMessage): ContributionDraft[] {
  const drafts: ContributionDraft[] = []
  const content = systemMessage.content
  if (typeof content === 'string') {
    if (content) {
      drafts.push({
        id: 'system-content',
        label: 'System prompt content',
        group: 'systemPromptAndInstructionFiles',
        kind: 'system-content',
        chars: content.length,
      })
    }
  } else {
    for (const [index, block] of content.entries()) {
      if (block.type === 'text' && block.text) {
        drafts.push({
          id: `system-content:${index}`,
          label: 'System prompt content',
          group: 'systemPromptAndInstructionFiles',
          kind: 'system-content',
          chars: block.text.length,
        })
      }
    }
  }

  const tools = systemMessage.toolsAdded ?? []
  for (const [sectionName, section] of Object.entries(systemMessage.sections ?? {})) {
    if (section !== null) drafts.push(...sectionDrafts(sectionName, section, tools))
  }

  if (tools.length > 0) {
    let individualToolChars = 0
    for (const tool of tools) {
      const chars = safeJson(tool).length
      individualToolChars += chars
      drafts.push({
        id: `tool-definition:${tool.name}`,
        label: `${tool.name} definition`,
        group: 'toolDefinitionsAndPromptText',
        kind: 'tool-definition',
        toolName: tool.name,
        chars,
      })
    }
    const formattingChars = Math.max(0, safeJson(tools).length - individualToolChars)
    if (formattingChars > 0) {
      drafts.push({
        id: 'tool-definition-formatting',
        label: 'Tool declaration formatting',
        group: 'toolDefinitionsAndPromptText',
        kind: 'tool-definition',
        chars: formattingChars,
      })
    }
  }

  return drafts
}

function makeLoadout(
  systemMessages: readonly SystemMessage[],
  fallbackSystemMessage?: SystemMessage,
): { systemMessage?: SystemMessage; contributions: Contribution[]; tokens: number | null } {
  const systemMessage = systemMessages.length > 0 ? getCurrentSystemMessage(systemMessages) : fallbackSystemMessage
  if (!systemMessage) return { contributions: [], tokens: null }

  const tools = systemMessages.length > 0 ? getCurrentTools(systemMessages) : (systemMessage.toolsAdded ?? [])
  const completeSystemMessage = { ...systemMessage, toolsAdded: tools.length > 0 ? tools : undefined }
  const completeTokens = estimateTokens(completeSystemMessage)
  const drafts = loadoutDrafts(completeSystemMessage)
  const contributions = allocateEstimate(completeTokens, drafts)
  return { systemMessage: completeSystemMessage, contributions, tokens: completeTokens }
}

function getMessageContributions(entries: readonly MessageSource[]): Contribution[] {
  return entries.flatMap(({ message, entryId }) => messageDrafts(message, entryId))
}

function createToolAccumulator(): ToolAccumulator {
  return {
    callCount: 0,
    argumentTokens: 0,
    resultTokens: 0,
    resultCount: 0,
    estimatedContextExposureTokens: 0,
    estimatedDefinitionExposureTokens: 0,
    estimatedPromptExposureTokens: 0,
    estimatedArgumentExposureTokens: 0,
    estimatedResultExposureTokens: 0,
  }
}

function addGroupTotals(totals: SourceGroupTotals, contributions: readonly Contribution[]): void {
  for (const contribution of contributions) {
    totals[contribution.group] += contribution.tokens
  }
}

function firstSystemLoadout(session: ParsedSession, fallbackSystemMessage?: SystemMessage): SystemMessage | undefined {
  const messages: SystemMessage[] = []
  for (const entry of session.projection.entries) {
    for (const message of entry.messages) {
      if (message.role === 'system') {
        messages.push(message)
        return getCurrentSystemMessage(messages)
      }
    }
  }
  return session.source === 'current' ? fallbackSystemMessage : undefined
}

function createBaseline(
  session: ParsedSession,
  firstRequest: RequestAnalysis | undefined,
  fallbackSystemMessage?: SystemMessage,
): Baseline {
  if (firstRequest) {
    const available = firstRequest.loadoutTokens !== null
    return {
      available,
      source: available ? firstRequest.loadoutSource : 'unavailable',
      tokens: firstRequest.loadoutTokens,
      contributions: available
        ? firstRequest.contributions.filter((contribution) => contribution.entryId === undefined)
        : [],
      ...(firstRequest.loadoutMessage === undefined ? {} : { systemMessage: firstRequest.loadoutMessage }),
    }
  }

  const systemMessage = firstSystemLoadout(session, fallbackSystemMessage)
  const loadout = systemMessage ? makeLoadout([], systemMessage) : undefined
  return {
    available: loadout?.tokens !== null && loadout?.tokens !== undefined,
    source:
      loadout?.tokens === null || loadout?.tokens === undefined
        ? 'unavailable'
        : session.source === 'current' &&
            session.projection.entries.every((entry) => !entry.messages.some((message) => message.role === 'system'))
          ? 'current-configuration'
          : 'saved',
    tokens: loadout?.tokens ?? null,
    contributions: loadout?.tokens === null || loadout?.tokens === undefined ? [] : loadout.contributions,
    ...(loadout?.systemMessage === undefined ? {} : { systemMessage: toMessageView(loadout.systemMessage) }),
  }
}

function toolCallIds(messages: readonly MessageSource['message'][]): string[] {
  const ids = new Set<string>()
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const block of message.content) {
        if (block.type === 'toolCall') ids.add(block.id)
      }
    } else if (message.role === 'toolResult') {
      ids.add(message.toolCallId)
    }
  }
  return [...ids]
}

function toMessageView(message: AgentMessage): MessageView {
  if (message.role === 'system') {
    return {
      role: message.role,
      content: message.content,
      sections: message.sections,
      toolsAdded: message.toolsAdded,
      toolsRemoved: message.toolsRemoved,
      timestamp: message.timestamp,
    }
  }
  if (message.role === 'assistant') {
    return {
      role: message.role,
      content: message.content,
      model: `${message.provider}/${message.model}`,
      timestamp: message.timestamp,
    }
  }
  if (message.role === 'toolResult') {
    return {
      role: message.role,
      content: message.content,
      toolCallId: message.toolCallId,
      toolName: message.toolName,
      isError: message.isError,
      timestamp: message.timestamp,
    }
  }
  if (message.role === 'user') {
    return { role: message.role, content: message.content, timestamp: message.timestamp }
  }
  if (message.role === 'custom') {
    return {
      role: message.role,
      content: message.content,
      customType: message.customType,
      timestamp: message.timestamp,
    }
  }
  if (message.role === 'bashExecution') {
    return {
      role: message.role,
      command: message.command,
      output: message.output,
      exitCode: message.exitCode,
      cancelled: message.cancelled,
      truncated: message.truncated,
      timestamp: message.timestamp,
    }
  }
  if (message.role === 'branchSummary' || message.role === 'compactionSummary') {
    return { role: message.role, summary: message.summary, timestamp: message.timestamp }
  }
  return { role: (message as { role: string }).role }
}

function createEntryStatistics(
  session: ParsedSession,
  contributions: readonly Contribution[],
  requestExposure: RequestExposure,
  includedEntryIds: readonly string[],
): EntryStatistics[] {
  const exposureByEntry = new Map<string, number>()
  for (const contribution of contributions) {
    if (!contribution.entryId) continue
    exposureByEntry.set(contribution.entryId, (exposureByEntry.get(contribution.entryId) ?? 0) + contribution.tokens)
  }
  const includedEntries = new Set(includedEntryIds)

  return session.projection.entries.flatMap(({ sourceEntry, messages }) => {
    const currentMessages = messages.filter((message) => message.role !== 'system')
    if (currentMessages.length === 0) return []

    const messageViews = currentMessages.map(toMessageView)
    const messageTokens = currentMessages.reduce((sum, message) => sum + estimateTokens(message), 0)
    const messageAdditionTokens = exposureByEntry.get(sourceEntry.id) ?? 0
    const role = currentMessages[0]?.role
    const customType = currentMessages.find((message) => message.role === 'custom')?.customType
    const providerUsage = currentMessages.find(
      (message): message is AssistantMessage => message.role === 'assistant',
    )?.usage

    return [
      {
        entryId: sourceEntry.id,
        entryType: sourceEntry.type,
        ...(role === undefined ? {} : { role }),
        ...(customType === undefined ? {} : { customType }),
        timestamp: sourceEntry.timestamp,
        contextStatus: 'current' as const,
        messageAdditionTokens,
        historicalTokens: messageTokens,
        cumulativeRequestExposure: messageAdditionTokens,
        exposureShare:
          requestExposure.complete && requestExposure.tokens !== null && requestExposure.tokens > 0
            ? (messageAdditionTokens / requestExposure.tokens) * 100
            : null,
        latestRequestIncluded: includedEntries.has(sourceEntry.id),
        toolCallIds: toolCallIds(currentMessages),
        rawMessages: messageViews,
        effectiveMessages: messageViews,
        ...(providerUsage === undefined ? {} : { providerUsage }),
      },
    ]
  })
}

function ensureToolInvocation(
  invocations: Map<string, ToolInvocationAccumulator>,
  toolName: string,
  toolCallId: string,
): ToolInvocationAccumulator {
  const invocation = invocations.get(toolCallId)
  if (invocation) return invocation

  const created: ToolInvocationAccumulator = {
    toolName,
    toolCallId,
    argumentTokens: 0,
    resultTokens: 0,
    isError: null,
    latestRequestTokens: 0,
  }
  invocations.set(toolCallId, created)
  return created
}

function collectToolInvocations(
  contributions: readonly Contribution[],
  footprintTokens: number | null,
): ToolInvocationStatistics[] {
  const invocations = new Map<string, ToolInvocationAccumulator>()

  for (const contribution of contributions) {
    if (!contribution.toolName || !contribution.toolCallId) continue
    if (contribution.kind !== 'tool-call' && contribution.kind !== 'tool-result') continue

    const invocation = ensureToolInvocation(invocations, contribution.toolName, contribution.toolCallId)
    invocation.latestRequestTokens += contribution.tokens
    if (contribution.kind === 'tool-call') {
      invocation.callEntryId ??= contribution.entryId
      invocation.argumentTokens += contribution.tokens
    } else {
      invocation.resultEntryId ??= contribution.entryId
      invocation.isError = contribution.isError ?? null
      invocation.resultTokens += contribution.tokens
    }
  }

  return [...invocations.values()].map((invocation) => ({
    ...invocation,
    oneTimeInteractionTokens: invocation.argumentTokens + invocation.resultTokens,
    latestRequestShare:
      footprintTokens !== null && footprintTokens > 0 ? (invocation.latestRequestTokens / footprintTokens) * 100 : null,
  }))
}

function buildPromptStatistics(
  requests: readonly RequestAnalysis[],
  requestExposure: RequestExposure,
): PromptStatistics[] {
  const totals = new Map<string, PromptStatistics>()
  const latest = requests.at(-1)

  for (const request of requests) {
    for (const contribution of request.contributions) {
      if (
        contribution.kind !== 'prompt-section' &&
        contribution.kind !== 'instruction-file' &&
        contribution.kind !== 'system-content' &&
        contribution.kind !== 'unattributed'
      ) {
        continue
      }
      const kind =
        contribution.kind === 'instruction-file'
          ? 'instruction-file'
          : contribution.kind === 'unattributed'
            ? 'unattributed'
            : 'prompt-section'
      const current = totals.get(contribution.id) ?? {
        id: contribution.id,
        label: contribution.label,
        ...(contribution.source === undefined ? {} : { source: contribution.source }),
        kind,
        cumulativeRequestExposure: 0,
        exposureShare: null,
        latestRequestTokens: 0,
      }
      current.cumulativeRequestExposure += contribution.tokens
      if (request === latest) current.latestRequestTokens += contribution.tokens
      totals.set(contribution.id, current)
    }
  }

  return [...totals.values()]
    .map((item) => ({
      ...item,
      exposureShare:
        requestExposure.complete && requestExposure.tokens !== null && requestExposure.tokens > 0
          ? (item.cumulativeRequestExposure / requestExposure.tokens) * 100
          : null,
    }))
    .sort((left, right) => right.cumulativeRequestExposure - left.cumulativeRequestExposure)
}

function buildToolStatistics(
  requests: readonly RequestAnalysis[],
  invocations: readonly ToolInvocationStatistics[],
  definitions: ReadonlyMap<string, ToolDefinitionInfo>,
): ToolStatistics[] {
  const accumulators = new Map<string, ToolAccumulator>(
    [...definitions.keys()].map((name) => [name, createToolAccumulator()]),
  )

  for (const request of requests) {
    for (const contribution of request.contributions) {
      if (!contribution.toolName) continue
      const accumulator = accumulators.get(contribution.toolName) ?? createToolAccumulator()
      accumulators.set(contribution.toolName, accumulator)
      accumulator.estimatedContextExposureTokens += contribution.tokens
      if (contribution.kind === 'tool-definition') accumulator.estimatedDefinitionExposureTokens += contribution.tokens
      if (contribution.kind === 'tool-prompt') accumulator.estimatedPromptExposureTokens += contribution.tokens
      if (contribution.kind === 'tool-call') accumulator.estimatedArgumentExposureTokens += contribution.tokens
      if (contribution.kind === 'tool-result') accumulator.estimatedResultExposureTokens += contribution.tokens
    }
  }

  for (const invocation of invocations) {
    const accumulator = accumulators.get(invocation.toolName) ?? createToolAccumulator()
    accumulators.set(invocation.toolName, accumulator)
    if (invocation.callEntryId) accumulator.callCount += 1
    if (invocation.resultEntryId) accumulator.resultCount += 1
    accumulator.argumentTokens += invocation.argumentTokens
    accumulator.resultTokens += invocation.resultTokens
  }

  return [...accumulators.entries()]
    .map(([name, accumulator]) => ({
      name,
      ...(definitions.get(name) === undefined ? {} : { description: definitions.get(name)?.description }),
      ...(definitions.get(name) === undefined ? {} : { parameterSchema: definitions.get(name)?.parameters }),
      callCount: accumulator.callCount,
      argumentTokens: accumulator.argumentTokens,
      totalResultTokens: accumulator.resultTokens,
      averageResultTokens: accumulator.resultTokens / (accumulator.resultCount || 1),
      oneTimeInteractionTokens: accumulator.argumentTokens + accumulator.resultTokens,
      estimatedContextExposureTokens: accumulator.estimatedContextExposureTokens,
      estimatedDefinitionExposureTokens: accumulator.estimatedDefinitionExposureTokens,
      estimatedPromptExposureTokens: accumulator.estimatedPromptExposureTokens,
      estimatedArgumentExposureTokens: accumulator.estimatedArgumentExposureTokens,
      estimatedResultExposureTokens: accumulator.estimatedResultExposureTokens,
    }))
    .sort(
      (left, right) =>
        right.estimatedContextExposureTokens - left.estimatedContextExposureTokens ||
        right.callCount - left.callCount ||
        right.oneTimeInteractionTokens - left.oneTimeInteractionTokens ||
        left.name.localeCompare(right.name),
    )
}

function analyzeSession(session: ParsedSession, options: AnalysisOptions = {}): SessionAnalysis {
  const systemMessages: SystemMessage[] = []
  const conversationMessages: MessageSource[] = []
  let endpointAssistant: { entryId: string; timestamp: string; message: AssistantMessage } | undefined

  for (const entry of session.projection.entries) {
    options.signal?.throwIfAborted()
    for (const message of entry.messages) {
      if (message.role === 'system') {
        systemMessages.push(message)
        continue
      }

      conversationMessages.push({ message, entryId: entry.sourceEntry.id })
      if (message.role === 'assistant') {
        endpointAssistant = { entryId: entry.sourceEntry.id, timestamp: entry.sourceEntry.timestamp, message }
      }
    }
  }

  const fallback =
    session.source === 'current' && systemMessages.length === 0 ? options.fallbackSystemMessage : undefined
  const loadout = makeLoadout(systemMessages, fallback)
  const toolDefinitions = new Map<string, ToolDefinitionInfo>()
  for (const tool of loadout.systemMessage?.toolsAdded ?? []) toolDefinitions.set(tool.name, tool)

  const messageContributions = getMessageContributions(conversationMessages)
  const contributions = [...loadout.contributions, ...messageContributions]
  const conversationTokens = sumTokens(messageContributions)
  const footprintTokens = loadout.tokens === null ? null : loadout.tokens + conversationTokens
  const knownTokens = loadout.tokens === null ? conversationTokens : (footprintTokens ?? conversationTokens)
  const hasContext = conversationMessages.length > 0 || loadout.systemMessage !== undefined
  const endpointEntry = session.projection.entries.at(-1)?.sourceEntry
  const currentContext: RequestAnalysis | undefined = hasContext
    ? {
        index: 1,
        responseEntryId: endpointAssistant?.entryId ?? endpointEntry?.id ?? session.leafId ?? '',
        timestamp: endpointAssistant?.timestamp ?? endpointEntry?.timestamp ?? '',
        footprintTokens,
        loadoutSource: loadout.tokens === null ? 'unavailable' : fallback ? 'current-configuration' : 'saved',
        ...(loadout.systemMessage === undefined ? {} : { loadoutMessage: toMessageView(loadout.systemMessage) }),
        inputEntryIds: session.projection.entries
          .filter((entry) => entry.messages.length > 0)
          .map((entry) => entry.sourceEntry.id),
        knownTokens,
        loadoutTokens: loadout.tokens,
        conversationTokens,
        contributions,
        ...(endpointAssistant === undefined
          ? {}
          : {
              providerUsage: endpointAssistant.message.usage,
              model: `${endpointAssistant.message.provider}/${endpointAssistant.message.model}`,
            }),
      }
    : undefined
  const requests = currentContext === undefined ? [] : [currentContext]
  const warnings: string[] = []

  if (currentContext?.footprintTokens === null) {
    warnings.push(
      `Request ${currentContext.index} has no saved system snapshot, so its loadout estimate is unavailable.`,
    )
  }

  const baseline = createBaseline(session, currentContext, options.fallbackSystemMessage)
  const requestExposure: RequestExposure = {
    tokens: currentContext === undefined ? 0 : currentContext.footprintTokens,
    knownTokens: currentContext?.knownTokens ?? 0,
    complete: currentContext === undefined || currentContext.footprintTokens !== null,
  }
  const totals = createEmptyGroupTotals()
  addGroupTotals(totals, contributions)
  const toolInvocations = collectToolInvocations(contributions, currentContext?.footprintTokens ?? null)
  const tools = buildToolStatistics(requests, toolInvocations, toolDefinitions)
  const sharedToolContextExposureTokens = contributions.reduce(
    (total, contribution) =>
      total +
      (!contribution.toolName &&
      (contribution.group === 'toolDefinitionsAndPromptText' ||
        contribution.group === 'toolCallsAndResults' ||
        contribution.source === 'tools')
        ? contribution.tokens
        : 0),
    0,
  )
  const entries = createEntryStatistics(session, contributions, requestExposure, currentContext?.inputEntryIds ?? [])
  const oneTimeMessageAdditionsTokens = entries.reduce((sum, entry) => sum + entry.messageAdditionTokens, 0)

  if (!baseline.available) {
    warnings.push(
      session.source === 'current'
        ? 'The current system configuration is unavailable, so the empty-history baseline is unavailable.'
        : 'The selected session has no saved system snapshot, so the empty-history baseline is unavailable.',
    )
  }
  if (!requestExposure.complete)
    warnings.push('The request-context estimate is incomplete because one or more request loadouts are unavailable.')

  return {
    sessionId: session.sessionId,
    cwd: session.cwd,
    source: session.source,
    ...(session.filePath === undefined ? {} : { filePath: session.filePath }),
    selectedLeafId: session.leafId,
    analyzedAt: new Date().toISOString(),
    tokenEstimateMethod: 'Pi estimateTokens() and its character-based section and tool estimates',
    baseline,
    latestRequestFootprintTokens: currentContext?.footprintTokens ?? null,
    requestCount: requests.length,
    requestExposure,
    oneTimeMessageAdditionsTokens,
    sourceGroups: totals,
    sharedToolContextExposureTokens,
    requests,
    tools,
    toolInvocations,
    promptSections: buildPromptStatistics(requests, requestExposure),
    entries,
    warnings: [...new Set(warnings)],
  }
}

export {
  type AnalysisOptions,
  analyzeSession,
  type Baseline,
  buildCurrentSystemMessage,
  type Contribution,
  type ContributionKind,
  type EntryStatistics,
  type MessageView,
  type PromptStatistics,
  type RequestAnalysis,
  type RequestExposure,
  type SessionAnalysis,
  type SourceGroup,
  type SourceGroupTotals,
  type ToolInvocationStatistics,
  type ToolStatistics,
}

type VisibleEntryMessage = {
  message: MessageView
}

type ToolLinkTargets = {
  calls: Map<string, string>
  results: Map<string, string>
  tools: Map<string, string>
}

type SourceMetrics = {
  loadoutTokens: number | null
  oneTimeTokens: number | null
  latestRequestTokens: number
  latestIncluded: boolean
}

type SourceGroupDescription = {
  key: keyof SessionAnalysis['sourceGroups']
  label: string
  color: string
}

const sourceGroupDescriptions: readonly SourceGroupDescription[] = [
  { key: 'systemPromptAndInstructionFiles', label: 'System prompt and instruction files', color: '#61a5c2' },
  { key: 'toolDefinitionsAndPromptText', label: 'Tool definitions and attributable prompt text', color: '#9b8bd1' },
  { key: 'toolCallsAndResults', label: 'Tool calls and results', color: '#e1a85d' },
  { key: 'otherConversation', label: 'Other conversation', color: '#77b889' },
  { key: 'unattributedContent', label: 'Unattributed content', color: '#d77777' },
]

const reportStyles = `
:root{color-scheme:dark;--bg:#111820;--panel:#19232d;--panel-2:#202d38;--text:#e8eef3;--muted:#a6b3bf;--line:#354552;--accent:#70c1d6;--warning:#f1c979;--good:#83c99b;--bad:#ef9191;font:15px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text)}
a{color:#9bd8e8}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.skip-link{position:absolute;left:16px;top:-60px;z-index:50;background:var(--accent);color:#0b171d;padding:8px 12px;border-radius:6px}
.skip-link:focus{top:8px}
button{font:inherit}
header,.page{width:min(1240px,100% - 32px);margin:0 auto}
header{padding:32px 0 20px}
h1,h2,h3,h4,p{margin-top:0}
h1{font-size:clamp(2rem,4vw,3rem);line-height:1.1;margin-bottom:12px}
h2{font-size:1.45rem;margin:32px 0 14px}
h3{font-size:1.05rem;margin-bottom:8px}
.eyebrow,.muted,.subtle{color:var(--muted)}
.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:.76rem;font-weight:700}
.warning{border:1px solid #725f34;border-left:4px solid var(--warning);background:#292518;color:#f7e7bf;padding:12px 14px;border-radius:8px}
.metadata{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px 18px;margin:20px 0}
.metadata div,.card,.panel,.entry,.loadout-event{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:13px}
.metadata dt,.metric-label{font-size:.78rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}
.metadata dd{margin:2px 0 0;overflow-wrap:anywhere}
.tabs{position:sticky;top:0;z-index:20;display:flex;gap:8px;padding:10px max(16px,calc((100vw - 1240px)/2));background:#111820ed;border-bottom:1px solid var(--line);backdrop-filter:blur(12px)}
.tab{border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--text);padding:9px 16px;cursor:pointer}
.tab[aria-selected="true"]{background:var(--accent);border-color:var(--accent);color:#0b171d;font-weight:700}
.page{padding-bottom:56px}
[hidden]{display:none!important}
.metrics-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
.metric-card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:15px}
.metric-value{font-size:1.45rem;font-variant-numeric:tabular-nums;font-weight:700;margin:5px 0 0}
.metric-note{color:var(--muted);font-size:.82rem;margin:4px 0 0}
.loadout{display:grid;gap:10px}
.loadout-summary{color:var(--muted);margin-bottom:10px}
.source-row,.detail-popover,.message-detail{position:relative;border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:9px 11px;margin:8px 0}
.source-row>summary,.detail-popover>summary,.message-detail>summary,.inline-cost-details>summary{cursor:pointer;font-weight:650}
.source-row pre,.detail-popover pre,.message-detail pre,.message-text,.tool-output,.tool-arguments{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}
.source-row pre,.detail-popover pre,.message-detail pre{margin:10px 0 0;background:#10171d;padding:10px;border-radius:6px;max-height:420px;overflow:auto}
.popover{display:none;position:absolute;z-index:30;left:0;top:calc(100% + 6px);width:min(440px,85vw);padding:12px;background:#0c1217;border:1px solid #6b8494;border-radius:8px;box-shadow:0 12px 32px #0009}
.detail-popover:hover .popover,.detail-popover:focus-within .popover,.detail-popover[open] .popover{display:block}
.source-row:not([open]):hover>:not(summary),.source-row:not([open]):focus-within>:not(summary){display:block}
.source-row:hover .detail-popover .popover,.source-row:focus-within .detail-popover .popover{display:block}
.inline-cost-details{margin-top:8px}
.inline-cost-detail-content{padding-top:8px}
.popover dl,.inline-cost-detail-content dl{display:grid;grid-template-columns:minmax(130px,.8fr) 1.2fr;gap:4px 10px;margin:0}
.popover dt,.inline-cost-detail-content dt{color:var(--muted)}
.popover dd,.inline-cost-detail-content dd{margin:0;overflow-wrap:anywhere}
.detail-list{display:grid;gap:8px}
.detail-list .source-row{margin:0}
.timeline{list-style:none;padding:0;margin:0;display:grid;gap:12px}
.entry{scroll-margin-top:80px;padding:0;overflow:hidden}
.entry[open]{overflow:visible;position:relative;z-index:1}
.entry[open]:hover,.entry[open]:focus-within{z-index:2}
.entry-node{margin:0}
.entry-summary{list-style:none;display:grid;grid-template-columns:16px minmax(180px,1fr) minmax(112px,auto) minmax(118px,auto) minmax(100px,auto) auto;align-items:center;gap:12px;padding:12px;cursor:pointer}
.entry-summary::-webkit-details-marker,.tool-card-summary::-webkit-details-marker,.invocation-summary::-webkit-details-marker{display:none}
.disclosure-glyph{color:var(--accent);font-size:1.15rem;line-height:1;transition:transform .15s ease}
.entry[open]>.entry-summary .disclosure-glyph,.tool-card[open]>.tool-card-summary .disclosure-glyph,.invocation-row[open]>.invocation-summary .disclosure-glyph{transform:rotate(90deg)}
.entry-summary:hover,.tool-card-summary:hover,.invocation-summary:hover{background:var(--panel-2)}
.entry[open]>.entry-summary,.tool-card[open]>.tool-card-summary{border-bottom:1px solid var(--line);background:var(--panel-2)}
.entry-main{display:flex;align-items:center;gap:9px;min-width:0}
.entry-role{font-weight:700;white-space:nowrap}
.entry-preview{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}
.entry-timestamp{color:var(--muted);font-size:.78rem;white-space:nowrap}
.entry-token-count,.entry-share{display:grid;gap:1px;white-space:nowrap;font-variant-numeric:tabular-nums}
.entry-token-count small,.entry-share small{font-size:.7rem;color:var(--muted)}
.entry-expanded{padding:0 13px 13px}
.nested-entry-list{list-style:none;margin:8px 0 0 22px;padding:0 0 0 14px;border-left:2px solid var(--line);display:grid;gap:8px}
.nested-entry-list>.entry-node{position:relative}
.nested-entry-list>.entry-node::before{content:"";position:absolute;left:-16px;top:22px;width:14px;border-top:2px solid var(--line)}
.entry-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.entry-title{margin:0}
.entry-meta,.badges{display:flex;gap:7px;align-items:center;flex-wrap:wrap;color:var(--muted);font-size:.84rem}
.badge{display:inline-block;border:1px solid var(--line);border-radius:99px;padding:2px 8px;font-size:.78rem;color:var(--muted)}
.badge-current{border-color:#416e51;color:#b7e8c3}.badge-omitted,.badge-compacted,.badge-historical{border-color:#79524f;color:#f0b3a9}.badge-replaced{border-color:#826c3e;color:#f3d68d}
.entry-metrics{display:flex;gap:14px;flex-wrap:wrap;padding:8px 0;color:var(--muted);font-size:.84rem}
.message{border-top:1px solid var(--line);padding:12px 0 2px;overflow-wrap:anywhere}
.message.historical{opacity:.78}
.message-role{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700}
.message-text{margin:7px 0}
.tool-message{background:var(--panel-2);border-left:3px solid #c5904f;border-radius:6px;padding:10px;margin:9px 0}
.tool-message.error{border-left-color:var(--bad)}
.tool-heading{display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap}
.tool-links{display:flex;gap:10px;flex-wrap:wrap;font-size:.86rem}
.tool-definition{margin:8px 0}
.tool-definition summary{cursor:pointer;color:#c6b6ed}
.tool-list{display:grid;gap:10px}
.tool-card{border:1px solid var(--line);border-radius:10px;background:var(--panel)}
.tool-card-summary{list-style:none;display:grid;grid-template-columns:16px minmax(130px,1fr) minmax(180px,1.15fr) minmax(180px,1.2fr) minmax(190px,1.2fr);align-items:center;gap:12px;padding:12px;cursor:pointer}
.tool-card-name{font-weight:750;overflow-wrap:anywhere}
.tool-card-static,.tool-card-dynamic,.tool-card-outcomes{display:grid;gap:2px;line-height:1.35}
.tool-card-static small,.tool-card-dynamic small,.tool-card-outcomes small{font-size:.75rem;color:var(--muted)}
.tool-card-static strong,.tool-card-dynamic strong,.tool-card-outcomes strong{font-variant-numeric:tabular-nums}
.tool-card-expanded{border-top:1px solid var(--line);padding:12px}
.tool-total-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:8px;margin:10px 0}
.tool-total-metrics div{border:1px solid var(--line);border-radius:8px;background:var(--panel-2);padding:8px}
.tool-total-metrics dt{font-size:.75rem;color:var(--muted)}
.tool-total-metrics dd{margin:2px 0 0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.invocation-timeline{list-style:none;display:grid;gap:8px;margin:0;padding:0}
.invocation-node{margin:0}
.invocation-row{border:1px solid var(--line);border-radius:8px;background:var(--panel-2)}
.invocation-summary{list-style:none;display:grid;grid-template-columns:16px minmax(140px,1fr) minmax(90px,auto) minmax(230px,1.2fr);align-items:center;gap:12px;padding:10px;cursor:pointer}
.invocation-summary time{font-size:.82rem;color:var(--muted);font-variant-numeric:tabular-nums}
.outcome{display:inline-block;width:max-content;border:1px solid var(--line);border-radius:99px;padding:1px 8px;font-size:.8rem;white-space:nowrap}
.outcome-success{border-color:#416e51;color:#b7e8c3}
.outcome-failure{border-color:#79524f;color:#f0b3a9}
.outcome-unknown{border-color:#826c3e;color:#f3d68d}
.invocation-token-summary{display:flex;justify-content:flex-end;align-items:center;gap:6px;font-variant-numeric:tabular-nums}
.invocation-token-summary span{font-size:.76rem;color:var(--muted)}
.invocation-expanded{padding:0 10px 10px}
.tool-invocation-links{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:.86rem}
.tool-invocation-links>span{color:var(--muted)}
.tool-arguments,.tool-output{margin:8px 0 0;background:#10171d;padding:10px;border-radius:6px;max-height:420px;overflow:auto}
.prompt-change{border-color:#547b89;background:#172831}
.prompt-change h3{margin-bottom:4px}
.image-preview{display:block;max-width:min(100%,640px);max-height:480px;object-fit:contain;margin:8px 0;border:1px solid var(--line);border-radius:8px}
.request-composition,.advanced-estimates{border:1px solid var(--line);border-radius:10px;background:var(--panel);padding:12px;margin:12px 0}
.request-composition-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
.request-composition-heading h3{margin-bottom:4px}
.request-composition-heading p{margin-bottom:0}
.request-composition-heading>strong{font-size:1.2rem;white-space:nowrap;font-variant-numeric:tabular-nums}
.request-composition-bar{display:flex;overflow:hidden;height:18px;border:1px solid var(--line);border-radius:99px;background:var(--panel-2)}
.request-composition-segment{display:block;height:100%;min-width:1px}
.legend-name{display:flex;align-items:center;gap:8px;min-width:0}
.advanced-estimates>summary{cursor:pointer;font-weight:700}
.chart-layout{display:grid;grid-template-columns:minmax(200px,280px) 1fr;gap:20px;align-items:center}
.donut{width:100%;max-width:260px;height:auto}
.chart-legend{list-style:none;margin:0;padding:0;display:grid;gap:7px}
.chart-legend li{display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid var(--line);padding:6px 0}
.legend-label{display:flex;align-items:center;gap:8px}
.swatch{width:12px;height:12px;border-radius:3px;flex:0 0 12px}
.legend-value,.number{font-variant-numeric:tabular-nums;white-space:nowrap}
.table-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:9px}
table{border-collapse:collapse;width:100%;min-width:920px;background:var(--panel)}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{position:sticky;top:0;background:var(--panel-2);font-size:.8rem;color:var(--muted)}
td.number{text-align:right}
.largest{color:#ffe09b;font-weight:750;background:#43371e}
.largest::after{content:" largest";display:block;font-size:.68rem;color:#f1d49a}
.status-note{padding:10px 12px;background:var(--panel-2);border-radius:8px;color:var(--muted)}
.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap}
.provider-table{min-width:700px}
footer{border-top:1px solid var(--line);margin-top:32px;padding:16px 0;color:var(--muted);font-size:.85rem}
@media(max-width:680px){header,.page{width:calc(100% - 22px)}header{padding-top:22px}.chart-layout{grid-template-columns:1fr}.donut{max-width:220px;margin:auto}.popover{position:fixed;left:5vw;top:auto;bottom:12px;width:90vw;max-height:65vh;overflow:auto}.entry-metrics{gap:8px}.tab{flex:1}}
.tool-definition-details{border:1px solid var(--line);border-radius:8px;background:var(--panel);padding:9px 11px;margin:8px 0}
.tool-definition-details>summary{cursor:pointer;font-weight:650}
.tool-definition-content{padding-top:8px}
.tool-definition-content p{margin:0}
.tool-definition-content pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:10px 0 0;background:#10171d;padding:10px;border-radius:6px;max-height:420px;overflow:auto}
@media(max-width:680px){.entry-summary{grid-template-columns:16px minmax(0,1fr) auto;gap:7px}.entry-main{grid-column:2/-1}.entry-timestamp{grid-column:2;grid-row:2}.entry-token-count{grid-column:3;grid-row:2;justify-self:end}.entry-share{grid-column:2;grid-row:3}.entry-summary>.badge{grid-column:3;grid-row:3;justify-self:end}.nested-entry-list{margin-left:12px;padding-left:10px}.tool-card-summary{grid-template-columns:16px minmax(0,1fr) minmax(0,1fr);gap:8px}.tool-card-name{grid-column:2/-1}.tool-card-static{grid-column:2}.tool-card-dynamic{grid-column:3}.tool-card-outcomes{grid-column:2/-1}.invocation-summary{grid-template-columns:16px minmax(0,1fr) auto;gap:8px}.invocation-summary time{grid-column:2}.invocation-summary .outcome{grid-column:3;grid-row:1}.invocation-token-summary{grid-column:2/-1;justify-content:flex-start}.request-composition-heading{flex-direction:column}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
`

const reportScript = `
const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
function activateTab(tab) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    const panel = document.getElementById(item.getAttribute('aria-controls'));
    if (panel) panel.hidden = !selected;
  }
}
for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => activateTab(tab));
  tab.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = tabs[(index + offset + tabs.length) % tabs.length];
    if (next) {
      next.focus();
      activateTab(next);
    }
  });
}
function activateHashTarget() {
  if (!location.hash) return;
  const target = document.getElementById(location.hash.slice(1));
  if (!target) return;
  const panel = target.closest('[role="tabpanel"]');
  const tab = tabs.find((item) => item.getAttribute('aria-controls') === panel?.id);
  if (tab) activateTab(tab);
  for (let current = target; current; current = current.parentElement) {
    if (current instanceof HTMLDetailsElement) current.open = true;
  }
  target.scrollIntoView({ block: 'start' });
}
window.addEventListener('hashchange', activateHashTarget);
activateHashTarget();
`

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === '&') return '&amp;'
    if (character === '<') return '&lt;'
    if (character === '>') return '&gt;'
    if (character === '"') return '&quot;'
    return '&#39;'
  })
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable'
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value)
}

function tokenLabel(value: number | null | undefined): string {
  const formatted = formatTokens(value)
  return formatted === 'Unavailable' ? formatted : `${formatted} ${value === 1 ? 'token' : 'tokens'}`
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Unavailable'
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 }).format(value)}%`
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return '[Structured content could not be displayed]'
  }
}

function getVisibleEntryMessages(entry: EntryStatistics): VisibleEntryMessage[] {
  return entry.effectiveMessages.map((message) => ({ message }))
}

function getContentBlocks(content: unknown): Record<string, unknown>[] {
  return Array.isArray(content) ? content.filter(isRecord) : []
}

function createToolLinkTargets(analysis: SessionAnalysis): ToolLinkTargets {
  const calls = new Map<string, string>()
  const results = new Map<string, string>()
  const tools = new Map<string, string>()

  for (const [entryIndex, entry] of analysis.entries.entries()) {
    for (const [messageIndex, visible] of getVisibleEntryMessages(entry).entries()) {
      const message = visible.message
      if (message.role === 'assistant') {
        for (const [blockIndex, block] of getContentBlocks(message.content).entries()) {
          if (block.type === 'toolCall' && typeof block.id === 'string') {
            calls.set(block.id, `call-${entryIndex}-${messageIndex}-${blockIndex}`)
          }
        }
      } else if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
        results.set(message.toolCallId, `result-${entryIndex}-${messageIndex}`)
      }
    }
  }

  for (const [index, tool] of analysis.tools.entries()) tools.set(tool.name, `tool-card-${index}`)

  return { calls, results, tools }
}

function renderCostRows(source: string, identifier: string, metrics: SourceMetrics): string {
  const contextLabel = metrics.latestIncluded ? 'Included' : 'Not included'
  return `<dl><dt>Source</dt><dd>${escapeHtml(source)}</dd><dt>Source, entry, or call ID</dt><dd>${escapeHtml(identifier || 'Unavailable')}</dd><dt>System snapshot estimate</dt><dd>${tokenLabel(metrics.loadoutTokens)}</dd><dt>One-time message addition</dt><dd>${tokenLabel(metrics.oneTimeTokens)}</dd><dt>Selected-context contribution</dt><dd>${tokenLabel(metrics.latestRequestTokens)}</dd><dt>Selected-context inclusion</dt><dd>${contextLabel}</dd></dl>`
}

function renderCostDetails(label: string, source: string, identifier: string, metrics: SourceMetrics): string {
  return `<details class="inline-cost-details"><summary>${escapeHtml(label)}</summary><div class="inline-cost-detail-content">${renderCostRows(source, identifier, metrics)}</div></details>`
}

function contributionMetrics(
  analysis: SessionAnalysis,
  contributions: readonly Contribution[],
  loadoutTokens: number | null = contributions.length > 0 ? sumTokens(contributions) : null,
): SourceMetrics {
  const identifiers = new Set(contributions.map((item) => item.id))
  const latestRequest = analysis.requests.at(-1)
  const latestRequestTokens =
    latestRequest?.contributions.reduce((total, item) => total + (identifiers.has(item.id) ? item.tokens : 0), 0) ?? 0
  return {
    loadoutTokens,
    oneTimeTokens: null,
    latestRequestTokens,
    latestIncluded: latestRequest?.contributions.some((item) => identifiers.has(item.id)) ?? false,
  }
}

function getSectionContributions(
  sectionName: string,
  text: string,
  contributions: readonly Contribution[],
): Contribution[] {
  if (sectionName.startsWith('metering:instruction:')) {
    const source = sectionName.split(':').slice(3).join(':')
    return contributions.filter((item) => item.kind === 'instruction-file' && item.source === source)
  }
  if (sectionName.startsWith('metering:tool-prompt:')) {
    const toolName = sectionName.slice('metering:tool-prompt:'.length)
    return contributions.filter((item) => item.kind === 'tool-prompt' && item.toolName === toolName)
  }
  if (sectionName === 'metering:unattributed') {
    return contributions.filter((item) => item.id === 'unattributed:current-prompt')
  }
  if (sectionName === 'project_context') {
    return contributions.filter(
      (item) =>
        item.source === 'project_context' ||
        (item.kind === 'instruction-file' && item.source !== undefined && text.includes(`path="${item.source}"`)),
    )
  }
  return contributions.filter(
    (item) =>
      item.source === sectionName ||
      item.id === `prompt-section:${sectionName}` ||
      (sectionName === 'tools' && item.kind === 'tool-prompt'),
  )
}

function sectionLabel(sectionName: string): string {
  if (sectionName === 'metering:unattributed') return 'Unattributed current prompt text'
  if (sectionName.startsWith('metering:instruction:')) {
    return `Instruction file: ${sectionName.split(':').slice(3).join(':')}`
  }
  if (sectionName.startsWith('metering:tool-prompt:')) {
    return `Tool prompt text: ${sectionName.slice('metering:tool-prompt:'.length)}`
  }
  return sectionName
}

function renderInstructionFiles(
  section: string,
  analysis: SessionAnalysis,
  contributions: readonly Contribution[],
): string {
  const pattern = /<project_instructions path="([^"]+)">([\s\S]*?)<\/project_instructions>/g
  const matches = [...section.matchAll(pattern)]
  if (matches.length === 0) return `<pre>${escapeHtml(section)}</pre>`

  const parts: string[] = []
  let cursor = 0
  for (const match of matches) {
    const start = match.index
    const matchedText = match[0] ?? ''
    if (start === undefined || !matchedText) continue
    if (start > cursor) parts.push(`<pre>${escapeHtml(section.slice(cursor, start))}</pre>`)
    const path = match[1] ?? 'Unknown path'
    const content = match[2] ?? ''
    const contribution = contributions.find((item) => item.kind === 'instruction-file' && item.source === path)
    const metrics = contributionMetrics(analysis, contribution ? [contribution] : [], contribution?.tokens ?? null)
    parts.push(
      `<details class="source-row"><summary>Instruction file: ${escapeHtml(path)} · ${tokenLabel(contribution?.tokens)}</summary><pre>${escapeHtml(content)}</pre>${renderCostDetails('Instruction file details', path, contribution?.id ?? path, metrics)}</details>`,
    )
    cursor = start + matchedText.length
  }
  if (cursor < section.length) parts.push(`<pre>${escapeHtml(section.slice(cursor))}</pre>`)
  return parts.join('')
}

function renderToolPromptSources(
  section: string,
  analysis: SessionAnalysis,
  contributions: readonly Contribution[],
): string {
  const toolNames = [
    ...new Set(
      contributions
        .filter((item) => item.kind === 'tool-prompt')
        .map((item) => item.toolName)
        .filter((name): name is string => name !== undefined),
    ),
  ].sort((left, right) => right.length - left.length)
  const lines = section.match(/[^\n]*\n|[^\n]+$/g) ?? []
  if (lines.length === 0) return '<p class="muted">No tool prompt text is saved.</p>'

  return lines
    .map((line, index) => {
      const content = line.endsWith('\n') ? line.slice(0, -1) : line
      const toolName = toolNames.find((name) => content.startsWith(`- ${name}:`))
      const contribution = toolName
        ? contributions.find((item) => item.kind === 'tool-prompt' && item.toolName === toolName)
        : contributions.find((item) => item.id === `prompt-section:tools:${index}`)
      const source = toolName ? `${toolName} prompt snippet` : 'Shared or unattributed tool prompt text'
      const identifier = contribution?.id ?? `prompt-section:tools:${index}`
      const metrics = contributionMetrics(analysis, contribution ? [contribution] : [], contribution?.tokens ?? null)
      return `<details class="source-row"><summary>${escapeHtml(source)} · ${tokenLabel(contribution?.tokens)} in selected context</summary><pre>${escapeHtml(line)}</pre>${renderCostDetails('Tool prompt details', source, identifier, metrics)}</details>`
    })
    .join('')
}

function renderPromptSection(
  sectionName: string,
  text: string,
  analysis: SessionAnalysis,
  contributions: readonly Contribution[],
): string {
  const matching = getSectionContributions(sectionName, text, contributions)
  const cost = sumTokens(matching)
  const label = sectionLabel(sectionName)
  const content =
    sectionName === 'project_context'
      ? renderInstructionFiles(text, analysis, matching)
      : sectionName === 'tools'
        ? renderToolPromptSources(text, analysis, matching)
        : `<pre>${escapeHtml(text)}</pre>`
  const metrics = contributionMetrics(analysis, matching, cost)

  const identifier = matching.map((item) => item.id).join(', ') || sectionName
  return `<details class="source-row"><summary>${escapeHtml(label)} · ${tokenLabel(cost)} in selected context</summary>${content}${renderCostDetails('Prompt section details', label, identifier, metrics)}</details>`
}

function renderToolDefinition(
  tool: { name: string; description?: unknown; parameters?: unknown },
  analysis: SessionAnalysis,
  contributions: readonly Contribution[],
): string {
  const contribution = contributions.find((item) => item.kind === 'tool-definition' && item.toolName === tool.name)
  const loadoutTokens = contribution?.tokens ?? null
  const metrics = contributionMetrics(analysis, contribution ? [contribution] : [], loadoutTokens)
  const schema = tool.parameters === undefined ? 'Unavailable' : jsonText(tool.parameters)
  const description = stringValue(tool.description, 'No description saved.')

  return `<details class="source-row tool-definition"><summary>Tool definition: ${escapeHtml(tool.name)} · ${tokenLabel(loadoutTokens)} in selected context</summary><p>${escapeHtml(description)}</p><pre>${escapeHtml(schema)}</pre>${renderCostDetails('Tool definition details', tool.name, contribution?.id ?? tool.name, metrics)}</details>`
}

function renderSystemSnapshot(
  message: MessageView | undefined,
  analysis: SessionAnalysis,
  contributions: readonly Contribution[],
  includeToolDefinitions = true,
): string {
  if (!message) return '<p class="status-note">No saved system snapshot is available.</p>'
  const rows: string[] = []
  const hasContent =
    typeof message.content === 'string'
      ? message.content.length > 0
      : Array.isArray(message.content) && message.content.length > 0
  const contentContributions = contributions.filter((item) => item.kind === 'system-content')
  if (hasContent) {
    const cost = sumTokens(contentContributions)
    const metrics = contributionMetrics(analysis, contentContributions, cost)
    rows.push(
      `<details class="source-row"><summary>System prompt content · ${tokenLabel(cost)} in selected context</summary>${renderPromptContent(message.content)}${renderCostDetails('System prompt details', 'System prompt content', contentContributions.map((item) => item.id).join(', '), metrics)}</details>`,
    )
  }
  for (const [sectionName, value] of Object.entries(message.sections ?? {})) {
    if (value === null) continue
    rows.push(renderPromptSection(sectionName, value, analysis, contributions))
  }
  if (includeToolDefinitions) {
    for (const tool of message.toolsAdded ?? []) {
      rows.push(renderToolDefinition(tool, analysis, contributions))
    }
  }
  const formatting = contributions.find((item) => item.id === 'tool-definition-formatting')
  if (formatting) {
    rows.push(
      `<p class="subtle">Shared tool declaration formatting: ${tokenLabel(formatting.tokens)} in selected context.</p>`,
    )
  }
  if (rows.length === 0) rows.push('<p class="muted">The saved system snapshot is empty.</p>')
  return `<div class="loadout">${rows.join('')}</div>`
}

function renderToolDefinitionDetails(
  name: string,
  label: string,
  description: unknown,
  parameters: unknown,
  estimatedTokens: number,
  scopeLabel: string,
): string {
  const schema = parameters === undefined ? 'Unavailable' : jsonText(parameters)
  return `<details class="tool-definition-details"><summary>${escapeHtml(label)}: ${escapeHtml(name)} · ${tokenLabel(estimatedTokens)} estimated ${escapeHtml(scopeLabel)}</summary><div class="tool-definition-content"><p><strong>Description</strong></p><p>${escapeHtml(stringValue(description, 'No description saved.'))}</p><p><strong>Schema</strong></p><pre>${escapeHtml(schema)}</pre></div></details>`
}

function renderToolContextDetails(analysis: SessionAnalysis, toolName: string): string {
  const context = analysis.requests.at(-1)
  const message = context?.loadoutMessage ?? analysis.baseline.systemMessage
  const contributions = context?.contributions ?? analysis.baseline.contributions
  const definition = message?.toolsAdded?.find((item) => item.name === toolName)
  const definitionTokens = sumTokens(
    contributions.filter((item) => item.kind === 'tool-definition' && item.toolName === toolName),
  )
  const definitionContent = definition
    ? renderToolDefinitionDetails(
        toolName,
        'Definition',
        definition.description,
        definition.parameters,
        definitionTokens,
        'in selected context',
      )
    : '<p class="muted">No saved tool description or schema is available.</p>'
  const sections = message?.sections ?? {}
  const toolPromptLines =
    typeof sections.tools === 'string'
      ? sections.tools
          .split(/\r?\n/)
          .filter((line) => line.startsWith(`- ${toolName}:`))
          .join('\n')
      : ''
  const promptText = [sections[`metering:tool-prompt:${toolName}`], toolPromptLines]
    .filter((text): text is string => typeof text === 'string' && text.length > 0)
    .join('\n')
  const promptTokens = sumTokens(
    contributions.filter((item) => item.kind === 'tool-prompt' && item.toolName === toolName),
  )
  const promptContent = promptText
    ? `<details class="tool-prompt-source"><summary>Prompt guidance and examples · ${tokenLabel(promptTokens)} estimated in selected context</summary><pre>${escapeHtml(promptText)}</pre></details>`
    : '<p class="muted">No saved tool-specific prompt guidance or examples are available.</p>'

  return `<section class="tool-context-details"><h4>Current tool context</h4><p class="subtle">These sources appear in the selected endpoint context.</p>${definitionContent}${promptContent}</section>`
}

function renderImage(block: Record<string, unknown>): string {
  const mimeType = stringValue(block.mimeType).toLowerCase()
  const data = stringValue(block.data)
  if (!data || !/^image\/(png|jpeg|webp|gif|bmp)$/.test(mimeType) || !/^[a-z\d+/=\r\n]+$/i.test(data)) {
    return '<p class="muted">[Image content is not available for safe inline display]</p>'
  }
  const source = `data:${mimeType};base64,${data.replace(/\s/g, '')}`
  return `<img class="image-preview" alt="Conversation image" loading="lazy" src="${escapeHtml(source)}">`
}

function renderPromptContent(content: unknown): string {
  if (typeof content === 'string') return `<pre>${escapeHtml(content)}</pre>`
  const blocks = getContentBlocks(content)
  if (blocks.length === 0) return `<pre>${escapeHtml(jsonText(content))}</pre>`
  return blocks
    .map((block) => {
      if (block.type === 'text') return `<pre>${escapeHtml(stringValue(block.text))}</pre>`
      if (block.type === 'image') return renderImage(block)
      return `<p class="muted">[${escapeHtml(stringValue(block.type, 'Unknown'))} prompt block]</p>`
    })
    .join('')
}

function renderToolCallBlock(
  block: Record<string, unknown>,
  entryIndex: number,
  messageIndex: number,
  blockIndex: number,
  targets: ToolLinkTargets,
): string {
  const toolName = stringValue(block.name, 'Unknown tool')
  const toolCallId = stringValue(block.id, 'Unknown call ID')
  const argumentsText = jsonText(block.arguments)
  const callTarget = `call-${entryIndex}-${messageIndex}-${blockIndex}`
  const resultTarget = targets.results.get(toolCallId)
  const toolTarget = targets.tools.get(toolName)
  const toolLink = toolTarget ? `<a href="#${escapeHtml(toolTarget)}">View tool details</a>` : ''
  const resultLink = resultTarget
    ? `<a href="#${escapeHtml(resultTarget)}">View tool result</a>`
    : '<span class="muted">No saved result</span>'

  return `<section class="tool-message" id="${callTarget}"><div class="tool-heading"><strong>${escapeHtml(toolName)} call</strong></div><p>Call ID: <code>${escapeHtml(toolCallId)}</code></p><div class="tool-links">${toolLink}${resultLink}</div><pre class="tool-arguments">Arguments\n${escapeHtml(argumentsText)}</pre></section>`
}

function renderToolResultMessage(
  message: MessageView,
  entryIndex: number,
  messageIndex: number,
  targets: ToolLinkTargets,
): string {
  const toolCallId = stringValue(message.toolCallId, 'Unknown call ID')
  const toolName = stringValue(message.toolName, 'Unknown tool')
  const callTarget = targets.calls.get(toolCallId)
  const callLink = callTarget
    ? `<a href="#${escapeHtml(callTarget)}">View tool call</a>`
    : '<span class="muted">No saved call</span>'
  const error = message.isError ? ' error' : ''
  const state = message.isError ? 'Error result' : 'Tool result'

  return `<section class="tool-message${error}" id="result-${entryIndex}-${messageIndex}"><div class="tool-heading"><strong>${escapeHtml(toolName)} · ${state}</strong></div><p>Call ID: <code>${escapeHtml(toolCallId)}</code></p><div class="tool-links">${callLink}</div>${renderMessageContent(message.content, entryIndex, messageIndex, targets)}</section>`
}

function renderMessageContent(
  content: unknown,
  entryIndex: number,
  messageIndex: number,
  targets: ToolLinkTargets,
): string {
  if (typeof content === 'string') return `<div class="message-text">${escapeHtml(content)}</div>`
  const blocks = getContentBlocks(content)
  if (blocks.length === 0)
    return content === undefined ? '' : `<pre class="message-text">${escapeHtml(jsonText(content))}</pre>`

  return blocks
    .map((block, blockIndex) => {
      if (block.type === 'text') return `<div class="message-text">${escapeHtml(stringValue(block.text))}</div>`
      if (block.type === 'thinking')
        return `<details class="message-detail"><summary>Thinking</summary><pre>${escapeHtml(stringValue(block.thinking))}</pre></details>`
      if (block.type === 'toolCall') return renderToolCallBlock(block, entryIndex, messageIndex, blockIndex, targets)
      if (block.type === 'image') return renderImage(block)
      return `<p class="muted">[${escapeHtml(stringValue(block.type, 'Unknown'))} content block]</p>`
    })
    .join('')
}

function renderMessage(
  visible: VisibleEntryMessage,
  entryIndex: number,
  messageIndex: number,
  targets: ToolLinkTargets,
): string {
  const message = visible.message
  if (message.role === 'system')
    return '<div class="message"><div class="message-role">System snapshot</div><p class="muted">System content appears in the current system snapshot.</p></div>'
  if (message.role === 'toolResult')
    return `<div class="message"><div class="message-role">Tool result</div>${renderToolResultMessage(message, entryIndex, messageIndex, targets)}</div>`
  if (message.role === 'bashExecution') {
    return `<div class="message"><div class="message-role">Bash execution</div><p><strong>Command</strong></p><pre>${escapeHtml(stringValue(message.command))}</pre><p><strong>Output</strong></p><pre>${escapeHtml(stringValue(message.output))}</pre></div>`
  }
  if (message.role === 'branchSummary' || message.role === 'compactionSummary') {
    const role = message.role === 'compactionSummary' ? 'Compaction summary' : 'Branch summary'
    return `<div class="message"><div class="message-role">${role}</div><div class="message-text">${escapeHtml(stringValue(message.summary))}</div></div>`
  }
  const role =
    message.role === 'custom' ? `Extension message · ${stringValue(message.customType, 'custom')}` : message.role
  return `<div class="message"><div class="message-role">${escapeHtml(role)}</div>${renderMessageContent(message.content, entryIndex, messageIndex, targets)}${message.role === 'custom' ? `<p class="subtle">Saved customType: ${escapeHtml(stringValue(message.customType, 'unknown'))}</p>` : ''}</div>`
}

function renderEntryDetails(entry: EntryStatistics): string {
  const source = entry.customType ?? entry.role ?? entry.entryType
  const contextLabel = entry.latestRequestIncluded ? 'Included' : 'Not included'
  return `<details class="detail-popover"><summary>Entry estimates</summary><div class="popover"><dl><dt>Source</dt><dd>${escapeHtml(source)}</dd><dt>Entry ID</dt><dd>${escapeHtml(entry.entryId)}</dd><dt>Timestamp</dt><dd>${escapeHtml(entry.timestamp)}</dd><dt>Projected message estimate</dt><dd>${tokenLabel(entry.messageAdditionTokens)}</dd><dt>Selected-context inclusion</dt><dd>${contextLabel}</dd></dl></div></details>`
}

function contextStatusLabel(status: EntryStatistics['contextStatus']): string {
  return status === 'current' ? 'Current context' : 'Not in selected context'
}

function renderEntry(
  entry: EntryStatistics,
  entryIndex: number,
  analysis: SessionAnalysis,
  targets: ToolLinkTargets,
  contextTokensByEntry: ReadonlyMap<string, number>,
  nestedResults: readonly { entry: EntryStatistics; entryIndex: number }[] = [],
): string {
  const messages = getVisibleEntryMessages(entry)
  const toolResult = messages.find((visible) => visible.message.role === 'toolResult')?.message
  const role = entry.customType
    ? `Extension · ${entry.customType}`
    : entry.role === 'toolResult'
      ? `Tool result · ${stringValue(toolResult?.toolName) || 'tool'}`
      : (entry.role ?? entry.entryType)
  const previewText =
    messages
      .map(({ message }) => {
        if (typeof message.content === 'string') return message.content
        if (typeof message.summary === 'string') return message.summary
        if (typeof message.command === 'string') return message.command
        const text = getContentBlocks(message.content)
          .map((block) =>
            block.type === 'text'
              ? stringValue(block.text)
              : block.type === 'toolCall'
                ? `Call ${stringValue(block.name) || 'tool'}`
                : block.type === 'image'
                  ? 'Image'
                  : '',
          )
          .filter(Boolean)
          .join(' ')
        if (text) return text
        if (message.role === 'toolResult') return `Result from ${stringValue(message.toolName) || 'tool'}`
        return ''
      })
      .find((text) => text.trim().length > 0) ?? role
  const preview = escapeHtml(previewText.replace(/\s+/g, ' ').trim())
  const selectedContext = analysis.requests.at(-1)
  const contextTokens = contextTokensByEntry.get(entry.entryId) ?? 0
  const hasContextContribution = contextTokensByEntry.has(entry.entryId)
  const includedInContext = entry.latestRequestIncluded
  const contextFootprint = selectedContext?.footprintTokens
  const share =
    hasContextContribution && contextFootprint !== null && contextFootprint !== undefined && contextFootprint > 0
      ? formatPercent((contextTokens / contextFootprint) * 100)
      : 'Unavailable'
  const displayedTokens = hasContextContribution ? contextTokens : entry.messageAdditionTokens
  const tokenScope = hasContextContribution ? 'selected-context contribution' : 'projected message estimate'
  const statusClass = entry.contextStatus === 'current' ? 'badge-current' : ''
  const body = messages
    .map((visible, messageIndex) => renderMessage(visible, entryIndex, messageIndex, targets))
    .join('')
  const emptyBody =
    body ||
    `<p class="muted">${escapeHtml(entry.customType ? `Extension message: ${entry.customType}` : entry.entryType)}</p>`
  const nestedResultsHtml = nestedResults.length
    ? `<ol class="nested-entry-list" aria-label="Tool results">${nestedResults
        .map(({ entry: resultEntry, entryIndex: resultIndex }) =>
          renderEntry(resultEntry, resultIndex, analysis, targets, contextTokensByEntry),
        )
        .join('')}</ol>`
    : ''
  const contextContribution = hasContextContribution ? tokenLabel(contextTokens) : 'Unavailable'
  const contextShare = includedInContext ? formatPercent(entry.exposureShare) : 'Not in selected context'

  return `<li class="entry-node"><details class="entry" id="entry-${entryIndex}"><summary class="entry-summary"><span class="disclosure-glyph" aria-hidden="true">›</span><span class="entry-main"><span class="entry-role">${escapeHtml(role)}</span><span class="entry-preview">${preview}</span></span><time class="entry-timestamp" datetime="${escapeHtml(entry.timestamp)}">${escapeHtml(entry.timestamp)}</time><span class="entry-token-count"><strong>${tokenLabel(displayedTokens)}</strong><small>${tokenScope}</small></span><span class="entry-share">${escapeHtml(share)}<small>${hasContextContribution ? 'of selected context' : ''}</small></span><span class="badge ${statusClass}">${contextStatusLabel(entry.contextStatus)}</span></summary><div class="entry-expanded"><div class="entry-header"><h3 class="entry-title">${escapeHtml(role)} · ${escapeHtml(entry.entryId)}</h3><div class="badges"><span class="badge ${statusClass}">${contextStatusLabel(entry.contextStatus)}</span><span class="badge">${includedInContext ? 'In selected context' : 'Not in selected context'}</span></div></div><div class="entry-meta"><span>${escapeHtml(entry.timestamp)}</span>${entry.customType ? `<span>customType: ${escapeHtml(entry.customType)}</span>` : ''}</div><div class="entry-metrics"><span>Selected-context contribution: ${contextContribution}</span><span>Projected message estimate: ${tokenLabel(entry.messageAdditionTokens)}</span><span>Selected-context share: ${contextShare}</span></div>${renderEntryDetails(entry)}${emptyBody}</div></details>${nestedResultsHtml}</li>`
}

function renderConversationTab(
  analysis: SessionAnalysis,
  contextWindowTokens?: number,
  runtimeContextUsage?: ContextUsage,
): string {
  const targets = createToolLinkTargets(analysis)
  const context = analysis.requests.at(-1)
  const contextTokensByEntry = new Map<string, number>()
  for (const contribution of context?.contributions ?? []) {
    if (!contribution.entryId) continue
    const tokens = contextTokensByEntry.get(contribution.entryId) ?? 0
    contextTokensByEntry.set(contribution.entryId, tokens + contribution.tokens)
  }

  const callEntryIndexes = new Map<string, number>()
  const resultEntryIndexesByCallId = new Map<string, number[]>()
  for (const [entryIndex, entry] of analysis.entries.entries()) {
    for (const { message } of getVisibleEntryMessages(entry)) {
      if (message.role === 'assistant') {
        for (const block of getContentBlocks(message.content)) {
          if (block.type === 'toolCall' && typeof block.id === 'string') callEntryIndexes.set(block.id, entryIndex)
        }
      }
      if (message.role === 'toolResult' && typeof message.toolCallId === 'string') {
        const results = resultEntryIndexesByCallId.get(message.toolCallId) ?? []
        results.push(entryIndex)
        resultEntryIndexesByCallId.set(message.toolCallId, results)
      }
    }
  }

  const resultParents = new Map<number, Set<number>>()
  for (const [toolCallId, callEntryIndex] of callEntryIndexes) {
    for (const resultEntryIndex of resultEntryIndexesByCallId.get(toolCallId) ?? []) {
      if (resultEntryIndex <= callEntryIndex) continue
      const parents = resultParents.get(resultEntryIndex) ?? new Set<number>()
      parents.add(callEntryIndex)
      resultParents.set(resultEntryIndex, parents)
    }
  }

  const nestedResultsByEntryIndex = new Map<number, number[]>()
  const nestedResultIndexes = new Set<number>()
  for (const [resultEntryIndex, parentIndexes] of resultParents) {
    if (parentIndexes.size !== 1) continue
    const [parentIndex] = parentIndexes
    if (parentIndex === undefined) continue
    const results = nestedResultsByEntryIndex.get(parentIndex) ?? []
    results.push(resultEntryIndex)
    nestedResultsByEntryIndex.set(parentIndex, results)
    nestedResultIndexes.add(resultEntryIndex)
  }

  const timeline: string[] = []
  for (const [entryIndex, entry] of analysis.entries.entries()) {
    if (nestedResultIndexes.has(entryIndex)) continue
    const nestedResults = (nestedResultsByEntryIndex.get(entryIndex) ?? [])
      .sort((left, right) => left - right)
      .flatMap((nestedIndex) => {
        const nestedEntry = analysis.entries[nestedIndex]
        return nestedEntry ? [{ entry: nestedEntry, entryIndex: nestedIndex }] : []
      })
    timeline.push(renderEntry(entry, entryIndex, analysis, targets, contextTokensByEntry, nestedResults))
  }

  const conversation = timeline.length
    ? `<ol class="timeline">${timeline.join('')}</ol>`
    : '<p class="status-note">No projected conversation messages are available for this endpoint.</p>'

  return `<section id="conversation-panel" class="page" role="tabpanel" aria-labelledby="conversation-tab" tabindex="0"><h2>Selected endpoint context</h2>${renderLatestRequestComposition(analysis, contextWindowTokens, runtimeContextUsage)}<h2>Projected messages</h2><p class="subtle">Rows show only model-ready messages in the selected endpoint projection. Context edits are applied. Entries omitted from the projection are not shown. Tool results appear under their call.</p>${conversation}</section>`
}

function renderMetricCard(label: string, value: string, note: string): string {
  return `<div class="metric-card"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(value)}</div><p class="metric-note">${escapeHtml(note)}</p></div>`
}

function renderLatestRequestComposition(
  analysis: SessionAnalysis,
  contextWindowTokens?: number,
  runtimeContextUsage?: ContextUsage,
): string {
  const request = analysis.requests.at(-1)
  if (!request) return '<p class="status-note">No selected endpoint context is available for this session.</p>'

  const tokensByGroup = new Map<keyof SessionAnalysis['sourceGroups'], number>()
  for (const group of sourceGroupDescriptions) tokensByGroup.set(group.key, 0)
  for (const contribution of request.contributions) {
    const tokens = tokensByGroup.get(contribution.group) ?? 0
    tokensByGroup.set(contribution.group, tokens + contribution.tokens)
  }

  const groupTotal = sourceGroupDescriptions.reduce((sum, group) => sum + (tokensByGroup.get(group.key) ?? 0), 0)
  const totalTokens = request.footprintTokens ?? groupTotal
  if (totalTokens <= 0) return '<p class="status-note">No token estimates are available for the selected context.</p>'

  const runtimeContextWindow =
    runtimeContextUsage && Number.isFinite(runtimeContextUsage.contextWindow) && runtimeContextUsage.contextWindow > 0
      ? runtimeContextUsage.contextWindow
      : undefined
  const validContextWindow =
    runtimeContextWindow ??
    (contextWindowTokens !== undefined && Number.isFinite(contextWindowTokens) && contextWindowTokens > 0
      ? contextWindowTokens
      : undefined)
  const contextWindowPercent =
    validContextWindow !== undefined && request.footprintTokens !== null && Number.isFinite(request.footprintTokens)
      ? (request.footprintTokens / validContextWindow) * 100
      : undefined
  const piContextPercent =
    runtimeContextWindow !== undefined &&
    runtimeContextUsage?.percent !== null &&
    runtimeContextUsage?.percent !== undefined &&
    Number.isFinite(runtimeContextUsage.percent)
      ? runtimeContextUsage.percent
      : undefined
  const contextPercent = piContextPercent ?? contextWindowPercent
  const contextPercentLabel = piContextPercent === undefined ? 'Context window estimate' : 'Pi context estimate'
  const piContextTokensLabel =
    piContextPercent !== undefined && runtimeContextUsage && runtimeContextUsage.tokens !== null
      ? ` · ${formatTokens(runtimeContextUsage.tokens)} tokens`
      : ''
  const runtimeUnavailableNote =
    runtimeContextUsage !== undefined && piContextPercent === undefined
      ? '<p class="subtle">Pi context estimate is unavailable for this session.</p>'
      : ''
  const reconstructionNote =
    piContextPercent === undefined
      ? '<p class="subtle">Source shares use the selected-context estimate.</p>'
      : contextWindowPercent === undefined
        ? '<p class="subtle">The selected-context estimate is unavailable. Source shares use known contributions.</p>'
        : `<p class="subtle">Selected-context estimate: ${tokenLabel(request.footprintTokens)} · ${formatPercent(contextWindowPercent)} of ${formatTokens(validContextWindow ?? 0)} tokens. Source shares use this estimate.</p>`
  const contextWarnings = [
    piContextPercent !== undefined && piContextPercent > 100
      ? '<p class="status-note">Pi context estimate exceeds the model context window.</p>'
      : '',
    contextWindowPercent !== undefined && contextWindowPercent > 100
      ? '<p class="status-note">The selected-context estimate exceeds the model context window.</p>'
      : '',
  ].join('')
  const windowUsage =
    validContextWindow === undefined
      ? '<p class="subtle">Context window size is unavailable for this model.</p>'
      : contextPercent === undefined
        ? '<p class="subtle">Context window percentage is unavailable because no trusted token count is available.</p>'
        : `<div class="context-window-summary"><div class="window-heading"><span class="column-label">${contextPercentLabel}</span><strong>${formatPercent(contextPercent)} of ${formatTokens(validContextWindow)} tokens${piContextTokensLabel}</strong></div><meter min="0" max="100" value="${Math.min(100, Math.max(0, contextPercent))}" style="width:100%" aria-label="${escapeHtml(contextPercentLabel)}">${formatPercent(contextPercent)}</meter>${runtimeUnavailableNote}${reconstructionNote}${contextWarnings}</div>`

  const unattributedTokens = Math.max(0, totalTokens - groupTotal)
  tokensByGroup.set('unattributedContent', (tokensByGroup.get('unattributedContent') ?? 0) + unattributedTokens)

  const entries = sourceGroupDescriptions
    .map((group) => {
      const tokens = tokensByGroup.get(group.key) ?? 0
      return { ...group, tokens, share: (tokens / totalTokens) * 100 }
    })
    .filter((group) => group.tokens > 0)
  const segments = entries
    .map(
      (group) =>
        `<span class="request-composition-segment" style="width:${group.share}%;background:${group.color}" title="${escapeHtml(group.label)}: ${tokenLabel(group.tokens)} · ${formatPercent(group.share)}"></span>`,
    )
    .join('')
  const legend = entries
    .map(
      (group) =>
        `<li><span class="legend-name"><span class="swatch" style="background:${group.color}"></span>${escapeHtml(group.label)}</span><span class="legend-value">${tokenLabel(group.tokens)} · ${formatPercent(group.share)}</span></li>`,
    )
    .join('')
  const ariaLabel = entries
    .map((group) => `${group.label}: ${tokenLabel(group.tokens)}, ${formatPercent(group.share)}`)
    .join('; ')
  const totalLabel =
    request.footprintTokens === null ? `${tokenLabel(totalTokens)} known tokens` : tokenLabel(request.footprintTokens)
  const scopeLabel =
    request.footprintTokens === null ? 'Known selected-context breakdown' : 'Selected context breakdown'
  const status =
    request.footprintTokens === null
      ? '<p class="subtle">The full selected-context estimate is unavailable. Shares use known contributions.</p>'
      : '<p class="subtle">Shares use the selected endpoint projection, including its assistant response when present.</p>'

  return `<section class="request-composition" aria-labelledby="request-composition-title"><div class="request-composition-heading"><div><h3 id="request-composition-title">${scopeLabel}</h3>${status}</div><strong>${totalLabel}</strong></div>${windowUsage}<div class="request-composition-bar" role="img" aria-label="${escapeHtml(ariaLabel)}">${segments}</div><ul class="chart-legend request-composition-legend">${legend}</ul></section>`
}

function renderOverview(analysis: SessionAnalysis): string {
  const contextEstimate =
    analysis.requestExposure.tokens === null
      ? `${formatTokens(analysis.requestExposure.knownTokens)} known tokens · incomplete`
      : tokenLabel(analysis.requestExposure.tokens)
  return `<div class="metrics-grid">${renderMetricCard('Current system-snapshot estimate', tokenLabel(analysis.baseline.tokens), analysis.baseline.available ? analysis.baseline.source : 'Snapshot unavailable')}${renderMetricCard('Selected-context estimate', contextEstimate, 'Projected system and conversation content counted once')}${renderMetricCard('Projected conversation estimate', tokenLabel(analysis.oneTimeMessageAdditionsTokens), 'Selected-context messages counted once')}</div>`
}

function renderProviderUsage(analysis: SessionAnalysis): string {
  const context = analysis.requests.at(-1)
  const usage = context?.providerUsage
  if (!usage) return '<p class="status-note">The endpoint response has no provider-reported Usage.</p>'
  return `<div class="table-wrap"><table class="provider-table"><thead><tr><th>Endpoint response</th><th>Model</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>Total</th></tr></thead><tbody><tr><td>${escapeHtml(context.responseEntryId)}</td><td>${escapeHtml(context.model ?? 'Unknown model')}</td><td class="number">${formatTokens(usage.input)} input tokens</td><td class="number">${formatTokens(usage.output)} output tokens</td><td class="number">${formatTokens(usage.cacheRead)} cache-read tokens</td><td class="number">${formatTokens(usage.cacheWrite)} cache-write tokens</td><td class="number">${formatTokens(usage.totalTokens)} total tokens</td></tr></tbody></table></div>`
}

function renderDonut(analysis: SessionAnalysis): string {
  const values = sourceGroupDescriptions.map((group) => {
    const tokens = analysis.sourceGroups[group.key]
    return { ...group, tokens: Number.isFinite(tokens) ? Math.max(0, tokens) : 0 }
  })
  const total = values.reduce((sum, group) => sum + group.tokens, 0)
  const circumference = 2 * Math.PI * 58
  let offset = 0
  const segments = values
    .map((group) => {
      const length = total > 0 ? (circumference * group.tokens) / total : 0
      const segment =
        group.tokens > 0
          ? `<circle cx="80" cy="80" r="58" fill="none" stroke="${group.color}" stroke-width="22" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 80 80)"/>`
          : ''
      offset += length
      return segment
    })
    .join('')
  const legend = values
    .map((group) => {
      const share = total > 0 ? (group.tokens / total) * 100 : 0
      return `<li><span class="legend-label"><span class="swatch" style="background:${group.color}"></span>${escapeHtml(group.label)}</span><span class="legend-value">${tokenLabel(group.tokens)} · ${formatPercent(share)}</span></li>`
    })
    .join('')
  const note = analysis.requestExposure.complete
    ? 'Each projected message is counted once in the selected context.'
    : 'The chart shows known selected-context contributions. The full estimate is incomplete.'

  return `<div class="chart-layout"><svg class="donut" viewBox="0 0 160 160" role="img" aria-labelledby="exposure-chart-title exposure-chart-description"><title id="exposure-chart-title">Estimated selected-context tokens by source group</title><desc id="exposure-chart-description">${escapeHtml(note)}</desc><circle cx="80" cy="80" r="58" fill="none" stroke="#354552" stroke-width="22"/>${segments}<text x="80" y="76" text-anchor="middle" fill="#e8eef3" font-size="15">${escapeHtml(formatTokens(total))}</text><text x="80" y="96" text-anchor="middle" fill="#a6b3bf" font-size="10">${analysis.requestExposure.complete ? 'estimated tokens' : 'known tokens'}</text></svg><div><p class="subtle">${escapeHtml(note)}</p><ul class="chart-legend">${legend}</ul></div></div>`
}

function largestValue<T>(items: readonly T[], getValue: (item: T) => number): number {
  return items.reduce((largest, item) => Math.max(largest, getValue(item)), 0)
}

function largestClass(value: number, largest: number): string {
  return largest > 0 && value === largest ? 'largest' : ''
}

function renderToolTable(analysis: SessionAnalysis, targets: ToolLinkTargets): string {
  const sharedExposure = `<p class="subtle">Shared or unattributed tool context: ${tokenLabel(analysis.sharedToolContextExposureTokens)} estimated in the selected context. This amount is separate from per-tool totals.</p>`
  const incompleteExposure = analysis.requestExposure.complete
    ? ''
    : '<p class="status-note">The selected-context estimate may be incomplete because the system snapshot is unavailable.</p>'
  if (analysis.tools.length === 0)
    return `<p class="status-note">No tool definitions or tool interactions appear in the selected context.</p>${sharedExposure}${incompleteExposure}`

  const systemSnapshotCosts = analysis.tools.map((tool) => {
    const contributions = analysis.baseline.contributions.filter((item) => item.toolName === tool.name)
    const definitions = contributions.filter((item) => item.kind === 'tool-definition')
    const prompts = contributions.filter((item) => item.kind === 'tool-prompt')
    return {
      tool,
      definitionTokens: sumTokens(definitions),
      promptTokens: sumTokens(prompts),
      totalTokens: sumTokens([...definitions, ...prompts]),
      hasDefinition: definitions.length > 0,
      hasPrompt: prompts.length > 0,
      hasSnapshotCost: definitions.length > 0 || prompts.length > 0,
    }
  })
  const maxSnapshotCost = largestValue(systemSnapshotCosts, (item) => item.totalTokens)
  const maxArguments = largestValue(analysis.tools, (tool) => tool.argumentTokens)
  const maxResults = largestValue(analysis.tools, (tool) => tool.totalResultTokens)
  const exposureNote =
    analysis.requests.length === 0
      ? '<p class="subtle">No model-ready conversation entries are available. The system-snapshot estimate covers tool definitions and prompt guidance. It is not included in the invocation total.</p>'
      : '<p class="subtle">The invocation total adds each listed call and result once. It excludes tool definitions and prompt guidance. Expanded details show their estimated contribution to the selected context.</p>'
  const rows = systemSnapshotCosts
    .map(({ tool, definitionTokens, promptTokens, totalTokens, hasDefinition, hasPrompt, hasSnapshotCost }, index) => {
      const toolCalls = analysis.toolInvocations.filter(
        (invocation) => invocation.toolName === tool.name && invocation.callEntryId,
      )
      const successfulCalls = toolCalls.filter((invocation) => invocation.isError === false).length
      const failedCalls = toolCalls.filter((invocation) => invocation.isError === true).length
      const noResultCalls = toolCalls.filter((invocation) => invocation.isError === null).length
      const snapshotDefinition = !analysis.baseline.available
        ? 'Unavailable'
        : hasDefinition
          ? tokenLabel(definitionTokens)
          : 'Not in current system snapshot'
      const snapshotPrompt = !analysis.baseline.available
        ? 'Unavailable'
        : hasPrompt
          ? tokenLabel(promptTokens)
          : 'Not in current system snapshot'
      const snapshotCost = !analysis.baseline.available
        ? 'Unavailable'
        : hasSnapshotCost
          ? tokenLabel(totalTokens)
          : 'Not in current system snapshot'
      return `<details class="tool-card" id="tool-card-${index}"><summary class="tool-card-summary"><span class="disclosure-glyph" aria-hidden="true">›</span><span class="tool-card-name">${escapeHtml(tool.name)}</span><span class="tool-card-static"><small>Baseline token spend (system snapshot)</small><strong class="${largestClass(totalTokens, maxSnapshotCost)}">${snapshotCost}</strong><small>Estimated invocation total from listed calls · ${tokenLabel(tool.oneTimeInteractionTokens)}</small></span><span class="tool-card-dynamic"><small>Invocation sizes, counted once</small><strong class="${largestClass(tool.argumentTokens, maxArguments)}">Arguments ${tokenLabel(tool.argumentTokens)}</strong><small class="${largestClass(tool.totalResultTokens, maxResults)}">Results ${tokenLabel(tool.totalResultTokens)}</small></span><span class="tool-card-outcomes"><small>${formatTokens(tool.callCount)} calls</small><strong>${formatTokens(successfulCalls)} success · ${formatTokens(failedCalls)} failed</strong><small>${formatTokens(noResultCalls)} with no result</small></span></summary><div class="tool-card-expanded">${renderToolContextDetails(analysis, tool.name)}<dl class="tool-total-metrics"><div><dt>Estimated invocation total from listed calls</dt><dd>${tokenLabel(tool.oneTimeInteractionTokens)}</dd></div><div><dt>Estimated current-context exposure</dt><dd>${tokenLabel(tool.estimatedContextExposureTokens)}</dd></div><div><dt>Estimated definition exposure in current context</dt><dd>${tokenLabel(tool.estimatedDefinitionExposureTokens)}</dd></div><div><dt>Estimated prompt guidance and examples in current context</dt><dd>${tokenLabel(tool.estimatedPromptExposureTokens)}</dd></div><div><dt>Estimated call-argument exposure</dt><dd>${tokenLabel(tool.estimatedArgumentExposureTokens)}</dd></div><div><dt>Estimated tool-result exposure</dt><dd>${tokenLabel(tool.estimatedResultExposureTokens)}</dd></div><div><dt>Current system-snapshot definition estimate</dt><dd>${snapshotDefinition}</dd></div><div><dt>Current system-snapshot prompt estimate</dt><dd>${snapshotPrompt}</dd></div><div><dt>Current system-snapshot tool estimate</dt><dd>${snapshotCost}</dd></div></dl><h4>Invocation timeline</h4>${renderToolInvocationTable(analysis, targets, tool.name)}</div></details>`
    })
    .join('')

  return `${exposureNote}<div class="tool-list">${rows}</div>${sharedExposure}${incompleteExposure}`
}

function renderPromptSectionTable(analysis: SessionAnalysis): string {
  if (analysis.promptSections.length === 0)
    return '<p class="status-note">No prompt sections or instruction files are available in the selected context.</p>'
  const currentSections = analysis.promptSections
    .map((section) => ({
      section,
      contributions: analysis.baseline.contributions.filter((item) => item.id === section.id),
      tokens: sumTokens(analysis.baseline.contributions.filter((item) => item.id === section.id)),
    }))
    .sort((left, right) => right.tokens - left.tokens || left.section.label.localeCompare(right.section.label))
  const maxCurrent = largestValue(currentSections, (item) => item.tokens)
  const currentFootprint = analysis.latestRequestFootprintTokens ?? 0
  const rows = currentSections
    .map(({ section, contributions, tokens }) => {
      const currentShare =
        section.latestRequestTokens > 0 && currentFootprint > 0
          ? (section.latestRequestTokens / currentFootprint) * 100
          : null
      const currentSnapshotTokens = !analysis.baseline.available
        ? 'Unavailable'
        : contributions.length > 0
          ? tokenLabel(tokens)
          : 'Not in current system snapshot'
      const currentClass = contributions.length > 0 ? largestClass(tokens, maxCurrent) : ''
      return `<tr><th scope="row">${escapeHtml(section.label)}${section.source ? `<span class="subtle"><br>${escapeHtml(section.source)}</span>` : ''}</th><td>${escapeHtml(section.kind)}</td><td class="number ${currentClass}">${currentSnapshotTokens}</td><td class="number">${tokenLabel(section.latestRequestTokens)}</td><td class="number">${formatPercent(currentShare)}</td></tr>`
    })
    .join('')
  return `<div class="table-wrap"><table><thead><tr><th>Prompt section or source</th><th>Type</th><th>Current system-snapshot tokens</th><th>Selected-context tokens</th><th>Selected-context share</th></tr></thead><tbody>${rows}</tbody></table></div>`
}

function renderWarnings(analysis: SessionAnalysis): string {
  if (analysis.warnings.length === 0) return ''
  return `<section><h2>Analysis limits</h2><ul>${analysis.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></section>`
}

function renderToolInvocationTable(analysis: SessionAnalysis, targets: ToolLinkTargets, toolName: string): string {
  const entriesById = new Map(analysis.entries.map((entry, index) => [entry.entryId, { entry, index }]))
  const invocations = analysis.toolInvocations.filter((invocation) => invocation.toolName === toolName)
  if (invocations.length === 0)
    return `<p class="status-note">${escapeHtml(toolName)} has no invocation in the selected context.</p>`

  const chronologicalInvocations = [...invocations].sort((left, right) => {
    const leftEntry = entriesById.get(left.callEntryId ?? '') ?? entriesById.get(left.resultEntryId ?? '')
    const rightEntry = entriesById.get(right.callEntryId ?? '') ?? entriesById.get(right.resultEntryId ?? '')
    return (leftEntry?.index ?? Number.MAX_SAFE_INTEGER) - (rightEntry?.index ?? Number.MAX_SAFE_INTEGER)
  })
  const rows = chronologicalInvocations
    .map((invocation) => {
      const callTarget = targets.calls.get(invocation.toolCallId)
      const resultTarget = targets.results.get(invocation.toolCallId)
      const callEntry = entriesById.get(invocation.callEntryId ?? '')?.entry
      const resultEntry = entriesById.get(invocation.resultEntryId ?? '')?.entry
      const timestamp = callEntry?.timestamp ?? resultEntry?.timestamp ?? 'Timestamp unavailable'
      const callBlock = callEntry?.effectiveMessages
        .filter((message) => message.role === 'assistant')
        .flatMap((message) => getContentBlocks(message.content))
        .find((block) => block.type === 'toolCall' && block.id === invocation.toolCallId)
      const resultMessage = resultEntry?.effectiveMessages.find(
        (message) => message.role === 'toolResult' && message.toolCallId === invocation.toolCallId,
      )
      const status = invocation.isError === null ? 'No result' : invocation.isError ? 'Failed' : 'Success'
      const statusClass =
        invocation.isError === null ? 'outcome-unknown' : invocation.isError ? 'outcome-failure' : 'outcome-success'
      const callLink = callTarget
        ? `<a href="#${escapeHtml(callTarget)}">Open call input</a>`
        : '<span class="muted">No saved call</span>'
      const resultLink = resultTarget
        ? `<a href="#${escapeHtml(resultTarget)}">Open tool result</a>`
        : '<span class="muted">No saved result</span>'
      const contextImpact = `<p class="subtle">Selected-context interaction estimate: ${tokenLabel(invocation.latestRequestTokens)}</p>`
      const argumentsContent = callBlock
        ? `<section class="invocation-content"><h5>Arguments</h5><pre>${escapeHtml(jsonText(callBlock.arguments))}</pre></section>`
        : '<p class="muted">No saved arguments are available.</p>'
      const resultContent = resultMessage
        ? `<section class="invocation-content"><h5>Result text</h5>${renderPromptContent(resultMessage.content)}</section>`
        : '<p class="muted">No saved result text is available.</p>'
      return `<li class="invocation-node"><details class="invocation-row"><summary class="invocation-summary"><span class="disclosure-glyph" aria-hidden="true">›</span><time>${escapeHtml(timestamp)}</time><span class="outcome ${statusClass}">${status}</span><span class="invocation-token-summary"><span>Call estimate</span> ${tokenLabel(invocation.argumentTokens)} <span>Result estimate</span> ${tokenLabel(invocation.resultTokens)}</span></summary><div class="invocation-expanded"><dl class="invocation-metrics"><div><dt>Call ID</dt><dd><code>${escapeHtml(invocation.toolCallId)}</code></dd></div><div><dt>Call text estimate</dt><dd>${tokenLabel(invocation.argumentTokens)}</dd></div><div><dt>Result text estimate</dt><dd>${tokenLabel(invocation.resultTokens)}</dd></div><div><dt>Outcome</dt><dd>${status}</dd></div></dl>${argumentsContent}${resultContent}${contextImpact}<div class="tool-invocation-links"><span>Selected-context content</span>${callLink}${resultLink}</div></div></details></li>`
    })
    .join('')

  return `<ol class="invocation-timeline" aria-label="${escapeHtml(toolName)} invocations in selected context">${rows}</ol>`
}

function renderStatisticsTab(analysis: SessionAnalysis): string {
  const targets = createToolLinkTargets(analysis)
  const context = analysis.requests.at(-1)
  const systemMessage = context?.loadoutMessage ?? analysis.baseline.systemMessage
  const loadoutContributions =
    context?.contributions.filter((contribution) => contribution.entryId === undefined) ??
    analysis.baseline.contributions
  return `<section id="statistics-panel" class="page" role="tabpanel" aria-labelledby="statistics-tab" tabindex="0" hidden><h2>Current context estimates</h2><p class="subtle">These estimates cover the selected endpoint projection. They exclude earlier, out-of-context branch history. Each projected message and tool interaction is counted once. The values are estimates, not provider billing or exact tokenizer counts.</p><div class="section-heading"><h3>Current system snapshot</h3><span class="subtle">Estimated tokens</span></div><p class="subtle">Expand a source to inspect the system prompt or tool guidance and examples in the selected context.</p>${renderSystemSnapshot(systemMessage, analysis, loadoutContributions, false)}<div class="section-heading"><h3>Tools in selected context</h3><span class="subtle">Current-context estimates</span></div>${renderToolTable(analysis, targets)}<details class="advanced-estimates"><summary>Source breakdown</summary><h2>Selected-context estimates</h2><p class="subtle">Token estimates use Pi's estimator and its character-based loadout method. Provider Usage is separate.</p>${renderOverview(analysis)}<h2>Estimated selected-context tokens by source group</h2>${renderDonut(analysis)}<div class="section-heading"><h2>Prompt sections and instruction files</h2><span class="subtle">Sorted by current system-snapshot cost</span></div>${renderPromptSectionTable(analysis)}<h2>Provider-reported usage for the endpoint response</h2><p class="subtle">These values come from the selected endpoint assistant response. They are not source-level estimates.</p>${renderProviderUsage(analysis)}${renderWarnings(analysis)}</details></section>`
}

function renderMetadata(analysis: SessionAnalysis): string {
  const model = [...analysis.requests].reverse().find((request) => request.model)?.model ?? 'Unknown'
  const leaf = analysis.selectedLeafId ?? 'No selected leaf'
  return `<dl class="metadata"><div><dt>Session ID</dt><dd>${escapeHtml(analysis.sessionId)}</dd></div><div><dt>Working directory</dt><dd>${escapeHtml(analysis.cwd || 'Unavailable')}</dd></div><div><dt>Selected leaf</dt><dd>${escapeHtml(leaf)}</dd></div><div><dt>Model</dt><dd>${escapeHtml(model)}</dd></div><div><dt>Analyzed at</dt><dd>${escapeHtml(analysis.analyzedAt)}</dd></div><div><dt>Token-estimate method</dt><dd>${escapeHtml(analysis.tokenEstimateMethod)}</dd></div></dl>`
}

function renderTabControls(): string {
  return '<nav class="tabs" role="tablist" aria-label="Report sections"><button class="tab" id="conversation-tab" type="button" role="tab" aria-selected="true" aria-controls="conversation-panel" tabindex="0">Conversation</button><button class="tab" id="statistics-tab" type="button" role="tab" aria-selected="false" aria-controls="statistics-panel" tabindex="-1">Tools</button></nav>'
}

function renderHeader(analysis: SessionAnalysis): string {
  return `<header><p class="eyebrow">Pi Inspect</p><h1>Context estimates</h1>${renderMetadata(analysis)}</header>`
}

function renderReportDocument(
  analysis: SessionAnalysis,
  contextWindowTokens?: number,
  runtimeContextUsage?: ContextUsage,
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Pi Inspect · ${escapeHtml(analysis.sessionId)}</title><style>${reportStyles}</style></head><body><a class="skip-link" href="#main-content">Skip to report content</a>${renderHeader(analysis)}${renderTabControls()}<main id="main-content" tabindex="-1">${renderConversationTab(analysis, contextWindowTokens, runtimeContextUsage)}${renderStatisticsTab(analysis)}</main><footer><p>Source breakdown values are estimates for the selected endpoint projection. The total is not provider billing or an exact tokenizer count.</p></footer><script>${reportScript}</script></body></html>`
}

/** Renders a self-contained HTML report and escapes all session and prompt text. */
function renderContextMeteringReport(
  analysis: SessionAnalysis,
  contextWindowTokens?: number,
  runtimeContextUsage?: ContextUsage,
): string {
  return renderReportDocument(analysis, contextWindowTokens, runtimeContextUsage)
}

export { renderContextMeteringReport }

type MeteringReportServer = {
  url: string
  close: () => Promise<void>
}

function openReportUrl(url: string, run: typeof execFile = execFile): Promise<void> {
  return new Promise((resolve, reject) => {
    run('open', [url], (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

function startMeteringReportServer(html: string): Promise<MeteringReportServer> {
  const path = `/${randomUUID()}`
  let host = ''
  const server = createServer((request, response) => {
    if (request.headers.host !== host || request.url !== path) {
      response.writeHead(404, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Not found')
      return
    }

    if (request.method !== 'GET') {
      response.writeHead(405, {
        Allow: 'GET',
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      })
      response.end('Method not allowed')
      return
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'none'; img-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Content-Type': 'text/html; charset=utf-8',
      Connection: 'close',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    })
    response.end(html)
  })

  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = (): void => {
      server.off('error', onError)
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('The report server did not receive a local TCP address.'))
        return
      }

      host = `127.0.0.1:${address.port}`
      let closePromise: Promise<void> | undefined
      const close = (): Promise<void> => {
        if (closePromise) return closePromise
        closePromise = new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error) rejectClose(error)
            else resolveClose()
          })
        })
        return closePromise
      }
      resolve({ url: `http://${host}${path}`, close })
    }

    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(0, '127.0.0.1')
  })
}

export { type MeteringReportServer, openReportUrl, startMeteringReportServer }
