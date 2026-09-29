import assert from 'node:assert/strict'
import test from 'node:test'
import type { Usage } from '@earendil-works/pi-ai'
import type { Contribution, SessionAnalysis, ToolStatistics } from '../src/analysis.ts'
import { renderContextMeteringReport } from '../src/context-metering-report.ts'

function providerUsage(): Usage {
  return {
    input: 120,
    output: 8,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 128,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
}

function createAnalysis(): SessionAnalysis {
  const systemMessage = {
    role: 'system',
    content: '</script><script>alert("prompt")</script>',
    sections: {
      preamble: '<img src=x onerror=alert("section")>',
      tools: '- shell: Run shell commands',
    },
    toolsAdded: [
      {
        name: 'shell',
        description: '<svg onload=alert("tool")>',
        parameters: { type: 'object', properties: { command: { type: 'string' } } },
      },
    ],
    timestamp: 1,
  }
  const contributions: Contribution[] = [
    {
      id: 'tool-definition:shell',
      label: 'shell definition',
      group: 'toolDefinitionsAndPromptText',
      kind: 'tool-definition',
      tokens: 1,
      toolName: 'shell',
    },
    {
      id: 'system-content',
      label: 'System prompt content',
      group: 'systemPromptAndInstructionFiles',
      kind: 'system-content',
      tokens: 1,
    },
    {
      id: 'tool-prompt:shell',
      label: 'shell prompt text',
      group: 'toolDefinitionsAndPromptText',
      kind: 'tool-prompt',
      tokens: 1,
      toolName: 'shell',
    },
    {
      id: 'entry:user-1',
      label: 'User message',
      group: 'otherConversation',
      kind: 'conversation',
      tokens: 1,
      entryId: 'user-1',
    },
    {
      id: 'tool-call:call-1',
      label: 'shell arguments',
      group: 'toolCallsAndResults',
      kind: 'tool-call',
      tokens: 1,
      entryId: 'assistant-1',
      toolName: 'shell',
      toolCallId: 'call-1',
    },
    {
      id: 'tool-result:call-1',
      label: 'shell result',
      group: 'toolCallsAndResults',
      kind: 'tool-result',
      tokens: 1,
      entryId: 'result-1',
      toolName: 'shell',
      toolCallId: 'call-1',
    },
    {
      id: 'entry:assistant-2',
      label: 'Assistant response',
      group: 'otherConversation',
      kind: 'conversation',
      tokens: 1,
      entryId: 'assistant-2',
    },
  ]
  const shell: ToolStatistics = {
    name: 'shell',
    description: '<svg onload=alert("tool")>',
    parameterSchema: (systemMessage.toolsAdded.at(0)?.parameters ?? {}) as ToolStatistics['parameterSchema'],
    callCount: 1,
    argumentTokens: 1,
    totalResultTokens: 1,
    averageResultTokens: 1,
    oneTimeInteractionTokens: 2,
    estimatedContextExposureTokens: 4,
    estimatedDefinitionExposureTokens: 1,
    estimatedPromptExposureTokens: 1,
    estimatedArgumentExposureTokens: 1,
    estimatedResultExposureTokens: 1,
  }

  return {
    sessionId: 'session-1',
    cwd: '/project/<unsafe>',
    source: 'saved',
    selectedLeafId: 'assistant-2',
    analyzedAt: '2026-01-01T00:00:00.000Z',
    tokenEstimateMethod: 'Pi estimateTokens() and character-based sections',
    baseline: {
      available: true,
      source: 'saved',
      tokens: 3,
      contributions: contributions.slice(0, 3),
      systemMessage,
    },
    latestRequestFootprintTokens: 7,
    requestCount: 1,
    requestExposure: { tokens: 7, knownTokens: 7, complete: true },
    oneTimeMessageAdditionsTokens: 4,
    sourceGroups: {
      systemPromptAndInstructionFiles: 1,
      toolDefinitionsAndPromptText: 2,
      toolCallsAndResults: 2,
      otherConversation: 2,
      unattributedContent: 0,
    },
    sharedToolContextExposureTokens: 0,
    requests: [
      {
        index: 1,
        responseEntryId: 'assistant-2',
        timestamp: '2026-01-01T00:00:05.000Z',
        footprintTokens: 7,
        loadoutSource: 'saved',
        loadoutMessage: systemMessage,
        inputEntryIds: ['user-1', 'assistant-1', 'result-1', 'assistant-2'],
        knownTokens: 7,
        loadoutTokens: 3,
        conversationTokens: 4,
        contributions,
        providerUsage: providerUsage(),
        model: 'test-provider/test-model',
      },
    ],
    tools: [shell],
    toolInvocations: [
      {
        toolName: 'shell',
        toolCallId: 'call-1',
        callEntryId: 'assistant-1',
        resultEntryId: 'result-1',
        argumentTokens: 1,
        resultTokens: 1,
        isError: false,
        oneTimeInteractionTokens: 2,
        latestRequestTokens: 2,
        latestRequestShare: (2 / 7) * 100,
      },
    ],
    promptSections: [
      {
        id: 'prompt-section:preamble',
        label: 'preamble',
        source: 'preamble',
        kind: 'prompt-section',
        cumulativeRequestExposure: 0,
        exposureShare: 0,
        latestRequestTokens: 0,
      },
    ],
    entries: [
      {
        entryId: 'user-1',
        entryType: 'message',
        role: 'user',
        timestamp: '2026-01-01T00:00:02.000Z',
        contextStatus: 'current',
        messageAdditionTokens: 1,
        historicalTokens: 1,
        cumulativeRequestExposure: 2,
        exposureShare: (1 / 7) * 100,
        latestRequestIncluded: true,
        toolCallIds: [],
        rawMessages: [{ role: 'user', content: '</script><script>alert("conversation")</script>' }],
        effectiveMessages: [{ role: 'user', content: '</script><script>alert("conversation")</script>' }],
      },
      {
        entryId: 'assistant-1',
        entryType: 'message',
        role: 'assistant',
        timestamp: '2026-01-01T00:00:03.000Z',
        contextStatus: 'current',
        messageAdditionTokens: 1,
        historicalTokens: 1,
        cumulativeRequestExposure: 1,
        exposureShare: 10,
        latestRequestIncluded: true,
        toolCallIds: ['call-1'],
        rawMessages: [
          {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'call-1', name: 'shell', arguments: { command: '</script>' } }],
          },
        ],
        effectiveMessages: [
          {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'call-1', name: 'shell', arguments: { command: '</script>' } }],
          },
        ],
      },
      {
        entryId: 'result-1',
        entryType: 'message',
        role: 'toolResult',
        timestamp: '2026-01-01T00:00:04.000Z',
        contextStatus: 'current',
        messageAdditionTokens: 1,
        historicalTokens: 1,
        cumulativeRequestExposure: 1,
        exposureShare: 10,
        latestRequestIncluded: true,
        toolCallIds: ['call-1'],
        rawMessages: [
          {
            role: 'toolResult',
            toolCallId: 'call-1',
            toolName: 'shell',
            content: [{ type: 'text', text: 'result & output' }],
            isError: false,
          },
        ],
        effectiveMessages: [
          {
            role: 'toolResult',
            toolCallId: 'call-1',
            toolName: 'shell',
            content: [{ type: 'text', text: 'result & output' }],
            isError: false,
          },
        ],
      },
      {
        entryId: 'assistant-2',
        entryType: 'message',
        role: 'assistant',
        timestamp: '2026-01-01T00:00:05.000Z',
        contextStatus: 'current',
        messageAdditionTokens: 1,
        historicalTokens: 1,
        cumulativeRequestExposure: 0,
        exposureShare: (1 / 7) * 100,
        latestRequestIncluded: true,
        toolCallIds: [],
        rawMessages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }],
        effectiveMessages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }],
        providerUsage: providerUsage(),
      },
    ],
    warnings: [],
  }
}

test('should escape untrusted prompt and conversation text given malicious session content', () => {
  //given
  const analysis = createAnalysis()

  //when
  const html = renderContextMeteringReport(analysis)

  //then
  assert.ok(html.includes('&lt;/script&gt;&lt;script&gt;alert(&quot;conversation&quot;)&lt;/script&gt;'))
  assert.ok(html.includes('&lt;img src=x onerror=alert(&quot;section&quot;)&gt;'))
  assert.ok(html.includes('&lt;svg onload=alert(&quot;tool&quot;)&gt;'))
  assert.equal(html.includes('</script><script>alert("conversation")'), false)
  assert.equal(html.includes('<svg onload=alert("tool")>'), false)
})

test('should link parallel tool calls by call ID given matching tool results', () => {
  //given
  const analysis = createAnalysis()
  const callEntry = analysis.entries.find((entry) => entry.entryId === 'assistant-1')
  const resultEntry = analysis.entries.find((entry) => entry.entryId === 'result-1')
  assert.ok(callEntry)
  assert.ok(resultEntry)
  const assistantMessage = callEntry.effectiveMessages.at(0)
  assert.ok(assistantMessage)
  assert.ok(Array.isArray(assistantMessage.content))
  assistantMessage.content.push({ type: 'toolCall', id: 'call-2', name: 'shell', arguments: { command: 'pwd' } })
  callEntry.toolCallIds.push('call-2')
  const resultIndex = analysis.entries.indexOf(resultEntry)
  analysis.entries.splice(resultIndex + 1, 0, {
    ...resultEntry,
    entryId: 'result-2',
    timestamp: '2026-01-01T00:00:04.500Z',
    toolCallIds: ['call-2'],
    rawMessages: [
      {
        role: 'toolResult',
        toolCallId: 'call-2',
        toolName: 'shell',
        content: [{ type: 'text', text: 'parallel result' }],
        isError: false,
      },
    ],
    effectiveMessages: [
      {
        role: 'toolResult',
        toolCallId: 'call-2',
        toolName: 'shell',
        content: [{ type: 'text', text: 'parallel result' }],
        isError: false,
      },
    ],
  })

  //when
  const html = renderContextMeteringReport(analysis)

  //then
  const conversationStart = html.indexOf('id="conversation-panel"')
  const statisticsStart = html.indexOf('id="statistics-panel"')
  const conversation = html.slice(conversationStart, statisticsStart)
  assert.equal((conversation.match(/id="call-/g) ?? []).length, 2)
  assert.equal((conversation.match(/id="result-/g) ?? []).length, 2)
  assert.equal((conversation.match(/href="#result-/g) ?? []).length, 2)
  assert.equal((conversation.match(/href="#call-/g) ?? []).length, 2)
  assert.ok(conversation.includes('Call ID: <code>call-1</code>'))
  assert.ok(conversation.includes('Call ID: <code>call-2</code>'))
  assert.equal((conversation.match(/href="#tool-card-/g) ?? []).length, 2)
})

test('should render compact context rows and nest tool results under calls in the selected context', () => {
  //given
  const analysis = createAnalysis()

  //when
  const html = renderContextMeteringReport(analysis)
  const conversationStart = html.indexOf('id="conversation-panel"')
  const toolsStart = html.indexOf('id="statistics-panel"')
  const conversation = html.slice(conversationStart, toolsStart)

  //then
  assert.equal((conversation.match(/class="entry-summary"/g) ?? []).length, analysis.entries.length)
  assert.ok(conversation.includes('Selected context breakdown'))
  assert.ok(conversation.includes('14,29%'))
  assert.ok(conversation.includes('In selected context'))
  assert.ok(conversation.includes('done'))
  const callRowStart = conversation.indexOf('<details class="entry" id="entry-1">')
  const nestedResultsStart = conversation.indexOf('</details><ol class="nested-entry-list"', callRowStart)
  const resultRowStart = conversation.indexOf('<details class="entry" id="entry-2">', nestedResultsStart)
  assert.ok(callRowStart >= 0)
  assert.ok(nestedResultsStart > callRowStart)
  assert.ok(resultRowStart > nestedResultsStart)
})

test('should render the projected compaction summary and post-compaction content only', () => {
  const analysis = createAnalysis()
  const context = analysis.requests.at(-1)
  const retainedEntry = analysis.entries.find((entry) => entry.entryId === 'user-1')
  assert.ok(context)
  assert.ok(retainedEntry)
  retainedEntry.rawMessages = [{ role: 'user', content: 'discarded pre-compaction user secret' }]
  retainedEntry.effectiveMessages = [{ role: 'user', content: 'first kept entry content' }]
  const summaryEntry = {
    ...retainedEntry,
    entryId: 'compaction-summary',
    role: 'compactionSummary',
    timestamp: '2026-01-01T00:00:01.000Z',
    latestRequestIncluded: true,
    rawMessages: [{ role: 'compactionSummary', summary: 'stale compaction source secret' }],
    effectiveMessages: [{ role: 'compactionSummary', summary: 'compaction summary kept by the projection' }],
  }
  const laterUserEntry = {
    ...retainedEntry,
    entryId: 'later-user',
    timestamp: '2026-01-01T00:00:04.500Z',
    rawMessages: [{ role: 'user', content: 'hidden raw later copy' }],
    effectiveMessages: [{ role: 'user', content: 'post-compaction user addition' }],
  }
  analysis.entries.unshift(summaryEntry)
  analysis.entries.splice(4, 0, laterUserEntry)
  context.contributions.push(
    {
      id: 'entry:compaction-summary',
      label: 'Compaction summary',
      group: 'otherConversation',
      kind: 'conversation',
      tokens: 1,
      entryId: 'compaction-summary',
    },
    {
      id: 'entry:later-user',
      label: 'Later user message',
      group: 'otherConversation',
      kind: 'conversation',
      tokens: 1,
      entryId: 'later-user',
    },
  )
  context.inputEntryIds.push('compaction-summary', 'later-user')
  context.footprintTokens = 9
  context.knownTokens = 9
  context.conversationTokens = 6
  analysis.latestRequestFootprintTokens = 9
  analysis.requestExposure = { tokens: 9, knownTokens: 9, complete: true }
  analysis.oneTimeMessageAdditionsTokens = 6
  analysis.sourceGroups.otherConversation += 2

  const html = renderContextMeteringReport(analysis)

  assert.ok(html.includes('Current system snapshot'))
  assert.ok(html.includes('System prompt content'))
  assert.ok(html.includes('compaction summary kept by the projection'))
  assert.ok(html.includes('first kept entry content'))
  assert.ok(html.includes('post-compaction user addition'))
  assert.ok(html.includes('Call ID: <code>call-1</code>'))
  assert.ok(html.includes('result &amp; output'))
  assert.ok(html.includes('done'))
  assert.doesNotMatch(html, /discarded pre-compaction user secret|stale compaction source secret|hidden raw later copy/)
})

test('should show selected context window use separately from tool invocation totals', () => {
  const analysis = createAnalysis()
  const tool = analysis.tools.at(0)
  assert.ok(tool)

  const html = renderContextMeteringReport(analysis, 24)
  const conversationStart = html.indexOf('id="conversation-panel"')
  const statisticsStart = html.indexOf('id="statistics-panel"')
  const conversation = html.slice(conversationStart, statisticsStart)
  const statistics = html.slice(statisticsStart)

  assert.ok(conversation.includes('Context window'))
  assert.ok(conversation.includes('29,17% of 24 tokens'))
  assert.match(conversation, /<meter[^>]+value="29\.166/)
  assert.ok(statistics.includes('<dt>Estimated current-context exposure</dt><dd>4 tokens</dd>'))
  assert.ok(statistics.includes('<dt>Estimated invocation total from listed calls</dt><dd>2 tokens</dd>'))
})

test('should distinguish Pi context usage from the selected-context estimate', () => {
  const analysis = createAnalysis()
  const request = analysis.requests.at(-1)
  assert.ok(request)
  request.footprintTokens = 119_163
  request.contributions = [
    {
      id: 'request-estimate',
      label: 'Request estimate',
      group: 'otherConversation',
      kind: 'conversation',
      tokens: 119_163,
    },
  ]
  analysis.latestRequestFootprintTokens = 119_163

  const html = renderContextMeteringReport(analysis, 272_000, {
    tokens: 194_752,
    contextWindow: 272_000,
    percent: 71.6,
  })
  const conversationStart = html.indexOf('id="conversation-panel"')
  const statisticsStart = html.indexOf('id="statistics-panel"')
  const conversation = html.slice(conversationStart, statisticsStart)

  assert.ok(conversation.includes('Pi context estimate'))
  assert.ok(conversation.includes('71,6% of 272.000 tokens'))
  assert.ok(conversation.includes('Selected-context estimate'))
  assert.ok(conversation.includes('43,81% of 272.000 tokens'))
})

test('should flag selected-context estimates above the model context window', () => {
  const analysis = createAnalysis()
  const request = analysis.requests.at(-1)
  assert.ok(request)
  request.footprintTokens = 6
  analysis.latestRequestFootprintTokens = 6
  const html = renderContextMeteringReport(analysis, 3)
  const conversationStart = html.indexOf('id="conversation-panel"')
  const statisticsStart = html.indexOf('id="statistics-panel"')
  const conversation = html.slice(conversationStart, statisticsStart)

  assert.ok(conversation.includes('200% of 3 tokens'))
  assert.match(conversation, /<meter[^>]+value="100"/)
  assert.ok(conversation.includes('The selected-context estimate exceeds the model context window.'))
})

test('should separate static tool cost from dynamic calls and show outcomes given mixed invocations', () => {
  //given
  const analysis = createAnalysis()
  const invocation = analysis.toolInvocations.at(0)
  const tool = analysis.tools.at(0)
  assert.ok(invocation)
  assert.ok(tool)
  analysis.toolInvocations.push(
    {
      ...invocation,
      toolCallId: 'call-failed',
      resultEntryId: 'missing-failed-result',
      argumentTokens: 2,
      resultTokens: 3,
      isError: true,
      oneTimeInteractionTokens: 5,
    },
    {
      ...invocation,
      toolCallId: 'call-pending',
      resultEntryId: 'missing-pending-result',
      argumentTokens: 4,
      resultTokens: 0,
      isError: null,
      oneTimeInteractionTokens: 4,
    },
  )
  tool.callCount = 3
  tool.argumentTokens = 7
  tool.totalResultTokens = 4
  tool.averageResultTokens = 2
  tool.oneTimeInteractionTokens = 11
  tool.estimatedContextExposureTokens = 15
  tool.estimatedArgumentExposureTokens = 7
  tool.estimatedResultExposureTokens = 4

  //when
  const html = renderContextMeteringReport(analysis)
  const toolsStart = html.indexOf('id="statistics-panel"')
  const tools = html.slice(toolsStart)

  //then
  assert.ok(html.includes('>Tools</button>'))
  assert.ok(tools.includes('Current system-snapshot definition estimate'))
  assert.ok(tools.includes('Current system-snapshot prompt estimate'))
  assert.ok(tools.includes('Current system-snapshot tool estimate'))
  assert.ok(tools.includes('Current system snapshot'))
  assert.ok(tools.includes('Estimated current-context exposure'))
  assert.ok(tools.includes('Arguments 7 tokens'))
  assert.ok(tools.includes('Results 4 tokens'))
  assert.ok(tools.includes('1 success · 1 failed'))
  assert.ok(tools.includes('1 with no result'))
  assert.ok(tools.includes('Invocation timeline'))
  assert.ok(tools.includes('<dt>Call text estimate</dt>'))
  assert.ok(tools.includes('2026-01-01T00:00:03.000Z'))
  assert.ok(tools.includes('Selected-context interaction estimate: 2 tokens'))
  assert.ok(tools.includes('&lt;/script&gt;'))
  assert.ok(tools.includes('result &amp; output'))
  assert.ok(tools.includes('Open call input'))
  assert.ok(tools.includes('Open tool result'))
  assert.ok(html.includes("window.addEventListener('hashchange', activateHashTarget)"))
})

test('should keep the current system snapshot and tool details in the selected-context view', () => {
  //given
  const analysis = createAnalysis()

  //when
  const html = renderContextMeteringReport(analysis)
  const conversationStart = html.indexOf('id="conversation-panel"')
  const toolsStart = html.indexOf('id="statistics-panel"')
  const conversation = html.slice(conversationStart, toolsStart)
  const tools = html.slice(toolsStart)
  const sourceStart = tools.indexOf('<h3>Current system snapshot</h3>')
  const availableToolsStart = tools.indexOf('<h3>Tools in selected context</h3>')
  const sources = tools.slice(sourceStart, availableToolsStart)

  //then
  assert.ok(sourceStart >= 0)
  assert.ok(availableToolsStart > sourceStart)
  assert.ok(conversation.includes('View tool details'))
  assert.doesNotMatch(conversation, /System prompt content/)
  assert.doesNotMatch(conversation, /Tool definition: shell/)
  assert.doesNotMatch(conversation, /Interaction estimates/)
  assert.doesNotMatch(conversation, /Tool prompt details/)
  assert.doesNotMatch(sources, /Tool definition: shell/)
  assert.ok(tools.includes('Current system snapshot'))
  assert.ok(tools.includes('<details class="tool-definition-details">'))
  assert.ok(tools.includes('Invocation sizes, counted once'))
})

test('should show exclusive chart shares and provider usage separately given a complete request', () => {
  //given
  const analysis = createAnalysis()

  //when
  const html = renderContextMeteringReport(analysis)

  //then
  assert.ok(html.includes('Tool definitions and attributable prompt text'))
  assert.ok(html.includes('Tool calls and results'))
  assert.ok(html.includes('Other conversation'))
  assert.ok(html.includes('2 tokens · 28,57%'))
  assert.ok(html.includes('Selected-context estimate'))
  assert.ok(html.includes('Provider-reported usage'))
  assert.ok(html.includes('120 input tokens'))
  assert.ok(html.includes('Current system-snapshot definition estimate'))
  assert.ok(html.includes('Current system-snapshot tokens'))
  assert.ok(html.includes('Selected-context share'))
})

test('should match donut segments to legend totals given exclusive source groups', () => {
  //given
  const analysis = createAnalysis()
  const values = Object.values(analysis.sourceGroups)
  const total = values.reduce((sum, tokens) => sum + tokens, 0)
  const circumference = 2 * Math.PI * 58

  //when
  const html = renderContextMeteringReport(analysis)

  //then
  const segmentLengths = [...html.matchAll(/stroke-dasharray="([\d.]+) [\d.]+"/g)].map((match) => Number(match[1]))
  const legendHtml = html.match(/<ul class="chart-legend">([\s\S]*?)<\/ul>/)?.[1]
  assert.ok(legendHtml)
  const legendEntries = [...legendHtml.matchAll(/<span class="legend-value">([\d.,]+) tokens? · ([\d.,]+)%<\/span>/g)]
  assert.deepEqual(
    legendEntries.map((entry) => Number(entry[1]?.replaceAll('.', '').replace(',', '.'))),
    values,
  )
  assert.deepEqual(
    legendEntries.map((entry) => Number(entry[2]?.replaceAll('.', '').replace(',', '.'))),
    values.map((tokens) => Number(((tokens / total) * 100).toFixed(2))),
  )
  assert.equal(segmentLengths.length, values.filter((tokens) => tokens > 0).length)
  assert.ok(Math.abs(segmentLengths.reduce((sum, length) => sum + length, 0) - circumference) < 0.0001)
  assert.deepEqual(
    segmentLengths.map((length) => Number(((length / circumference) * 100).toFixed(5))),
    values.filter((tokens) => tokens > 0).map((tokens) => Number(((tokens / total) * 100).toFixed(5))),
  )
})

test('should explain invocation totals separately from selected-context exposure given a tool with calls', () => {
  const analysis = createAnalysis()
  const html = renderContextMeteringReport(analysis)
  const tools = html.slice(html.indexOf('id="statistics-panel"'))

  assert.ok(
    tools.includes(
      'The invocation total adds each listed call and result once. It excludes tool definitions and prompt guidance. Expanded details show their estimated contribution to the selected context.',
    ),
  )
})

test('should show selected-context tool exposure separately from invocation totals', () => {
  const analysis = createAnalysis()
  const html = renderContextMeteringReport(analysis)
  const tools = html.slice(html.indexOf('id="statistics-panel"'))
  const summaryStart = tools.indexOf('<summary class="tool-card-summary">')
  const summaryEnd = tools.indexOf('</summary>', summaryStart)
  const summary = tools.slice(summaryStart, summaryEnd)

  assert.match(
    summary,
    /<small>Baseline token spend \(system snapshot\)<\/small><strong class="[^"]*">[^<]+<\/strong><small>Estimated invocation total from listed calls · 2 tokens<\/small>/,
  )
  assert.ok(summary.includes('Arguments 1 token'))
  assert.ok(summary.includes('Results 1 token'))
  assert.doesNotMatch(summary, /4 tokens/)
  assert.ok(tools.includes('<dt>Estimated invocation total from listed calls</dt><dd>2 tokens</dd>'))
  assert.ok(tools.includes('<dt>Estimated current-context exposure</dt><dd>4 tokens</dd>'))
  assert.ok(tools.includes('Current system-snapshot definition estimate</dt><dd>1 token'))
})

test('should ignore snapshot timestamps given an unchanged loadout', () => {
  //given
  const analysis = createAnalysis()
  const latestRequest = analysis.requests.at(-1)
  assert.ok(latestRequest)
  assert.ok(latestRequest.loadoutMessage)
  latestRequest.loadoutMessage = { ...latestRequest.loadoutMessage, timestamp: 99 }

  //when
  const html = renderContextMeteringReport(analysis)

  //then
  assert.doesNotMatch(html, /Effective loadout before request|class="loadout-event/)
})

test('should show tool prompt snippets from the selected system snapshot', () => {
  //given
  const analysis = createAnalysis()
  const context = analysis.requests.at(-1)
  assert.ok(context?.loadoutMessage)
  const sections = {
    ...context.loadoutMessage.sections,
    'metering:tool-prompt:shell': '- shell: Apply these usage guidelines.\nExample: shell({ command: "ls" })',
  }
  context.loadoutMessage = { ...context.loadoutMessage, sections }
  if (analysis.baseline.systemMessage)
    analysis.baseline.systemMessage = { ...analysis.baseline.systemMessage, sections }

  //when
  const html = renderContextMeteringReport(analysis)

  //then
  assert.ok(html.includes('Current system snapshot'))
  assert.ok(html.includes('shell prompt snippet'))
  assert.ok(html.includes('- shell: Run shell commands'))
  assert.ok(html.includes('tool-prompt:shell'))
  assert.ok(html.includes('Apply these usage guidelines.'))
  assert.ok(html.includes('Prompt guidance and examples · 1 token estimated in selected context'))
  assert.doesNotMatch(html, /Prompt section changed: tools/)
  assert.doesNotMatch(html, /In latest request|loadout shown above/)
  const detailsStart = html.indexOf('Tool prompt details')
  const detailsOpen = html.lastIndexOf('<details class="inline-cost-details">', detailsStart)
  const detailsEnd = html.indexOf('</details>', detailsStart)
  const details = html.slice(detailsOpen, detailsEnd + '</details>'.length)
  assert.ok(detailsOpen >= 0)
  assert.ok(details.includes('<summary>Tool prompt details</summary>'))
  assert.ok(details.includes('<div class="inline-cost-detail-content"><dl>'))
  assert.doesNotMatch(details, /class="popover"/)
  assert.doesNotMatch(details, /Cumulative request exposure/)
  assert.doesNotMatch(details, /Selected-branch exposure share/)
})

test('should feature baseline token spend given an unused tool with prompt examples', () => {
  //given
  const analysis = createAnalysis()
  const tool = analysis.tools[0]
  const initialMessage = analysis.baseline.systemMessage
  assert.ok(tool)
  assert.ok(initialMessage)
  tool.callCount = 0
  tool.argumentTokens = 0
  tool.totalResultTokens = 0
  tool.averageResultTokens = 0
  tool.oneTimeInteractionTokens = 0
  tool.estimatedContextExposureTokens = 4
  tool.estimatedArgumentExposureTokens = 0
  tool.estimatedResultExposureTokens = 0
  analysis.toolInvocations = []
  analysis.baseline.systemMessage = {
    ...initialMessage,
    sections: {
      ...initialMessage.sections,
      'metering:tool-prompt:shell': '- shell: Apply these usage guidelines.\nExample: shell({ command: "ls" })',
    },
  }
  for (const request of analysis.requests) {
    if (!request.loadoutMessage) continue
    request.loadoutMessage = {
      ...request.loadoutMessage,
      sections: {
        ...request.loadoutMessage.sections,
        'metering:tool-prompt:shell': '- shell: Apply these usage guidelines.\nExample: shell({ command: "ls" })',
      },
    }
  }

  //when
  const html = renderContextMeteringReport(analysis)
  const statistics = html.slice(html.indexOf('id="statistics-panel"'))
  const summaryStart = statistics.indexOf('<summary class="tool-card-summary">')
  const summaryEnd = statistics.indexOf('</summary>', summaryStart)
  const summary = statistics.slice(summaryStart, summaryEnd)

  //then
  assert.match(
    summary,
    /<small>Baseline token spend \(system snapshot\)<\/small><strong class="[^"]*">2 tokens<\/strong>/,
  )
  assert.ok(summary.includes('<small>Estimated invocation total from listed calls · 0 tokens</small>'))
  assert.ok(statistics.includes('Current system-snapshot definition estimate</dt><dd>1 token'))
  assert.ok(statistics.includes('Current system-snapshot prompt estimate</dt><dd>1 token'))
  assert.ok(statistics.includes('Current system-snapshot tool estimate</dt><dd>2 tokens'))
  assert.ok(statistics.includes('Apply these usage guidelines.'))
  assert.ok(statistics.includes('Example: shell'))
  assert.ok(statistics.includes('0 calls'))
  assert.ok(statistics.includes('0 with no result'))
  assert.ok(statistics.includes('shell has no invocation in the selected context.'))
  assert.ok(statistics.includes('Estimated current-context exposure'))
})

test('should explain the current system-snapshot estimate when no conversation is saved', () => {
  const analysis = createAnalysis()
  const tool = analysis.tools[0]
  assert.ok(tool)
  analysis.requests = []
  analysis.requestCount = 0
  analysis.requestExposure = { tokens: 0, knownTokens: 0, complete: true }
  analysis.latestRequestFootprintTokens = null
  tool.estimatedContextExposureTokens = 0
  tool.estimatedDefinitionExposureTokens = 0
  tool.estimatedPromptExposureTokens = 0
  analysis.toolInvocations = []

  const html = renderContextMeteringReport(analysis)
  const statistics = html.slice(html.indexOf('id="statistics-panel"'))

  assert.ok(statistics.includes('No model-ready conversation entries are available.'))
  assert.ok(
    statistics.includes(
      'The system-snapshot estimate covers tool definitions and prompt guidance. It is not included in the invocation total.',
    ),
  )
  assert.match(
    statistics,
    /<small>Baseline token spend \(system snapshot\)<\/small><strong class="[^"]*">2 tokens<\/strong>/,
  )
  assert.ok(statistics.includes('Estimated current-context exposure</dt><dd>0 tokens'))
})

test('should format visible numbers with European separators and two decimal places', () => {
  //given
  const analysis = createAnalysis()
  analysis.baseline.tokens = 12345.6789
  analysis.requestCount = 1234
  analysis.requestExposure = { tokens: 8, knownTokens: 8, complete: true }
  analysis.latestRequestFootprintTokens = 1234
  const request = analysis.requests.at(-1)
  assert.ok(request)
  request.footprintTokens = 1234
  analysis.sourceGroups = {
    systemPromptAndInstructionFiles: 1,
    toolDefinitionsAndPromptText: 7.1,
    toolCallsAndResults: 0,
    otherConversation: 0,
    unattributedContent: 0,
  }

  //when
  const html = renderContextMeteringReport(analysis)

  //then
  assert.ok(html.includes('12.345,68'))
  assert.ok(html.includes('1.234'))
  assert.ok(html.includes('1 token · 12,35%'))
})

test('should let entry estimate popovers escape open history rows and stack above later rows', () => {
  //given
  const analysis = createAnalysis()

  //when
  const html = renderContextMeteringReport(analysis)

  //then
  assert.ok(html.includes('<summary>Entry estimates</summary>'))
  assert.match(html, /\.entry\[open\]\{[^}]*overflow:visible/)
  assert.match(html, /\.entry\[open\]\{[^}]*z-index:\d+/)
  assert.match(html, /\.entry\[open\]:hover,\.entry\[open\]:focus-within\{z-index:\d+/)
})

test('should expose tab controls and touch-friendly details given keyboard and touch users', () => {
  //given
  const analysis = createAnalysis()

  //when
  const html = renderContextMeteringReport(analysis)

  //then
  assert.ok(html.includes('role="tablist"'))
  assert.ok(html.includes('href="#main-content">Skip to report content</a>'))
  assert.ok(html.includes('<main id="main-content" tabindex="-1">'))
  assert.ok(html.includes('role="tab"'))
  assert.ok(html.includes('aria-selected="true"'))
  assert.ok(html.includes('<details'))
  assert.ok(html.includes('<summary'))
  assert.ok(html.includes(':hover'))
  assert.ok(html.includes(':focus-within'))
  assert.ok(html.includes('.source-row:not([open]):hover>:not(summary)'))
  assert.ok(html.includes('.source-row:not([open]):focus-within>:not(summary)'))
  assert.ok(html.includes('addEventListener'))
  assert.ok(html.includes('ArrowRight'))
  assert.ok(html.includes('ArrowLeft'))
  assert.doesNotMatch(html, /panel\.focus/)
  assert.doesNotMatch(html, /<script\s+src=/i)
  assert.doesNotMatch(html, /<link\s+href=/i)
})

test('should show tool context text from the selected projection', () => {
  //given
  const analysis = createAnalysis()

  //when
  const html = renderContextMeteringReport(analysis)
  const contextStart = html.indexOf('<section class="tool-context-details">')
  const contextEnd = html.indexOf('<dl class="tool-total-metrics">', contextStart)
  const context = html.slice(contextStart, contextEnd)

  //then
  assert.ok(contextStart >= 0)
  assert.ok(context.includes('&lt;svg onload=alert(&quot;tool&quot;)&gt;'))
  assert.ok(context.includes('&quot;properties&quot;'))
  assert.ok(context.includes('<strong>Description</strong>'))
  assert.ok(context.includes('<strong>Schema</strong>'))
  assert.ok(context.includes('- shell: Run shell commands'))
  assert.ok(context.includes('Prompt guidance and examples · 1 token estimated in selected context'))
  assert.ok(html.includes('<details class="tool-definition-details">'))
  assert.ok(html.includes('<summary>Definition: shell · 1 token estimated in selected context</summary>'))
  assert.doesNotMatch(html, /\.table-wrap \.tool-definition \.popover\{/)
})

test('should list each projected tool interaction once', () => {
  //given
  const analysis = createAnalysis()
  const context = analysis.requests.at(-1)
  assert.ok(context)
  const interactionContributions = context.contributions.filter(
    (item) => item.toolCallId === 'call-1' && (item.kind === 'tool-call' || item.kind === 'tool-result'),
  )
  const interactionTokens = interactionContributions.reduce((total, item) => total + item.tokens, 0)

  //when
  const html = renderContextMeteringReport(analysis)
  const timelineStart = html.indexOf('<ol class="invocation-timeline"')
  const timeline = html.slice(timelineStart)

  //then
  assert.equal(interactionTokens, 2)
  assert.equal((timeline.match(/class="invocation-row"/g) ?? []).length, 1)
  assert.ok(timeline.includes('Selected-context interaction estimate: 2 tokens'))
  assert.ok(timeline.includes('&quot;command&quot;'))
  assert.ok(timeline.includes('result &amp; output'))
  assert.doesNotMatch(timeline, /Request \d|across \d+ requests/)
  assert.match(timeline, /<a href="#call-[^"]+">Open call input<\/a>/)
  assert.match(timeline, /<a href="#result-[^"]+">Open tool result<\/a>/)
})
