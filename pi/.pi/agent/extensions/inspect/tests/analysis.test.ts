import assert from 'node:assert/strict'
import test from 'node:test'
import type { Usage } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import {
  analyzeSession,
  buildCurrentSystemMessage,
  parseSavedSession,
  renderContextMeteringReport,
  selectCurrentSession,
} from '../src/extension.ts'

function serializeSession(entries: readonly Record<string, unknown>[]): string {
  const header = {
    type: 'session',
    version: 3,
    id: 'analysis-session',
    timestamp: '2026-01-01T00:00:00.000Z',
    cwd: '/project',
  }

  return [header, ...entries].map((entry) => JSON.stringify(entry)).join('\n')
}

function usage(input: number): Usage {
  return {
    input,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + 1,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

test('should use a current configuration baseline given a session without a saved snapshot', () => {
  //given
  const manager = SessionManager.inMemory('/project')
  manager.appendMessage({ role: 'user', content: 'user', timestamp: 1 })
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'reply' }],
    api: 'test',
    provider: 'test-provider',
    model: 'test-model',
    usage: usage(99),
    stopReason: 'stop',
    timestamp: 2,
  })
  const session = selectCurrentSession(manager)
  const fallback = buildCurrentSystemMessage('abcd', { cwd: '/project' }, [], [])

  //when
  const analysis = analyzeSession(session, { fallbackSystemMessage: fallback })

  //then
  assert.equal(analysis.baseline.available, true)
  assert.equal(analysis.baseline.source, 'current-configuration')
  assert.equal(analysis.baseline.tokens, 1)
  assert.equal(analysis.requests[0]?.footprintTokens, 4)
})

test('should report an unavailable baseline given a saved session without a system snapshot', () => {
  //given
  const session = parseSavedSession(
    serializeSession([
      {
        type: 'message',
        id: '00000006',
        parentId: null,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'abcd', timestamp: 1 },
      },
      {
        type: 'message',
        id: '00000007',
        parentId: '00000006',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'reply' }],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(99),
          stopReason: 'stop',
          timestamp: 2,
        },
      },
    ]),
  )

  //when
  const analysis = analyzeSession(session)

  //then
  assert.equal(analysis.baseline.available, false)
  assert.equal(analysis.baseline.tokens, null)
  assert.equal(analysis.requests[0]?.footprintTokens, null)
  assert.equal(analysis.requestExposure.tokens, null)
  assert.equal(analysis.sourceGroups.otherConversation, 3)
})

test('should split identifiable current prompt sources given context files and tool snippets', () => {
  //given
  const file = '<project_instructions path="/project/AGENTS.md">\nrule\n</project_instructions>'
  const snippet = '- shell: run command'
  const prompt = `prompt\n${file}\n${snippet}`
  const options = {
    cwd: '/project',
    contextFiles: [{ path: '/project/AGENTS.md', content: 'rule' }],
    toolSnippets: { shell: 'run command' },
  }
  const tools = [
    { name: 'shell', description: 'run', parameters: { type: 'object' } },
    { name: 'inactive', description: 'unused', parameters: { type: 'object' } },
  ]

  //when
  const systemMessage = buildCurrentSystemMessage(prompt, options, ['shell'], tools)

  //then
  assert.equal(systemMessage.toolsAdded?.length, 1)
  assert.equal(systemMessage.toolsAdded?.[0]?.name, 'shell')
  assert.deepEqual(Object.values(systemMessage.sections ?? {}), [file, snippet, 'prompt\n\n'])
  assert.equal(systemMessage.content, '')
})

test('should use the latest system snapshot and tool configuration given two saved requests', () => {
  //given
  const shell = { name: 'shell', description: 'run shell', parameters: { type: 'object', required: ['command'] } }
  const grep = { name: 'grep', description: 'search files', parameters: { type: 'object', required: ['pattern'] } }
  const read = { name: 'read', description: 'read files', parameters: { type: 'object', required: ['path'] } }
  const session = parseSavedSession(
    serializeSession([
      {
        type: 'message',
        id: '00000041',
        parentId: null,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: {
          role: 'system',
          content: 'base',
          sections: {
            preamble: 'old',
            rules: 'shared rule',
            tools: '<tools>\n- shell: run shell\n- grep: search files\n</tools>',
          },
          toolsAdded: [shell, grep],
          timestamp: 1,
        },
      },
      {
        type: 'message',
        id: '00000042',
        parentId: '00000041',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'user', content: 'first', timestamp: 2 },
      },
      {
        type: 'message',
        id: '00000043',
        parentId: '00000042',
        timestamp: '2026-01-01T00:00:03.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'first reply' }],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(10),
          stopReason: 'stop',
          timestamp: 3,
        },
      },
      {
        type: 'message',
        id: '00000044',
        parentId: '00000043',
        timestamp: '2026-01-01T00:00:04.000Z',
        message: {
          role: 'system',
          content: 'base',
          sections: {
            preamble: 'new preamble',
            rules: 'new shared rule',
            tools: '<tools>\n- read: read files\n</tools>',
          },
          toolsAdded: [read],
          toolsRemoved: [{ name: 'shell' }, { name: 'grep' }],
          timestamp: 4,
        },
      },
      {
        type: 'message',
        id: '00000045',
        parentId: '00000044',
        timestamp: '2026-01-01T00:00:05.000Z',
        message: { role: 'user', content: 'second', timestamp: 5 },
      },
      {
        type: 'message',
        id: '00000046',
        parentId: '00000045',
        timestamp: '2026-01-01T00:00:06.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'second reply' }],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(20),
          stopReason: 'stop',
          timestamp: 6,
        },
      },
    ]),
  )

  //when
  const analysis = analyzeSession(session)

  //then
  assert.equal(analysis.requests.length, 1)
  assert.equal(analysis.requests[0]?.loadoutTokens, analysis.baseline.tokens)
  assert.deepEqual(
    analysis.tools.map((tool) => tool.name),
    ['read'],
  )
  assert.deepEqual(analysis.tools[0]?.parameterSchema, read.parameters)
  assert.equal(analysis.requests[0]?.inputEntryIds.includes('00000044'), true)
  assert.equal(
    analysis.entries.some((entry) => entry.entryId === '00000044'),
    false,
  )
  assert.ok(
    (analysis.promptSections.find((section) => section.id === 'prompt-section:preamble')?.latestRequestTokens ?? 0) > 0,
  )
  assert.equal(analysis.promptSections.find((section) => section.id === 'prompt-section:rules')?.kind, 'unattributed')
  assert.equal(
    Object.values(analysis.sourceGroups).reduce((sum, tokens) => sum + tokens, 0),
    analysis.requestExposure.tokens,
  )
})

test('should count the selected projection once given repeated context messages', () => {
  //given
  const session = parseSavedSession(
    serializeSession([
      {
        type: 'message',
        id: '00000001',
        parentId: null,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'system', content: 'abcd', timestamp: 1 },
      },
      {
        type: 'message',
        id: '00000002',
        parentId: '00000001',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'user', content: 'abcd', timestamp: 2 },
      },
      {
        type: 'message',
        id: '00000003',
        parentId: '00000002',
        timestamp: '2026-01-01T00:00:03.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'efgh' }],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(900),
          stopReason: 'stop',
          timestamp: 3,
        },
      },
      {
        type: 'message',
        id: '00000004',
        parentId: '00000003',
        timestamp: '2026-01-01T00:00:04.000Z',
        message: { role: 'user', content: 'ijkl', timestamp: 4 },
      },
      {
        type: 'message',
        id: '00000005',
        parentId: '00000004',
        timestamp: '2026-01-01T00:00:05.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'mnop' }],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(700),
          stopReason: 'stop',
          timestamp: 5,
        },
      },
    ]),
  )

  //when
  const analysis = analyzeSession(session)

  //then
  assert.equal(analysis.baseline.tokens, 1)
  assert.equal(analysis.requests.length, 1)
  assert.equal(analysis.requests[0]?.footprintTokens, 5)
  assert.equal(analysis.requestExposure.tokens, 5)
  assert.equal(analysis.oneTimeMessageAdditionsTokens, 4)
  assert.equal(analysis.requests[0]?.providerUsage?.input, 700)
  assert.notEqual(analysis.requests[0]?.providerUsage?.input, analysis.requests[0]?.footprintTokens)
  assert.equal(analysis.sourceGroups.systemPromptAndInstructionFiles, 1)
  assert.equal(analysis.sourceGroups.otherConversation, 4)
  assert.equal(
    Object.values(analysis.sourceGroups).reduce((sum, tokens) => sum + tokens, 0),
    analysis.requestExposure.tokens,
  )
})

test('should count projected tool calls and results once given a completed tool cycle', () => {
  //given
  const tool = { name: 'shell', description: 'run', parameters: { type: 'object' } }
  const session = parseSavedSession(
    serializeSession([
      {
        type: 'message',
        id: '00000011',
        parentId: null,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'system', content: '', sections: { preamble: 'p' }, toolsAdded: [tool], timestamp: 1 },
      },
      {
        type: 'message',
        id: '00000012',
        parentId: '00000011',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'user', content: 'go', timestamp: 2 },
      },
      {
        type: 'message',
        id: '00000013',
        parentId: '00000012',
        timestamp: '2026-01-01T00:00:03.000Z',
        message: {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: 'call-1', name: 'shell', arguments: { x: 1 } },
            { type: 'toolCall', id: 'call-2', name: 'shell', arguments: { y: 2 } },
          ],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(50),
          stopReason: 'toolUse',
          timestamp: 3,
        },
      },
      {
        type: 'message',
        id: '00000014',
        parentId: '00000013',
        timestamp: '2026-01-01T00:00:04.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'shell',
          content: [{ type: 'text', text: 'abcd' }],
          details: { hidden: 'not model context' },
          isError: false,
          timestamp: 4,
        },
      },
      {
        type: 'message',
        id: '00000015',
        parentId: '00000014',
        timestamp: '2026-01-01T00:00:05.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'call-2',
          toolName: 'shell',
          content: [{ type: 'text', text: 'efgh' }],
          details: { hidden: 'must not enter report context' },
          isError: true,
          timestamp: 5,
        },
      },
      {
        type: 'message',
        id: '00000016',
        parentId: '00000015',
        timestamp: '2026-01-01T00:00:06.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(80),
          stopReason: 'stop',
          timestamp: 6,
        },
      },
    ]),
  )

  //when
  const analysis = analyzeSession(session)
  const html = renderContextMeteringReport(analysis)

  //then
  assert.equal(analysis.requests.length, 1)
  assert.equal(
    analysis.requests[0]?.contributions.some((item) => item.entryId === '00000013'),
    true,
  )
  assert.equal(analysis.sourceGroups.toolCallsAndResults, 8)
  assert.equal(analysis.tools[0]?.callCount, 2)
  assert.equal(analysis.tools[0]?.argumentTokens, 6)
  assert.equal(analysis.tools[0]?.totalResultTokens, 2)
  assert.equal(analysis.tools[0]?.oneTimeInteractionTokens, 8)
  assert.equal(analysis.toolInvocations.length, 2)
  assert.equal(analysis.toolInvocations.find((item) => item.toolCallId === 'call-1')?.resultEntryId, '00000014')
  assert.equal(analysis.toolInvocations.find((item) => item.toolCallId === 'call-2')?.isError, true)
  assert.equal(JSON.stringify(analysis.entries).includes('must not enter report context'), false)
  const timelineStart = html.indexOf('<ol class="invocation-timeline"')
  const timeline = html.slice(timelineStart)
  assert.equal((timeline.match(/class="invocation-row"/g) ?? []).length, 2)
  assert.ok(timeline.includes('Success'))
  assert.ok(timeline.includes('Failed'))
  assert.ok(timeline.includes('abcd'))
  assert.ok(timeline.includes('efgh'))
  assert.match(timeline, /<a href="#call-[^"]+">Open call input<\/a>/)
  assert.match(timeline, /<a href="#result-[^"]+">Open tool result<\/a>/)
})

test('should count projected tool context and interactions once given a saved session', () => {
  //given
  const tool = { name: 'shell', description: 'run commands', parameters: { type: 'object' } }
  const systemMessage = {
    role: 'system',
    content: 'system prompt',
    sections: {
      'metering:tool-prompt:shell': 'Run shell commands safely.\nExample: shell({ command: "pwd" })',
      tools: '- shell: Run shell commands\nShared tool guidance',
    },
    toolsAdded: [tool],
    timestamp: 1,
  }
  const session = parseSavedSession(
    serializeSession([
      {
        type: 'message',
        id: '00000031',
        parentId: null,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: systemMessage,
      },
      {
        type: 'message',
        id: '00000032',
        parentId: '00000031',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'user', content: 'run pwd', timestamp: 2 },
      },
      {
        type: 'message',
        id: '00000033',
        parentId: '00000032',
        timestamp: '2026-01-01T00:00:03.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call-repeat', name: 'shell', arguments: { command: 'pwd' } }],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(50),
          stopReason: 'toolUse',
          timestamp: 3,
        },
      },
      {
        type: 'message',
        id: '00000034',
        parentId: '00000033',
        timestamp: '2026-01-01T00:00:04.000Z',
        message: {
          role: 'toolResult',
          toolCallId: 'call-repeat',
          toolName: 'shell',
          content: [{ type: 'text', text: 'workspace' }],
          isError: false,
          timestamp: 4,
        },
      },
      {
        type: 'message',
        id: '00000035',
        parentId: '00000034',
        timestamp: '2026-01-01T00:00:05.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(50),
          stopReason: 'stop',
          timestamp: 5,
        },
      },
      {
        type: 'message',
        id: '00000036',
        parentId: '00000035',
        timestamp: '2026-01-01T00:00:06.000Z',
        message: { role: 'user', content: 'confirm', timestamp: 6 },
      },
      {
        type: 'message',
        id: '00000037',
        parentId: '00000036',
        timestamp: '2026-01-01T00:00:07.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'confirmed' }],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(50),
          stopReason: 'stop',
          timestamp: 7,
        },
      },
    ]),
  )

  //when
  const analysis = analyzeSession(session)
  const html = renderContextMeteringReport(analysis)

  //then
  const shell = analysis.tools.find((item) => item.name === 'shell')
  assert.ok(shell)
  const contributions = analysis.requests.flatMap((request) => request.contributions)
  const attributed = contributions.filter((item) => item.toolName === 'shell')
  const sumTokens = (items: readonly { tokens: number }[]): number =>
    items.reduce((total, item) => total + item.tokens, 0)
  assert.equal(shell.estimatedContextExposureTokens, sumTokens(attributed))
  assert.equal(
    shell.estimatedDefinitionExposureTokens,
    sumTokens(attributed.filter((item) => item.kind === 'tool-definition')),
  )
  assert.equal(shell.estimatedPromptExposureTokens, sumTokens(attributed.filter((item) => item.kind === 'tool-prompt')))
  assert.equal(shell.estimatedArgumentExposureTokens, sumTokens(attributed.filter((item) => item.kind === 'tool-call')))
  assert.equal(shell.estimatedResultExposureTokens, sumTokens(attributed.filter((item) => item.kind === 'tool-result')))

  const definitionByRequest = analysis.requests.map((request) =>
    sumTokens(request.contributions.filter((item) => item.toolName === 'shell' && item.kind === 'tool-definition')),
  )
  assert.equal(definitionByRequest.length, 1)
  assert.ok(definitionByRequest[0] && definitionByRequest[0] > 0)

  const shared = contributions.filter(
    (item) =>
      !item.toolName &&
      (item.group === 'toolDefinitionsAndPromptText' ||
        item.group === 'toolCallsAndResults' ||
        item.source === 'tools'),
  )
  assert.equal(analysis.sharedToolContextExposureTokens, sumTokens(shared))
  assert.ok(analysis.sharedToolContextExposureTokens > 0)
  assert.ok(html.includes('Shared tool guidance'))
  assert.ok(
    html.includes(
      `Shared or unattributed tool context: ${analysis.sharedToolContextExposureTokens} tokens estimated in the selected context.`,
    ),
  )

  const staticContextStart = html.indexOf('<section class="tool-context-details">')
  const staticContextEnd = html.indexOf('<dl class="tool-total-metrics">', staticContextStart)
  const staticContext = html.slice(staticContextStart, staticContextEnd)
  const timelineStart = html.indexOf('<ol class="invocation-timeline"')
  const timelineEnd = html.indexOf('</ol>', timelineStart)
  const timeline = html.slice(timelineStart, timelineEnd)
  assert.ok(staticContext.includes('Run shell commands safely.'))
  assert.ok(staticContext.includes('Example: shell({ command: &quot;pwd&quot; })'))
  assert.ok(staticContext.includes('&quot;type&quot;'))
  assert.doesNotMatch(staticContext, /Shared tool guidance/)
  assert.equal(analysis.toolInvocations.length, 1)
  assert.equal((timeline.match(/class="invocation-row"/g) ?? []).length, 1)
  assert.ok(timeline.includes('&quot;command&quot;'))
  assert.ok(timeline.includes('workspace'))
  assert.ok(html.includes('Example: shell({ command: &quot;pwd&quot; })'))
})

test('should exclude compacted history from the selected projection given a compaction checkpoint', () => {
  //given
  const systemMessage = { role: 'system', content: 'sys', timestamp: 1 }
  const session = parseSavedSession(
    serializeSession([
      {
        type: 'message',
        id: '00000021',
        parentId: null,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: systemMessage,
      },
      {
        type: 'message',
        id: '00000022',
        parentId: '00000021',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'user', content: 'old!', timestamp: 2 },
      },
      {
        type: 'message',
        id: '00000023',
        parentId: '00000022',
        timestamp: '2026-01-01T00:00:03.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'answer' }],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(40),
          stopReason: 'stop',
          timestamp: 3,
        },
      },
      {
        type: 'message',
        id: '00000024',
        parentId: '00000023',
        timestamp: '2026-01-01T00:00:04.000Z',
        message: { role: 'user', content: 'keep', timestamp: 4 },
      },
      {
        type: 'compaction',
        id: '00000025',
        parentId: '00000024',
        timestamp: '2026-01-01T00:00:05.000Z',
        summary: 'sum',
        firstKeptEntryId: '00000024',
        tokensBefore: 10,
        systemMessage,
      },
      {
        type: 'message',
        id: '00000026',
        parentId: '00000025',
        timestamp: '2026-01-01T00:00:06.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'after' }],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(50),
          stopReason: 'stop',
          timestamp: 6,
        },
      },
    ]),
  )

  //when
  const analysis = analyzeSession(session)

  //then
  assert.equal(analysis.requests.length, 1)
  assert.equal(
    analysis.requests[0]?.contributions.some((item) => item.entryId === '00000022'),
    false,
  )
  assert.equal(
    analysis.requests[0]?.contributions.some((item) => item.entryId === '00000024'),
    true,
  )
  assert.equal(
    analysis.requests[0]?.contributions.some((item) => item.label === 'Compaction summary'),
    true,
  )
})

test('should exclude omitted content from the selected projection given a context edit', () => {
  //given
  const session = parseSavedSession(
    serializeSession([
      {
        type: 'message',
        id: '00000031',
        parentId: null,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'system', content: 'sys!', timestamp: 1 },
      },
      {
        type: 'message',
        id: '00000032',
        parentId: '00000031',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'user', content: 'old!', timestamp: 2 },
      },
      {
        type: 'message',
        id: '00000033',
        parentId: '00000032',
        timestamp: '2026-01-01T00:00:03.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'answer' }],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(40),
          stopReason: 'stop',
          timestamp: 3,
        },
      },
      {
        type: 'context_edit',
        id: '00000034',
        parentId: '00000033',
        timestamp: '2026-01-01T00:00:04.000Z',
        targetId: '00000032',
        replacement: null,
      },
      {
        type: 'message',
        id: '00000035',
        parentId: '00000034',
        timestamp: '2026-01-01T00:00:05.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'after' }],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(50),
          stopReason: 'stop',
          timestamp: 6,
        },
      },
    ]),
  )

  //when
  const analysis = analyzeSession(session)

  //then
  assert.equal(analysis.requests.length, 1)
  assert.equal(
    analysis.requests[0]?.contributions.some((item) => item.entryId === '00000032'),
    false,
  )
  assert.equal(
    analysis.entries.find((entry) => entry.entryId === '00000032'),
    undefined,
  )
})

test('should use effective replacement text given a context edit', () => {
  //given
  const session = parseSavedSession(
    serializeSession([
      {
        type: 'message',
        id: '00000051',
        parentId: null,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'system', content: 'sys', timestamp: 1 },
      },
      {
        type: 'message',
        id: '00000052',
        parentId: '00000051',
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'user', content: 'old!', timestamp: 2 },
      },
      {
        type: 'message',
        id: '00000053',
        parentId: '00000052',
        timestamp: '2026-01-01T00:00:03.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'answer' }],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(40),
          stopReason: 'stop',
          timestamp: 3,
        },
      },
      {
        type: 'context_edit',
        id: '00000054',
        parentId: '00000053',
        timestamp: '2026-01-01T00:00:04.000Z',
        targetId: '00000052',
        replacement: { role: 'user', content: 'replacement text', timestamp: 2 },
      },
      {
        type: 'message',
        id: '00000055',
        parentId: '00000054',
        timestamp: '2026-01-01T00:00:05.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'after' }],
          api: 'test',
          provider: 'test-provider',
          model: 'test-model',
          usage: usage(50),
          stopReason: 'stop',
          timestamp: 5,
        },
      },
    ]),
  )

  //when
  const analysis = analyzeSession(session)

  //then
  const entry = analysis.entries.find((item) => item.entryId === '00000052')
  assert.equal(entry?.contextStatus, 'current')
  assert.equal(entry?.rawMessages[0]?.content as string, 'replacement text')
  assert.equal(entry?.effectiveMessages[0]?.content as string, 'replacement text')
  assert.equal(entry?.cumulativeRequestExposure, entry?.messageAdditionTokens)
})

test('should render only the selected current context after compaction and edits', () => {
  //given
  let step = 0
  const messageEntry = (
    id: string,
    parentId: string | null,
    message: Record<string, unknown>,
  ): Record<string, unknown> => {
    step += 1
    const timestamp = 1767225600000 + step * 1000
    return {
      type: 'message',
      id,
      parentId,
      timestamp: new Date(timestamp).toISOString(),
      message: { ...message, timestamp },
    }
  }
  const shell = { name: 'shell', description: 'run shell', parameters: { type: 'object' } }
  const initialSystem = {
    role: 'system',
    content: 'system content',
    sections: { preamble: 'initial prompt', tools: '- shell: run shell' },
    toolsAdded: [shell],
    timestamp: 1,
  }
  const checkpointSystem = {
    role: 'system',
    content: 'system content',
    sections: { preamble: 'compacted prompt', tools: '- shell: run shell' },
    toolsAdded: [shell],
    timestamp: 5,
  }
  const session = parseSavedSession(
    serializeSession([
      messageEntry('00000061', null, initialSystem),
      messageEntry('00000062', '00000061', { role: 'user', content: 'compacted-original' }),
      messageEntry('00000063', '00000062', {
        role: 'assistant',
        content: [{ type: 'text', text: 'first response' }],
        api: 'test',
        provider: 'test-provider',
        model: 'test-model',
        usage: usage(10),
        stopReason: 'stop',
      }),
      messageEntry('00000064', '00000063', { role: 'user', content: 'kept-at-compaction' }),
      {
        type: 'compaction',
        id: '00000065',
        parentId: '00000064',
        timestamp: '2026-01-01T00:00:05.000Z',
        summary: 'compaction summary',
        firstKeptEntryId: '00000064',
        tokensBefore: 30,
        systemMessage: checkpointSystem,
      },
      messageEntry('00000066', '00000065', { role: 'user', content: 'replacement-original' }),
      messageEntry('00000067', '00000066', { role: 'user', content: 'omission-original' }),
      messageEntry('00000068', '00000067', {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 'call-fixture', name: 'shell', arguments: { command: 'pwd' } }],
        api: 'test',
        provider: 'test-provider',
        model: 'test-model',
        usage: usage(20),
        stopReason: 'toolUse',
      }),
      messageEntry('00000069', '00000068', {
        role: 'toolResult',
        toolCallId: 'call-fixture',
        toolName: 'shell',
        content: [{ type: 'text', text: 'visible tool result' }],
        details: { secret: 'private tool result details' },
        isError: false,
      }),
      {
        type: 'context_edit',
        id: '00000070',
        parentId: '00000069',
        timestamp: '2026-01-01T00:00:10.000Z',
        targetId: '00000066',
        replacement: { role: 'user', content: 'replacement-effective', timestamp: 1767225609000 },
      },
      {
        type: 'context_edit',
        id: '00000071',
        parentId: '00000070',
        timestamp: '2026-01-01T00:00:11.000Z',
        targetId: '00000067',
        replacement: null,
      },
      messageEntry('00000072', '00000071', { role: 'user', content: 'post-compaction user text' }),
      messageEntry('00000073', '00000072', {
        role: 'assistant',
        content: [{ type: 'text', text: 'final response' }],
        api: 'test',
        provider: 'test-provider',
        model: 'test-model',
        usage: usage(30),
        stopReason: 'stop',
      }),
    ]),
  )
  const analysis = analyzeSession(session)

  //when
  const html = renderContextMeteringReport(analysis)

  //then
  assert.ok(html.includes('compaction summary'))
  assert.ok(html.includes('compacted prompt'))
  assert.ok(html.includes('kept-at-compaction'))
  assert.ok(html.includes('post-compaction user text'))
  assert.ok(html.includes('Call ID: <code>call-fixture</code>'))
  assert.ok(html.includes('visible tool result'))
  assert.ok(html.includes('replacement-effective'))
  assert.ok(html.includes('final response'))
  assert.doesNotMatch(
    html,
    /compacted-original|replacement-original|omission-original|initial prompt|private tool result details/,
  )
})
