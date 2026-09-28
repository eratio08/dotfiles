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
    estimatedContextExposureTokens: 6,
    estimatedDefinitionExposureTokens: 2,
    estimatedPromptExposureTokens: 2,
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
    latestRequestFootprintTokens: 6,
    requestCount: 2,
    requestExposure: { tokens: 10, knownTokens: 10, complete: true },
    oneTimeMessageAdditionsTokens: 3,
    sourceGroups: {
      systemPromptAndInstructionFiles: 2,
      toolDefinitionsAndPromptText: 4,
      toolCallsAndResults: 2,
      otherConversation: 2,
      unattributedContent: 0,
    },
    sharedToolContextExposureTokens: 0,
    requests: [
      {
        index: 1,
        responseEntryId: 'assistant-1',
        timestamp: '2026-01-01T00:00:03.000Z',
        footprintTokens: 4,
        loadoutSource: 'saved',
        loadoutMessage: systemMessage,
        inputEntryIds: ['user-1'],
        knownTokens: 4,
        loadoutTokens: 3,
        conversationTokens: 1,
        contributions: contributions.slice(0, 4),
        providerUsage: providerUsage(),
        model: 'test-provider/test-model',
      },
      {
        index: 2,
        responseEntryId: 'assistant-2',
        timestamp: '2026-01-01T00:00:05.000Z',
        footprintTokens: 6,
        loadoutSource: 'saved',
        loadoutMessage: systemMessage,
        inputEntryIds: ['user-1', 'assistant-1', 'result-1'],
        knownTokens: 6,
        loadoutTokens: 3,
        conversationTokens: 3,
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
        latestRequestShare: 20,
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
        exposureShare: 20,
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
        effectiveMessages: [],
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
        effectiveMessages: [],
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
        exposureShare: 0,
        latestRequestIncluded: false,
        toolCallIds: [],
        rawMessages: [{ role: 'assistant', content: [{ type: 'text', text: 'done' }] }],
        effectiveMessages: [],
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
  const assistantMessage = callEntry.rawMessages.at(0)
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

test('should render compact context rows and nest tool results under calls given a selected branch', () => {
  //given
  const analysis = createAnalysis()

  //when
  const html = renderContextMeteringReport(analysis)
  const conversationStart = html.indexOf('id="conversation-panel"')
  const toolsStart = html.indexOf('id="statistics-panel"')
  const conversation = html.slice(conversationStart, toolsStart)

  //then
  assert.equal((conversation.match(/class="entry-summary"/g) ?? []).length, analysis.entries.length)
  assert.ok(conversation.includes('Request 2 input breakdown'))
  assert.ok(conversation.includes('16,67%'))
  assert.ok(conversation.includes('Not in latest input'))
  const callRowStart = conversation.indexOf('<details class="entry" id="entry-1">')
  const nestedResultsStart = conversation.indexOf('</details><ol class="nested-entry-list"', callRowStart)
  const resultRowStart = conversation.indexOf('<details class="entry" id="entry-2">', nestedResultsStart)
  assert.ok(callRowStart >= 0)
  assert.ok(nestedResultsStart > callRowStart)
  assert.ok(resultRowStart > nestedResultsStart)
})

test('should show latest request window use separately from cumulative tool exposure', () => {
  const analysis = createAnalysis()
  const tool = analysis.tools.at(0)
  assert.ok(tool)
  tool.estimatedContextExposureTokens = 2_349_578

  const html = renderContextMeteringReport(analysis, 24)
  const conversationStart = html.indexOf('id="conversation-panel"')
  const statisticsStart = html.indexOf('id="statistics-panel"')
  const conversation = html.slice(conversationStart, statisticsStart)
  const statistics = html.slice(statisticsStart)

  assert.ok(conversation.includes('Context window'))
  assert.ok(conversation.includes('25% of 24 tokens'))
  assert.match(conversation, /<meter[^>]+value="25"/)
  assert.ok(statistics.includes('Cumulative estimated context exposure across selected branch'))
  assert.ok(statistics.includes('2.349.578 tokens'))
})

test('should distinguish Pi context usage from the reconstructed request estimate', () => {
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
  assert.ok(conversation.includes('Reconstructed request estimate'))
  assert.ok(conversation.includes('43,81% of 272.000 tokens'))
})

test('should flag request estimates above the model context window', () => {
  const analysis = createAnalysis()
  const html = renderContextMeteringReport(analysis, 3)
  const conversationStart = html.indexOf('id="conversation-panel"')
  const statisticsStart = html.indexOf('id="statistics-panel"')
  const conversation = html.slice(conversationStart, statisticsStart)

  assert.ok(conversation.includes('200% of 3 tokens'))
  assert.match(conversation, /<meter[^>]+value="100"/)
  assert.ok(conversation.includes('The request estimate exceeds the model context window.'))
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
  assert.ok(tools.includes('Initial definition estimate'))
  assert.ok(tools.includes('Initial prompt estimate'))
  assert.ok(tools.includes('Initial tool-specific estimate'))
  assert.ok(tools.includes('Initial loadout sources'))
  assert.ok(tools.includes('Estimated context exposure across selected branch'))
  assert.ok(tools.includes('Arguments 7 tokens'))
  assert.ok(tools.includes('Results 4 tokens'))
  assert.ok(tools.includes('1 success · 1 failed'))
  assert.ok(tools.includes('1 with no result'))
  assert.ok(tools.includes('Invocation timeline'))
  assert.ok(tools.includes('<dt>Call text estimate</dt>'))
  assert.ok(tools.includes('2026-01-01T00:00:03.000Z'))
  assert.ok(tools.includes('Estimated exposure across 1 request'))
  assert.ok(tools.includes('&lt;/script&gt;'))
  assert.ok(tools.includes('result &amp; output'))
  assert.ok(tools.includes('Open call input'))
  assert.ok(tools.includes('Open tool result'))
  assert.ok(html.includes("window.addEventListener('hashchange', activateHashTarget)"))
})

test('should keep loadout sources and tool details in the tools view given a selected branch', () => {
  //given
  const analysis = createAnalysis()

  //when
  const html = renderContextMeteringReport(analysis)
  const conversationStart = html.indexOf('id="conversation-panel"')
  const toolsStart = html.indexOf('id="statistics-panel"')
  const conversation = html.slice(conversationStart, toolsStart)
  const tools = html.slice(toolsStart)
  const sourceStart = tools.indexOf('<h3>Initial loadout sources</h3>')
  const availableToolsStart = tools.indexOf('<h3>Available tools</h3>')
  const sources = tools.slice(sourceStart, availableToolsStart)

  //then
  assert.ok(sourceStart >= 0)
  assert.ok(availableToolsStart > sourceStart)
  assert.ok(conversation.includes('View tool details'))
  assert.doesNotMatch(conversation, /Initial system prompt and tool loadout/)
  assert.doesNotMatch(conversation, /Tool definition: shell/)
  assert.doesNotMatch(conversation, /Interaction estimates/)
  assert.doesNotMatch(conversation, /Tool prompt details/)
  assert.doesNotMatch(sources, /Tool definition: shell/)
  assert.ok(tools.includes('Initial loadout sources'))
  assert.ok(tools.includes('<details class="tool-definition-details">'))
  assert.ok(tools.includes('Estimated call and result exposure'))
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
  assert.ok(html.includes('2 tokens · 20%'))
  assert.ok(html.includes('Estimated tokens across all requests'))
  assert.ok(html.includes('Provider-reported usage'))
  assert.ok(html.includes('120 input tokens'))
  assert.ok(html.includes('Initial definition estimate'))
  assert.ok(html.includes('Initial loadout tokens'))
  assert.ok(html.includes('Latest request share'))
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
  const legendEntries = [...legendHtml.matchAll(/<span class="legend-value">([\d.,]+) tokens · ([\d.,]+)%<\/span>/g)]
  assert.deepEqual(
    legendEntries.map((entry) => Number(entry[1]?.replaceAll('.', '').replace(',', '.'))),
    values,
  )
  assert.deepEqual(
    legendEntries.map((entry) => Number(entry[2]?.replaceAll('.', '').replace(',', '.'))),
    values.map((tokens) => (tokens / total) * 100),
  )
  assert.equal(segmentLengths.length, values.filter((tokens) => tokens > 0).length)
  assert.ok(Math.abs(segmentLengths.reduce((sum, length) => sum + length, 0) - circumference) < 0.0001)
  assert.deepEqual(
    segmentLengths.map((length) => Number(((length / circumference) * 100).toFixed(5))),
    values.filter((tokens) => tokens > 0).map((tokens) => Number(((tokens / total) * 100).toFixed(5))),
  )
})

test('should show cumulative exposure and omit one-time interaction totals given a tool with calls', () => {
  //given
  const analysis = createAnalysis()

  //when
  const html = renderContextMeteringReport(analysis)
  const toolsStart = html.indexOf('id="statistics-panel"')
  const tools = html.slice(toolsStart)

  //then
  assert.ok(tools.includes('Initial definition estimate</dt><dd>1 token'))
  assert.ok(tools.includes('Arguments 1 token'))
  assert.ok(tools.includes('Results 1 token'))
  assert.ok(tools.includes('<dt>Estimated context exposure across selected branch</dt><dd>6 tokens</dd>'))
  assert.doesNotMatch(tools, /One-time interaction/)
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
  assert.doesNotMatch(html, /Effective loadout before request 2/)
})

test('should show tool prompt snippets separately given a saved tools section', () => {
  //given
  const analysis = createAnalysis()
  const userEntry = analysis.entries.at(0)
  const latestRequest = analysis.requests.at(-1)
  assert.ok(userEntry)
  assert.ok(latestRequest)
  analysis.entries.splice(1, 0, {
    ...userEntry,
    entryId: 'system-update',
    entryType: 'system',
    role: 'system',
    timestamp: '2026-01-01T00:00:02.500Z',
    contextStatus: 'current',
    messageAdditionTokens: 0,
    historicalTokens: 0,
    cumulativeRequestExposure: 0,
    exposureShare: 0,
    latestRequestIncluded: true,
    toolCallIds: [],
    rawMessages: [{ role: 'system', sections: { tools: '- shell: Run shell commands' } }],
    effectiveMessages: [],
  })
  latestRequest.inputEntryIds.push('system-update')

  //when
  const html = renderContextMeteringReport(analysis)

  //then
  assert.ok(html.includes('shell prompt snippet'))
  assert.ok(html.includes('- shell: Run shell commands'))
  assert.ok(html.includes('tool-prompt:shell'))
  assert.ok(html.includes('In loadout'))
  assert.ok(html.includes('loadout shown above'))
  const systemChangeStart = html.indexOf('Prompt section changed: tools')
  const systemChangeEnd = html.indexOf('</details>', systemChangeStart)
  const systemChange = html.slice(systemChangeStart, systemChangeEnd)
  assert.doesNotMatch(systemChange, /Cumulative request exposure/)
  assert.ok(systemChange.includes('Included in latest request.'))
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

test('should show initial tool costs and prompt examples for an unused tool', () => {
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

  //then
  assert.ok(statistics.includes('Initial tool-specific estimate'))
  assert.ok(statistics.includes('Initial definition estimate</dt><dd>1 token'))
  assert.ok(statistics.includes('Initial prompt estimate</dt><dd>1 token'))
  assert.ok(statistics.includes('Initial tool-specific estimate</dt><dd>2 tokens'))
  assert.ok(statistics.includes('Apply these usage guidelines.'))
  assert.ok(statistics.includes('Example: shell'))
  assert.ok(statistics.includes('0 calls'))
  assert.ok(statistics.includes('0 with no result'))
  assert.ok(statistics.includes('shell was available but no invocation was recorded on this branch.'))
  assert.ok(statistics.includes('Estimated context exposure across selected branch'))
})

test('should format visible numbers with European separators and two decimal places', () => {
  //given
  const analysis = createAnalysis()
  analysis.baseline.tokens = 12345.6789
  analysis.requestCount = 1234
  analysis.requestExposure = { tokens: 8, knownTokens: 8, complete: true }
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

test('should show saved tool context text and repeated impact given repeated loadouts', () => {
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
  assert.ok(context.includes('Prompt guidance and examples · 2 tokens estimated across 2 requests'))
  assert.ok(html.includes('<details class="tool-definition-details">'))
  assert.ok(html.includes('<summary>Definition: shell · 2 tokens estimated across 2 requests</summary>'))
  assert.doesNotMatch(html, /\.table-wrap \.tool-definition \.popover\{/)
})

test('should count repeated request impact without adding invocation rows given repeated call context', () => {
  //given
  const analysis = createAnalysis()
  const firstRequest = analysis.requests[0]
  const latestRequest = analysis.requests.at(-1)
  const tool = analysis.tools[0]
  assert.ok(firstRequest)
  assert.ok(latestRequest)
  assert.ok(tool)
  const repeatedContributions = latestRequest.contributions.filter(
    (item) => item.toolCallId === 'call-1' && (item.kind === 'tool-call' || item.kind === 'tool-result'),
  )
  const argumentTokens = repeatedContributions
    .filter((item) => item.kind === 'tool-call')
    .reduce((total, item) => total + item.tokens, 0)
  const resultTokens = repeatedContributions
    .filter((item) => item.kind === 'tool-result')
    .reduce((total, item) => total + item.tokens, 0)
  const repeatedTokens = argumentTokens + resultTokens
  firstRequest.contributions.push(...repeatedContributions)
  firstRequest.footprintTokens = (firstRequest.footprintTokens ?? 0) + repeatedTokens
  firstRequest.knownTokens += repeatedTokens
  firstRequest.conversationTokens += repeatedTokens
  analysis.requestExposure.tokens = (analysis.requestExposure.tokens ?? 0) + repeatedTokens
  analysis.requestExposure.knownTokens += repeatedTokens
  analysis.sourceGroups.toolCallsAndResults += repeatedTokens
  tool.estimatedContextExposureTokens += repeatedTokens
  tool.estimatedArgumentExposureTokens += argumentTokens
  tool.estimatedResultExposureTokens += resultTokens

  //when
  const html = renderContextMeteringReport(analysis)
  const timelineStart = html.indexOf('<ol class="invocation-timeline"')
  const timeline = html.slice(timelineStart)

  //then
  assert.ok(repeatedContributions.length > 0)
  assert.equal((timeline.match(/class="invocation-row"/g) ?? []).length, 1)
  assert.ok(timeline.includes('Estimated exposure across 2 requests'))
  assert.ok(timeline.includes('Request 1'))
  assert.ok(timeline.includes('Request 2'))
  assert.ok(timeline.includes('&quot;command&quot;'))
  assert.ok(timeline.includes('result &amp; output'))
  assert.match(timeline, /<a href="#call-[^"]+">Open call input<\/a>/)
  assert.match(timeline, /<a href="#result-[^"]+">Open tool result<\/a>/)
})
