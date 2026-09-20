import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import todoExtension from '../index.ts'
import { TodoUiError } from '../src/effects.ts'
import { extractLatestTodoSnapshot, TODO_STATE_ENTRY } from '../src/state.ts'

type EventHandler = (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown
type PlannotatorPhase = 'idle' | 'planning' | 'executing'
type StatusRequest = { respond: (response: unknown) => void }
type Renderable = { render: (width: number) => string[] }
type RenderCallContext = { argsComplete: boolean }
type RenderTheme = {
  fg: (color: string, text: string) => string
  bold: (text: string) => string
  strikethrough: (text: string) => string
}
type SentMessage = {
  message: {
    customType: string
    content: string
    display: boolean
    details?: { todos: unknown[] }
  }
  options?: { triggerTurn?: boolean; deliverAs?: 'steer' | 'followUp' | 'nextTurn' }
}

type ToolResult = {
  details: { todos?: unknown[]; error?: string }
}

type RegisteredTool = {
  name?: string
  execute: (...args: unknown[]) => Promise<ToolResult>
  renderCall?: (args: unknown, theme: unknown, context?: RenderCallContext) => Renderable
  renderResult?: (result: unknown, options: { expanded: boolean }, theme: unknown) => Renderable
}

type RegisteredCommand = {
  handler: (...args: unknown[]) => Promise<void>
}

type HarnessOptions = {
  customError?: unknown
  deferResponses?: boolean
  response?: unknown
  signal?: AbortSignal
}

function harness(branch: unknown[] = [], idle = true, phase?: PlannotatorPhase, options: HarnessOptions = {}) {
  const events = new Map<string, EventHandler>()
  const sentMessages: SentMessage[] = []
  const activeTools = ['read', 'todowrite', 'todonext', 'write']
  const widgets = new Map<string, string[] | undefined>()
  const notifications: string[] = []
  const sessionEntries = [...branch]
  const appendedEntries: unknown[] = []
  let registeredTodoTool: RegisteredTool | undefined
  let registeredNextTool: RegisteredTool | undefined
  let registeredCommand: RegisteredCommand | undefined
  let currentPhase = phase
  let hasResponseOverride = 'response' in options
  let responseOverride: unknown = options.response
  const pendingResponses: Array<{ request: StatusRequest; response: unknown }> = []

  const theme: RenderTheme = {
    fg(_color: string, text: string) {
      return text
    },
    bold(text: string) {
      return text
    },
    strikethrough(text: string) {
      return text
    },
  }
  const pi = {
    on(event: string, handler: EventHandler) {
      events.set(event, handler)
    },
    registerTool(tool: RegisteredTool) {
      if (tool.name === 'todonext') {
        registeredNextTool = tool
      } else {
        registeredTodoTool = tool
      }
    },
    appendEntry(customType: string, data: unknown) {
      const entry = {
        type: 'custom',
        id: `custom-${appendedEntries.length + 1}`,
        parentId: (sessionEntries.at(-1) as { id?: string } | undefined)?.id ?? null,
        timestamp: new Date().toISOString(),
        customType,
        data,
      }
      sessionEntries.push(entry)
      appendedEntries.push(entry)
    },
    registerCommand(_name: string, command: RegisteredCommand) {
      registeredCommand = command
    },
    sendMessage(message: SentMessage['message'], options: SentMessage['options']) {
      sentMessages.push({ message, options })
    },
    getActiveTools() {
      return [...activeTools]
    },
    setActiveTools(next: string[]) {
      activeTools.splice(0, activeTools.length, ...next)
    },
    events: {
      emit(channel: string, data: StatusRequest) {
        if (channel !== 'plannotator:request' || (!currentPhase && !hasResponseOverride)) {
          return
        }
        const response = hasResponseOverride ? responseOverride : { status: 'handled', result: { phase: currentPhase } }
        if (options.deferResponses) {
          pendingResponses.push({ request: data, response })
        } else {
          data.respond(response)
        }
      },
      on() {
        return () => {}
      },
    },
  } as unknown as ExtensionAPI
  const ctx = {
    hasUI: true,
    mode: 'tui',
    ui: {
      theme,
      setWidget(key: string, content: string[] | undefined) {
        widgets.set(key, content)
      },
      notify(message: string) {
        notifications.push(message)
      },
      async custom() {
        if (options.customError !== undefined) {
          throw options.customError
        }
        return undefined
      },
    },
    isIdle() {
      return idle
    },
    sessionManager: {
      getBranch() {
        return sessionEntries
      },
    },
    signal: options.signal,
  } as unknown as ExtensionContext

  todoExtension(pi)

  return {
    ctx,
    events,
    sentMessages,
    activeTools,
    widgets,
    notifications,
    get registeredTool() {
      return registeredTodoTool
    },
    get nextTool() {
      return registeredNextTool
    },
    appendedEntries,
    get registeredCommand() {
      return registeredCommand
    },
    setPhase(next: PlannotatorPhase | undefined) {
      currentPhase = next
    },
    setStatusResponse(response: unknown) {
      responseOverride = response
      hasResponseOverride = true
    },
    flushStatusResponses() {
      const responses = pendingResponses.splice(0)
      for (const pending of responses) {
        pending.request.respond(pending.response)
      }
    },
    theme,
  }
}

const branchWithTodos = [
  {
    type: 'custom',
    customType: TODO_STATE_ENTRY,
    data: {
      todos: [
        {
          id: '018f00000000-7000-8000-0000-000000000001',
          content: 'first task',
          status: 'in_progress',
          dependsOn: [],
        },
        { id: '018f00000001-7000-8000-0000-000000000002', content: 'second task', status: 'pending', dependsOn: [] },
      ],
    },
  },
]

async function waitForTimers(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function restoreTodos(harnessValue: ReturnType<typeof harness>) {
  const sessionStart = harnessValue.events.get('session_start')
  assert.ok(sessionStart)
  await sessionStart({ type: 'session_start', reason: 'startup' }, harnessValue.ctx)
  await waitForTimers()
}

function compactionEvent(willRetry: boolean, reason: 'manual' | 'threshold' | 'overflow') {
  return {
    type: 'session_compact',
    compactionEntry: { id: 'compaction-1' },
    fromExtension: false,
    reason,
    willRetry,
  }
}

function approvedPlanResult(approved = true) {
  return {
    type: 'tool_result',
    toolCallId: 'plan-call',
    toolName: 'plannotator_submit_plan',
    input: { filePath: 'PLAN.md' },
    content: [],
    isError: !approved,
    details: { approved },
  }
}

test('persists each accepted todo snapshot in the session store', async () => {
  //given
  const value = harness([], true)
  const todoTool = value.registeredTool
  assert.ok(todoTool)

  //when
  const result = await todoTool.execute(
    'todo-call',
    { operation: 'replace', todos: [{ content: 'new task', dependsOn: [] }] },
    undefined,
    undefined,
    value.ctx,
  )

  //then
  assert.equal(result.details.error, undefined)
  assert.equal(value.appendedEntries.length, 1)
  assert.equal((value.appendedEntries[0] as { customType: string }).customType, TODO_STATE_ENTRY)
  assert.deepEqual((value.appendedEntries[0] as { data: { todos: unknown[] } }).data.todos, result.details.todos)
  assert.deepEqual(value.sentMessages, [])
})

test('todonext returns the active task without mutating the session store', async () => {
  //given
  const value = harness(branchWithTodos, true)
  await restoreTodos(value)
  const nextTool = value.nextTool
  assert.ok(nextTool)

  //when
  const result = await nextTool.execute('next-call', {}, undefined, undefined, value.ctx)

  //then
  const details = result.details as {
    status: string
    todo?: { content: string }
    waiting: unknown[]
    blocked: unknown[]
  }
  assert.equal(details.status, 'active')
  assert.equal(details.todo?.content, 'first task')
  assert.deepEqual(details.waiting, [])
  assert.deepEqual(details.blocked, [])
  assert.deepEqual(value.appendedEntries, [])
  assert.deepEqual(value.sentMessages, [])
})

test('todonext starts the first ready task when none is active', async () => {
  //given
  const value = harness([
    {
      type: 'custom',
      customType: TODO_STATE_ENTRY,
      data: {
        todos: [
          {
            id: '018f00000000-7000-8000-0000-000000000001',
            content: 'ready task',
            status: 'pending',
            dependsOn: [],
          },
        ],
      },
    },
  ])
  await restoreTodos(value)
  const nextTool = value.nextTool
  assert.ok(nextTool)

  //when
  const result = await nextTool.execute('next-call', {}, undefined, undefined, value.ctx)

  //then
  const details = result.details as { status: string; todo?: { content: string } }
  assert.equal(details.status, 'started')
  assert.equal(details.todo?.content, 'ready task')
  assert.equal(value.appendedEntries.length, 1)
  assert.equal(
    (value.appendedEntries[0] as { data: { todos: Array<{ status: string }> } }).data.todos[0]?.status,
    'in_progress',
  )
})

test('todonext reports waiting and blocked tasks when no task is ready', async () => {
  //given
  const value = harness([
    {
      type: 'custom',
      customType: TODO_STATE_ENTRY,
      data: {
        todos: [
          {
            id: '018f00000000-7000-8000-0000-000000000001',
            content: 'waiting task',
            status: 'pending',
            dependsOn: ['018f00000001-7000-8000-0000-000000000002'],
          },
          {
            id: '018f00000001-7000-8000-0000-000000000002',
            content: 'blocked task',
            status: 'blocked',
            dependsOn: [],
          },
        ],
      },
    },
  ])
  await restoreTodos(value)
  const nextTool = value.nextTool
  assert.ok(nextTool)

  //when
  const result = await nextTool.execute('next-call', {}, undefined, undefined, value.ctx)

  //then
  const details = result.details as {
    status: string
    waiting: Array<{ content: string }>
    blocked: Array<{ content: string }>
  }
  assert.equal(details.status, 'none')
  assert.deepEqual(
    details.waiting.map((todo) => todo.content),
    ['waiting task'],
  )
  assert.deepEqual(
    details.blocked.map((todo) => todo.content),
    ['blocked task'],
  )
})

test('adds one hidden snapshot after idle manual compaction without starting a turn', async () => {
  const value = harness(branchWithTodos, true)
  await restoreTodos(value)

  assert.equal(value.events.has('context'), false)
  const sessionCompact = value.events.get('session_compact')
  assert.ok(sessionCompact)
  await sessionCompact(compactionEvent(false, 'manual'), value.ctx)

  assert.equal(value.sentMessages.length, 1)
  assert.equal(value.sentMessages[0]?.options?.triggerTurn, false)
  assert.equal(value.sentMessages[0]?.message.customType, 'todo')
  assert.equal(value.sentMessages[0]?.message.display, false)
  assert.match(value.sentMessages[0]?.message.content ?? '', /first task/)
  assert.match(value.sentMessages[0]?.message.content ?? '', /in_progress/)
  assert.doesNotMatch(value.sentMessages[0]?.message.content ?? '', /018f00000000-7000-8000-0000-000000000001/)
  assert.doesNotMatch(value.sentMessages[0]?.message.content ?? '', /second task/)
  assert.match(value.sentMessages[0]?.message.content ?? '', /1 more open task remain after this one/)
  assert.match(value.sentMessages[0]?.message.content ?? '', /todonext/)
})

test('persists compaction snapshot for later restoration', async () => {
  //given
  const value = harness(branchWithTodos, true)
  await restoreTodos(value)
  const sessionCompact = value.events.get('session_compact')
  assert.ok(sessionCompact)

  //when
  await sessionCompact(compactionEvent(false, 'manual'), value.ctx)

  //then
  const message = value.sentMessages[0]?.message
  assert.ok(message)
  const entry = value.appendedEntries[0]
  assert.ok(entry)
  assert.equal((entry as { customType: string }).customType, TODO_STATE_ENTRY)
  assert.deepEqual(extractLatestTodoSnapshot([entry]), branchWithTodos[0].data.todos)

  const restored = harness([entry], true)
  await restoreTodos(restored)
  const result = await restored.registeredTool?.execute(
    'todo-call',
    { operation: 'replace', todos: [] },
    undefined,
    undefined,
    restored.ctx,
  )
  assert.ok(result)
  assert.deepEqual(result.details.todos, branchWithTodos[0].data.todos)
})

test('queues one snapshot for the next prompt after active threshold compaction', async () => {
  const value = harness(branchWithTodos, false)
  await restoreTodos(value)

  const sessionCompact = value.events.get('session_compact')
  assert.ok(sessionCompact)
  await sessionCompact(compactionEvent(false, 'threshold'), value.ctx)

  assert.deepEqual(value.sentMessages[0]?.options, { deliverAs: 'nextTurn' })
})

test('steers one snapshot into overflow recovery', async () => {
  const value = harness(branchWithTodos, false)
  await restoreTodos(value)

  const sessionCompact = value.events.get('session_compact')
  assert.ok(sessionCompact)
  await sessionCompact(compactionEvent(true, 'overflow'), value.ctx)

  assert.deepEqual(value.sentMessages[0]?.options, { deliverAs: 'steer' })
})

test('does not send a snapshot when no todos are restored', async () => {
  const value = harness([], true)
  const sessionCompact = value.events.get('session_compact')
  assert.ok(sessionCompact)
  await sessionCompact(compactionEvent(false, 'threshold'), value.ctx)

  assert.deepEqual(value.sentMessages, [])
})

test('restores durable handoff todos when a later hidden message has no details', async () => {
  //given
  const value = harness(
    [
      ...branchWithTodos,
      {
        type: 'custom_message',
        customType: 'todo',
        content: 'TODO STATUS\nHidden handoff context',
        display: false,
      },
    ],
    true,
  )
  const beforeAgentStart = value.events.get('before_agent_start')
  assert.ok(beforeAgentStart)
  await beforeAgentStart({ type: 'before_agent_start' }, value.ctx)
  const nextTool = value.nextTool
  assert.ok(nextTool)

  //when
  const result = await nextTool.execute('next-call', {}, undefined, undefined, value.ctx)

  //then
  const details = result.details as { status: string; todo?: { content: string } }
  assert.equal(details.status, 'active')
  assert.equal(details.todo?.content, 'first task')
})

test('does not restore Todo state from hidden message details', async () => {
  const value = harness(
    [
      {
        type: 'custom_message',
        customType: 'todo',
        details: {
          todos: [
            {
              id: '018f00000000-7000-8000-0000-000000000001',
              content: 'legacy active',
              status: 'in_progress',
              dependsOn: [],
            },
          ],
        },
      },
    ],
    true,
  )

  const beforeAgentStart = value.events.get('before_agent_start')
  assert.ok(beforeAgentStart)
  await beforeAgentStart({ type: 'before_agent_start' }, value.ctx)

  const result = await value.registeredTool?.execute(
    'todo-call',
    {
      operation: 'complete_task',
    },
    undefined,
    undefined,
    value.ctx,
  )
  assert.ok(result)
  assert.match(result.details.error ?? '', /No active task/)
})

test('keeps local tracking enabled during planning', async () => {
  const value = harness(branchWithTodos, true, 'planning')
  await restoreTodos(value)

  assert.ok(value.activeTools.includes('todowrite'))
  assert.notEqual(value.widgets.get('todo'), undefined)
})

test('suspends local tracking after automatic plan approval', async () => {
  const value = harness(branchWithTodos, true, 'planning')
  await restoreTodos(value)
  value.setPhase('executing')

  const toolResult = value.events.get('tool_result')
  assert.ok(toolResult)
  await toolResult(approvedPlanResult(), value.ctx)

  assert.equal(value.activeTools.includes('todowrite'), false)
  assert.equal(value.widgets.get('todo'), undefined)

  const sessionCompact = value.events.get('session_compact')
  assert.ok(sessionCompact)
  await sessionCompact(compactionEvent(false, 'manual'), value.ctx)
  assert.equal(value.sentMessages.length, 0)

  const result = await value.registeredTool?.execute(
    'todo-call',
    { operation: 'replace', todos: [{ content: 'new', dependsOn: [] }] },
    undefined,
    undefined,
    value.ctx,
  )
  assert.ok(result)
  assert.equal(result.details.error, 'Todo tracking is disabled while Plannotator executes the approved plan.')
})

test('does not suspend local tracking for denied or external approval', async () => {
  const denied = harness(branchWithTodos, true, 'planning')
  await restoreTodos(denied)
  const deniedResult = denied.events.get('tool_result')
  assert.ok(deniedResult)
  await deniedResult(approvedPlanResult(false), denied.ctx)
  assert.ok(denied.activeTools.includes('todowrite'))

  const external = harness(branchWithTodos, true, 'idle')
  await restoreTodos(external)
  const externalResult = external.events.get('tool_result')
  assert.ok(externalResult)
  await externalResult(approvedPlanResult(), external.ctx)
  assert.ok(external.activeTools.includes('todowrite'))
})

test('restores local tracking when Plannotator returns to idle', async () => {
  const value = harness(branchWithTodos, true, 'executing')
  await restoreTodos(value)
  assert.equal(value.activeTools.includes('todowrite'), false)

  value.setPhase('idle')
  const input = value.events.get('input')
  assert.ok(input)
  await input({ type: 'input', text: 'continue' }, value.ctx)

  assert.ok(value.activeTools.includes('todowrite'))
  assert.notEqual(value.widgets.get('todo'), undefined)
})

test('rejects /todos while suspended and allows it after idle', async () => {
  const value = harness(branchWithTodos, true, 'executing')
  await restoreTodos(value)
  const command = value.registeredCommand?.handler
  assert.ok(command)

  await command('', value.ctx)
  assert.match(value.notifications[0] ?? '', /disabled while Plannotator/)

  value.setPhase('idle')
  await command('', value.ctx)
  assert.equal(value.notifications.length, 1)
})

test('reports UI failures as typed errors', async () => {
  //given
  const value = harness(branchWithTodos, true, 'idle', { customError: new Error('viewer failed') })
  await restoreTodos(value)
  const command = value.registeredCommand?.handler
  assert.ok(command)

  //when
  const pending = command('', value.ctx)

  //then
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof TodoUiError)
    assert.equal(error.operation, 'show')
    assert.equal(error.message, 'Error: viewer failed')
    return true
  })
})

test('leaves tracking unchanged when Plannotator status is unavailable', async () => {
  const value = harness(branchWithTodos, true, 'executing', {
    response: { status: 'unavailable', error: 42 },
  })
  await restoreTodos(value)
  const toolResult = value.events.get('tool_result')
  assert.ok(toolResult)
  await toolResult(approvedPlanResult(), value.ctx)

  assert.ok(value.activeTools.includes('todowrite'))
  assert.notEqual(value.widgets.get('todo'), undefined)
})

test('ignores invalid Plannotator status responses', async () => {
  //given
  const value = harness(branchWithTodos, true, 'planning', {
    response: { status: 'handled', result: { phase: 'invalid' } },
  })
  await restoreTodos(value)
  const input = value.events.get('input')
  assert.ok(input)

  //when
  await input({ type: 'input', text: 'continue' }, value.ctx)

  //then
  assert.ok(value.activeTools.includes('todowrite'))
  assert.notEqual(value.widgets.get('todo'), undefined)
})

test('ignores stale Plannotator status responses', async () => {
  //given
  const value = harness(branchWithTodos, true, 'executing', { deferResponses: true })
  const input = value.events.get('input')
  assert.ok(input)
  const first = input({ type: 'input', text: 'first' }, value.ctx)
  value.setStatusResponse({ status: 'unavailable', error: 'not connected' })
  const second = input({ type: 'input', text: 'second' }, value.ctx)

  //when
  value.flushStatusResponses()

  //then
  await Promise.all([first, second])
  assert.ok(value.activeTools.includes('todowrite'))
})

test('cancels a pending Plannotator status request', async () => {
  //given
  const controller = new AbortController()
  const value = harness([], true, undefined, { signal: controller.signal })
  const input = value.events.get('input')
  assert.ok(input)
  const pending = Promise.resolve(input({ type: 'input', text: 'cancel' }, value.ctx))

  //when
  controller.abort()

  //then
  await assert.rejects(pending)
})

test('does not render zero count while todowrite arguments are incomplete', () => {
  //given
  const value = harness()
  const renderCall = value.registeredTool?.renderCall
  assert.ok(renderCall)

  //when
  const rendered = renderCall({}, value.theme, { argsComplete: false })

  //then
  assert.doesNotMatch(rendered.render(120).join('\n'), /0 items/)
})

test('renders collapsed todo results with open items', () => {
  //given
  const value = harness()
  const renderResult = value.registeredTool?.renderResult
  assert.ok(renderResult)
  const result = {
    content: [],
    details: {
      todos: [
        {
          id: '018f00000000-7000-8000-0000-000000000001',
          content: 'active task',
          status: 'in_progress',
          dependsOn: [],
          description: 'active details',
        },
        {
          id: '018f00000001-7000-8000-0000-000000000002',
          content: 'finished task',
          status: 'completed',
          dependsOn: [],
          description: 'finished details',
        },
      ],
    },
  }

  //when
  const rendered = renderResult(result, { expanded: false }, value.theme)

  //then
  const text = rendered.render(120).join('\n')
  assert.match(text, /active task/)
  assert.doesNotMatch(text, /018f00000000-7000-8000-0000-000000000001/)
  assert.doesNotMatch(text, /finished task/)
  assert.doesNotMatch(text, /active details/)
})

test('renders expanded todo results with descriptions', () => {
  //given
  const value = harness()
  const renderResult = value.registeredTool?.renderResult
  assert.ok(renderResult)
  const result = {
    content: [],
    details: {
      todos: [
        {
          id: '018f00000000-7000-8000-0000-000000000001',
          content: 'active task',
          status: 'in_progress',
          dependsOn: [],
          description: 'active details',
        },
        {
          id: '018f00000001-7000-8000-0000-000000000002',
          content: 'finished task',
          status: 'completed',
          dependsOn: [],
          description: 'finished details',
        },
      ],
    },
  }

  //when
  const rendered = renderResult(result, { expanded: true }, value.theme)

  //then
  const text = rendered.render(120).join('\n')
  assert.match(text, /active task/)
  assert.doesNotMatch(text, /018f00000000-7000-8000-0000-000000000001/)
  assert.match(text, /finished task/)
  assert.match(text, /active details/)
  assert.match(text, /finished details/)
})
