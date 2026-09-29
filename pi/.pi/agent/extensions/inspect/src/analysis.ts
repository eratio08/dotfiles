import { getCurrentSystemMessage, getCurrentTools, type SystemMessage, type Usage } from '@earendil-works/pi-ai'
import {
  type BuildSystemPromptOptions,
  estimateTokens,
  type sessionEntryToContextMessages,
  type ToolInfo,
} from '@earendil-works/pi-coding-agent'
import type { ParsedSession } from './session.ts'

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
