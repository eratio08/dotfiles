import assert from 'node:assert/strict'
import test from 'node:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import { PiToolError } from '@eratio/pi-effect'
import todoExtension from '../index.ts'
import type { Todo } from '../src/extension.ts'
import { extractLatestTodoSnapshot, TODO_STATE_ENTRY, TodoUiError } from '../src/extension.ts'

type EventHandler = (event: unknown, ctx: unknown) => Promise<unknown> | unknown
type Renderable = { render: (width: number) => string[] }
type Theme = {
  fg: (color: string, text: string) => string
  bold: (text: string) => string
  strikethrough: (text: string) => string
}
type SentMessage = {
  message: { customType: string; content: string; display: boolean }
  options?: { triggerTurn?: boolean; deliverAs?: 'steer' | 'nextTurn' }
}
type RegisteredTool = {
  name?: string
  execute: (...args: unknown[]) => Promise<unknown>
}
type TodoToolResult<T = unknown> = { readonly structuredContent: T }
type RegisteredCommand = { handler: (...args: unknown[]) => Promise<void> }
type Phase = 'idle' | 'planning' | 'executing'
type FailureOperation = 'appendEntry' | 'sendMessage' | 'getBranch' | 'getToolsExpanded' | 'notify' | 'isIdle' | 'emit'
type HarnessOptions = {
  customError?: unknown
  phase?: Phase
  phaseResponses?: Array<{ phase: Phase; delayMs?: number }>
  failure?: { operation: FailureOperation; error: Error }
  toolsExpanded?: boolean
}

type Harness = {
  ready: Promise<unknown>
  ctx: Record<string, unknown>
  events: Map<string, EventHandler>
  sentMessages: SentMessage[]
  widgets: Map<string, string[] | undefined>
  notifications: string[]
  notificationLevels: Array<string | undefined>
  customView: () => Renderable | undefined
  appendedEntries: unknown[]
  theme: Theme
  readonly registeredTool: RegisteredTool | undefined
  registeredToolByName(name: string): RegisteredTool | undefined
  registeredCommand(name: string): RegisteredCommand | undefined
  setToolsExpanded(expanded: boolean): void
  setPhase(next: Phase | undefined): void
  replaceBranch(next: readonly unknown[]): void
}

function harness(branch: unknown[] = [], idle = true, options: HarnessOptions = {}): Harness {
  const events = new Map<string, EventHandler>()
  const sentMessages: SentMessage[] = []
  const widgets = new Map<string, string[] | undefined>()
  const notifications: string[] = []
  const notificationLevels: Array<string | undefined> = []
  let customView: Renderable | undefined
  const sessionEntries = [...branch]
  const appendedEntries: unknown[] = []
  const registeredTools = new Map<string, RegisteredTool>()
  const registeredCommands = new Map<string, RegisteredCommand>()
  let phase = options.phase
  const phaseResponses = [...(options.phaseResponses ?? [])]
  const fail = (operation: FailureOperation): void => {
    if (options.failure?.operation === operation) throw options.failure.error
  }
  const theme: Theme = {
    fg: (_color: string, text: string): string => text,
    bold: (text: string): string => text,
    strikethrough: (text: string): string => text,
  }
  const keybindings = {
    matches: (): boolean => false,
    getKeys: (): string[] => ['escape', 'ctrl+c'],
  }
  const pi = {
    on(event: string, handler: EventHandler): void {
      events.set(event, handler)
    },
    registerTool(tool: RegisteredTool): void {
      if (tool.name) registeredTools.set(tool.name, tool)
    },
    appendEntry(customType: string, data: unknown): void {
      fail('appendEntry')
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
    registerCommand(name: string, command: RegisteredCommand): void {
      registeredCommands.set(name, command)
    },
    sendMessage(message: SentMessage['message'], options: SentMessage['options']): void {
      fail('sendMessage')
      sentMessages.push({ message, options })
    },
    getActiveTools(): string[] {
      return []
    },
    setActiveTools(): void {},
    events: {
      emit(channel: string, request: { respond: (response: unknown) => void }): void {
        fail('emit')
        if (channel !== 'plannotator:request') return
        const response = phaseResponses.shift()
        const responsePhase = response?.phase ?? phase
        if (!responsePhase) return
        const respond = (): void => request.respond({ status: 'handled', result: { phase: responsePhase } })
        if (response?.delayMs === undefined) respond()
        else setTimeout(respond, response.delayMs)
      },
    },
  }
  const ctx = {
    cwd: '/tmp',
    hasUI: true,
    mode: 'tui',
    ui: {
      theme,
      setWidget(key: string, content: string[] | undefined): void {
        widgets.set(key, content)
      },
      notify(message: string, level?: string): void {
        fail('notify')
        notifications.push(message)
        notificationLevels.push(level)
      },
      getToolsExpanded(): boolean {
        fail('getToolsExpanded')
        return options.toolsExpanded ?? false
      },
      async custom(
        factory: (tui: unknown, theme: Theme, keybindings: unknown, done: () => void) => unknown,
      ): Promise<undefined> {
        if (options.customError !== undefined) throw options.customError
        customView = factory(undefined, theme, keybindings, () => {}) as Renderable
        return undefined
      },
    },
    isIdle: (): boolean => {
      fail('isIdle')
      return idle
    },
    sessionManager: {
      getCwd: (): string => '/tmp',
      getSessionId: (): string => 'test-session',
      getSessionFile: (): undefined => undefined,
      getSessionDir: (): string => '/tmp',
      getLeafId: (): null => null,
      getLeafEntry: (): undefined => undefined,
      getEntries: (): unknown[] => sessionEntries,
      getTree: (): unknown[] => [],
      getEntry: (): undefined => undefined,
      getBranch: (): unknown[] => {
        fail('getBranch')
        return sessionEntries
      },
      buildContextEntries: (): unknown[] => [],
      getLabel: (): undefined => undefined,
      getSessionName: (): undefined => undefined,
    },
    signal: undefined,
  }

  const ready = Promise.resolve(todoExtension(pi as never))

  return {
    ready,
    ctx,
    events,
    sentMessages,
    widgets,
    notifications,
    notificationLevels,
    customView: (): Renderable | undefined => customView,
    appendedEntries,
    theme,
    get registeredTool(): RegisteredTool | undefined {
      return registeredTools.get('todo_show')
    },
    registeredToolByName(name: string): RegisteredTool | undefined {
      return registeredTools.get(name)
    },
    registeredCommand(name: string): RegisteredCommand | undefined {
      return registeredCommands.get(name)
    },
    setToolsExpanded(expanded: boolean): void {
      options.toolsExpanded = expanded
    },
    setPhase(next: Phase | undefined): void {
      phase = next
    },
    replaceBranch(next: readonly unknown[]): void {
      sessionEntries.splice(0, sessionEntries.length, ...next)
    },
  }
}

const firstId = '018f0000-0000-7000-8000-000000000001'
const secondId = '018f0000-0001-7000-8000-000000000002'
const branchWithTodos: {
  type: 'custom'
  customType: typeof TODO_STATE_ENTRY
  data: { todos: Todo[] }
}[] = [
  {
    type: 'custom',
    customType: TODO_STATE_ENTRY,
    data: {
      todos: [
        { id: firstId, content: 'first task', status: 'pending', dependsOn: [] },
        { id: secondId, content: 'second task', status: 'blocked', dependsOn: [firstId] },
      ],
    },
  },
]

async function waitForTimers(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function restoreTodos(value: ReturnType<typeof harness>): Promise<void> {
  await value.ready
  const handler = value.events.get('session_start')
  assert.ok(handler)
  await handler({ type: 'session_start' }, value.ctx)
  await waitForTimers()
}

async function executeTodoTool(
  value: Harness,
  name: string,
  params: unknown = {},
  signal?: AbortSignal,
): Promise<unknown> {
  const tool = value.registeredToolByName(name)
  assert.ok(tool)
  return tool.execute(`${name}-call`, params, signal, undefined, value.ctx)
}

test('should suspend Todo tool calls given an approved plan submission', async () => {
  //given
  const value = harness([], true, { phase: 'executing' })
  await value.ready
  const handler = value.events.get('tool_result')
  assert.ok(handler)

  //when
  await handler({ toolName: 'plannotator_submit_plan', details: { approved: true, plan: 'accepted' } }, value.ctx)

  //then
  await assert.rejects(executeTodoTool(value, 'todo_show'), /disabled while Plannotator/)
})

const rejectedPlanResults = [
  {
    name: 'approval is false',
    event: { toolName: 'plannotator_submit_plan', details: { approved: false } },
  },
  {
    name: 'approval is missing',
    event: { toolName: 'plannotator_submit_plan', details: {} },
  },
  {
    name: 'details are null',
    event: { toolName: 'plannotator_submit_plan', details: null },
  },
  {
    name: 'approval has the wrong type',
    event: { toolName: 'plannotator_submit_plan', details: { approved: 'true' } },
  },
  {
    name: 'the tool name does not match',
    event: { toolName: 'other', details: { approved: true } },
  },
  {
    name: 'the result is an error',
    event: { toolName: 'plannotator_submit_plan', isError: true, details: { approved: true } },
  },
]

for (const { name, event } of rejectedPlanResults) {
  test(`should keep todo tracking active given ${name}`, async () => {
    //given
    const value = harness([], true, { phase: 'executing' })
    await value.ready
    const handler = value.events.get('tool_result')
    assert.ok(handler)

    //when
    await handler(event, value.ctx)

    //then
    const result = await executeTodoTool(value, 'todo_show')
    assert.deepEqual((result as TodoToolResult<Todo[]>).structuredContent, [])
  })
}

test('should preserve the live plan given a malformed historical snapshot during tree navigation', async () => {
  //given
  const value = harness(branchWithTodos, true)
  await restoreTodos(value)
  value.replaceBranch([
    {
      type: 'custom',
      customType: TODO_STATE_ENTRY,
      data: { todos: 'malformed' },
    },
  ])
  const branchChange = value.events.get('session_tree')
  assert.ok(branchChange)

  //when
  await branchChange(
    { type: 'session_tree', summaryEntry: { type: 'branch_summary', summary: 'summary of the branch' } },
    value.ctx,
  )

  //then
  const tool = value.registeredTool
  assert.ok(tool)
  const result = await tool.execute(
    'todo-call',
    { status: ['pending', 'in_progress', 'completed', 'omitted', 'blocked'] },
    undefined,
    undefined,
    value.ctx,
  )
  assert.deepEqual(
    (result as TodoToolResult<Todo[]>).structuredContent.map(({ content, status }) => ({ content, status })),
    [
      { content: 'first task', status: 'pending' },
      { content: 'second task', status: 'blocked' },
    ],
  )
  assert.deepEqual(
    extractLatestTodoSnapshot(value.appendedEntries).map(({ content, status }) => ({ content, status })),
    [
      { content: 'first task', status: 'pending' },
      { content: 'second task', status: 'blocked' },
    ],
  )
  assert.equal(value.sentMessages.length, 1)
  const message = value.sentMessages[0]?.message
  assert.ok(message)
  assert.equal(message.display, false)
  assert.equal(value.sentMessages[0]?.options?.triggerTurn, false)
  assert.match(message.content, /first task/)
  assert.match(message.content, /Tasks: 2 remaining, 1 blocked, 0 complete, 0 omitted\./)
  assert.notEqual(value.widgets.get('todo'), undefined)
})

test('should not append a snapshot or refresh the widget given a read-only program', async () => {
  //given
  const value = harness(branchWithTodos, true)
  await restoreTodos(value)
  const tool = value.registeredTool
  assert.ok(tool)
  const widget = value.widgets.get('todo')

  //when
  const result = await tool.execute('todo-call', {}, undefined, undefined, value.ctx)

  //then
  assert.deepEqual(
    (result as TodoToolResult<Todo[]>).structuredContent.map(({ content }) => content),
    ['first task'],
  )
  assert.deepEqual(value.appendedEntries, [])
  assert.equal(value.widgets.get('todo'), widget)
})

test('should restore and send the durable snapshot given compaction', async () => {
  //given
  const value = harness(branchWithTodos, true)
  await restoreTodos(value)
  const compact = value.events.get('session_compact')
  assert.ok(compact)

  //when
  await compact({ type: 'session_compact', willRetry: false }, value.ctx)

  //then
  assert.equal(value.appendedEntries.length, 1)
  assert.deepEqual(extractLatestTodoSnapshot(value.appendedEntries), branchWithTodos[0]?.data.todos)
  assert.equal(value.sentMessages.length, 1)
  assert.equal(value.sentMessages[0]?.options?.triggerTurn, false)
  const message = value.sentMessages[0]?.message
  assert.ok(message)
  assert.match(message.content, /first task/)
  assert.doesNotMatch(message.content, /second task/)
  assert.equal(Object.hasOwn(message, 'details'), false)
})

test('should keep completed task states in the durable snapshot given compaction', async () => {
  //given
  const value = harness(
    [
      {
        type: 'custom',
        customType: TODO_STATE_ENTRY,
        data: {
          todos: [
            { id: firstId, content: 'finished task', status: 'completed', dependsOn: [] },
            { id: secondId, content: 'current task', status: 'in_progress', dependsOn: [firstId] },
          ],
        },
      },
    ],
    true,
  )
  await restoreTodos(value)
  const compact = value.events.get('session_compact')
  assert.ok(compact)

  //when
  await compact({ type: 'session_compact', willRetry: false }, value.ctx)

  //then
  const snapshot = extractLatestTodoSnapshot(value.appendedEntries)
  assert.deepEqual(
    snapshot.map((todo) => todo.content),
    ['finished task', 'current task'],
  )
  const message = value.sentMessages[0]?.message
  assert.ok(message)
  assert.match(message.content, /current task/)
  assert.doesNotMatch(message.content, /finished task/)
  assert.match(message.content, /Tasks: 1 remaining, 0 blocked, 1 complete, 0 omitted\./)
  assert.doesNotMatch(message.content, /status=/)
  assert.equal(Object.hasOwn(message, 'details'), false)
})

test('should restore the latest valid plan given session startup', async () => {
  //given
  const value = harness(
    [
      {
        type: 'custom',
        customType: TODO_STATE_ENTRY,
        data: { todos: [{ id: firstId, content: 'older task', status: 'pending', dependsOn: [] }] },
      },
      {
        type: 'custom',
        customType: TODO_STATE_ENTRY,
        data: { todos: [{ id: secondId, content: 'latest task', status: 'in_progress', dependsOn: [] }] },
      },
      { type: 'custom', customType: TODO_STATE_ENTRY, data: { todos: 'invalid' } },
    ],
    true,
  )
  await value.ready
  const sessionStart = value.events.get('session_start')
  const tool = value.registeredTool
  assert.ok(sessionStart)
  assert.ok(tool)

  //when
  await sessionStart({ type: 'session_start' }, value.ctx)

  //then
  const result = await tool.execute('todo-call', {}, undefined, undefined, value.ctx)
  assert.deepEqual(
    (result as TodoToolResult<Todo[]>).structuredContent.map(({ content, status }) => ({ content, status })),
    [{ content: 'latest task', status: 'in_progress' }],
  )
})

test('should show no tasks given a new empty session', async () => {
  //given
  const savedEntry = {
    type: 'custom',
    customType: TODO_STATE_ENTRY,
    data: { todos: [{ id: firstId, content: 'previous session task', status: 'pending', dependsOn: [] }] },
  }
  const value = harness([savedEntry], true)
  await restoreTodos(value)
  const sessionStart = value.events.get('session_start')
  const tool = value.registeredTool
  assert.ok(sessionStart)
  assert.ok(tool)
  value.replaceBranch([])

  //when
  await sessionStart({ type: 'session_start' }, value.ctx)

  //then
  const result = await tool.execute('todo-call', {}, undefined, undefined, value.ctx)
  assert.deepEqual((result as TodoToolResult<Todo[]>).structuredContent, [])
})

test('should keep the live plan given a later prompt start with older branch history', async () => {
  //given
  const savedEntry = {
    type: 'custom',
    customType: TODO_STATE_ENTRY,
    data: { todos: [{ id: firstId, content: 'saved task', status: 'pending', dependsOn: [] }] },
  }
  const value = harness([savedEntry], true)
  await restoreTodos(value)
  const tool = value.registeredTool
  assert.ok(tool)
  await executeTodoTool(value, 'todo_add', { content: 'live task' })
  value.replaceBranch([savedEntry])
  const beforeAgentStart = value.events.get('before_agent_start')
  assert.ok(beforeAgentStart)

  //when
  await beforeAgentStart({ type: 'before_agent_start' }, value.ctx)

  //then
  const result = await tool.execute('todo-call', {}, undefined, undefined, value.ctx)
  assert.deepEqual((result as TodoToolResult<Todo[]>).structuredContent.map(({ content }) => content).sort(), [
    'live task',
    'saved task',
  ])
})

test('should restore the live plan in a fresh runtime given navigation to an older branch', async () => {
  //given
  const childEntry = {
    type: 'custom',
    customType: TODO_STATE_ENTRY,
    data: {
      todos: [
        {
          id: firstId,
          content: 'finished child task',
          details: 'finished details',
          status: 'completed',
          dependsOn: [],
        },
        {
          id: secondId,
          content: 'finished child follow-up',
          details: 'follow-up details',
          status: 'completed',
          dependsOn: [firstId],
        },
      ],
    },
  }
  const ancestorEntry = {
    type: 'custom',
    customType: TODO_STATE_ENTRY,
    data: { todos: [{ id: firstId, content: 'finished child task', status: 'pending', dependsOn: [] }] },
  }
  const value = harness([childEntry], true)
  await restoreTodos(value)
  value.replaceBranch([ancestorEntry])
  const branchChange = value.events.get('session_tree')
  const tool = value.registeredTool
  assert.ok(branchChange)
  assert.ok(tool)

  //when
  await branchChange({ type: 'session_tree' }, value.ctx)

  //then
  const expected = [
    {
      content: 'finished child task',
      status: 'completed',
      details: 'finished details',
      dependsOn: [],
    },
    {
      content: 'finished child follow-up',
      status: 'completed',
      details: 'follow-up details',
      dependsOn: [firstId],
    },
  ]
  const showAllTodos = {
    status: ['pending', 'in_progress', 'completed', 'omitted', 'blocked'],
    includeDetails: true,
  }
  const result = await tool.execute('todo-call', showAllTodos, undefined, undefined, value.ctx)
  assert.deepEqual(
    (result as TodoToolResult<Todo[]>).structuredContent.map(({ content, status, details, dependsOn }) => ({
      content,
      status,
      details,
      dependsOn,
    })),
    expected,
  )
  assert.deepEqual(
    extractLatestTodoSnapshot(value.appendedEntries).map(({ content, status, details, dependsOn }) => ({
      content,
      status,
      details,
      dependsOn,
    })),
    expected,
  )
  assert.equal(value.appendedEntries.length, 1)
  const message = value.sentMessages[0]?.message
  assert.ok(message)
  assert.equal(message.display, false)
  assert.equal(value.sentMessages[0]?.options?.triggerTurn, false)
  assert.match(message.content, /Current task: none/)
  assert.match(message.content, /Tasks: 0 remaining, 0 blocked, 2 complete, 0 omitted\./)
  assert.equal(value.widgets.get('todo'), undefined)

  const freshRuntime = harness([ancestorEntry, ...value.appendedEntries], true)
  await restoreTodos(freshRuntime)
  const freshTool = freshRuntime.registeredTool
  assert.ok(freshTool)
  const freshResult = await freshTool.execute('todo-call', showAllTodos, undefined, undefined, freshRuntime.ctx)
  assert.deepEqual(
    (freshResult as TodoToolResult<Todo[]>).structuredContent.map(({ content, status, details, dependsOn }) => ({
      content,
      status,
      details,
      dependsOn,
    })),
    expected,
  )
})

test('should preserve open task states given tree navigation with a branch summary', async () => {
  //given
  const value = harness(
    [
      {
        type: 'custom',
        customType: TODO_STATE_ENTRY,
        data: {
          todos: [
            { id: firstId, content: 'active task', status: 'in_progress', dependsOn: [] },
            { id: secondId, content: 'blocked task', status: 'blocked', dependsOn: [firstId] },
          ],
        },
      },
    ],
    true,
  )
  await restoreTodos(value)
  value.replaceBranch([{ type: 'branch_summary', summary: 'summary of the branch' }])
  const branchChange = value.events.get('session_tree')
  assert.ok(branchChange)

  //when
  await branchChange(
    { type: 'session_tree', summaryEntry: { type: 'branch_summary', summary: 'summary of the branch' } },
    value.ctx,
  )

  //then
  const tool = value.registeredTool
  assert.ok(tool)
  const result = await tool.execute(
    'todo-call',
    { status: ['pending', 'in_progress', 'completed', 'omitted', 'blocked'] },
    undefined,
    undefined,
    value.ctx,
  )
  assert.deepEqual(
    (result as TodoToolResult<Todo[]>).structuredContent.map(({ content, status }) => ({ content, status })),
    [
      { content: 'active task', status: 'in_progress' },
      { content: 'blocked task', status: 'blocked' },
    ],
  )
  const widgetFactory = value.widgets.get('todo') as unknown as ((tui: unknown, theme: Theme) => Renderable) | undefined
  assert.ok(widgetFactory)
  const lines = widgetFactory(undefined, value.theme).render(120)
  const activeTask = lines.find((line) => line.includes('active task'))
  const blockedTask = lines.find((line) => line.includes('blocked task'))
  assert.match(activeTask ?? '', /\[•\] active task/)
  assert.match(blockedTask ?? '', /\[!\] blocked task/)
  assert.doesNotMatch(activeTask ?? '', /\(in progress\)/)
  assert.doesNotMatch(blockedTask ?? '', /\(blocked\)/)
  assert.equal(value.sentMessages.length, 1)
  const message = value.sentMessages[0]?.message
  assert.ok(message)
  assert.equal(message.display, false)
  assert.equal(value.sentMessages[0]?.options?.triggerTurn, false)
  assert.match(message.content, /active task/)
  assert.doesNotMatch(message.content, /blocked task/)
  assert.equal(Object.hasOwn(message, 'details'), false)
  assert.deepEqual(
    extractLatestTodoSnapshot(value.appendedEntries).map((todo) => todo.content),
    ['active task', 'blocked task'],
  )
})

test('should preserve newly added tasks given tree navigation with an older snapshot', async () => {
  //given
  const value = harness(
    [
      {
        type: 'custom',
        customType: TODO_STATE_ENTRY,
        data: {
          todos: [{ id: firstId, content: 'active task', status: 'in_progress', dependsOn: [] }],
        },
      },
    ],
    true,
  )
  await restoreTodos(value)
  const tool = value.registeredTool
  assert.ok(tool)
  await executeTodoTool(value, 'todo_add', {
    content: 'new task one',
    dependsOn: [firstId],
  })
  await executeTodoTool(value, 'todo_add', { content: 'new task two' })
  value.replaceBranch([
    {
      type: 'custom',
      customType: TODO_STATE_ENTRY,
      data: {
        todos: [{ id: firstId, content: 'active task', status: 'in_progress', dependsOn: [] }],
      },
    },
  ])
  const branchChange = value.events.get('session_tree')
  assert.ok(branchChange)

  //when
  await branchChange(
    { type: 'session_tree', summaryEntry: { type: 'branch_summary', summary: 'summary of the branch' } },
    value.ctx,
  )

  //then
  const widgetFactory = value.widgets.get('todo') as unknown as ((tui: unknown, theme: Theme) => Renderable) | undefined
  assert.ok(widgetFactory)
  const lines = widgetFactory(undefined, value.theme).render(120)
  assert.ok(lines.some((line) => line.includes('active task')))
  assert.ok(lines.some((line) => line.includes('new task one')))
  assert.ok(lines.some((line) => line.includes('new task two')))
  const result = await tool.execute(
    'todo-call',
    { status: ['pending', 'in_progress', 'completed', 'omitted', 'blocked'] },
    undefined,
    undefined,
    value.ctx,
  )
  assert.deepEqual((result as TodoToolResult<Todo[]>).structuredContent.map(({ content }) => content).sort(), [
    'active task',
    'new task one',
    'new task two',
  ])
})

test('should persist an empty plan given tree navigation after clearing todos', async () => {
  //given
  const savedEntry = {
    type: 'custom',
    customType: TODO_STATE_ENTRY,
    data: { todos: [{ id: firstId, content: 'saved task', status: 'pending', dependsOn: [] }] },
  }
  const value = harness([savedEntry], true)
  await restoreTodos(value)
  const tool = value.registeredTool
  assert.ok(tool)
  await executeTodoTool(value, 'todo_clear')
  value.replaceBranch([savedEntry])
  const branchChange = value.events.get('session_tree')
  assert.ok(branchChange)

  //when
  await branchChange({ type: 'session_tree' }, value.ctx)

  //then
  const result = await tool.execute('todo-call', {}, undefined, undefined, value.ctx)
  assert.deepEqual((result as TodoToolResult<Todo[]>).structuredContent, [])
  assert.equal(value.appendedEntries.length, 2)
  assert.deepEqual(extractLatestTodoSnapshot(value.appendedEntries), [])
  const message = value.sentMessages[0]?.message
  assert.ok(message)
  assert.equal(message.display, false)
  assert.equal(value.sentMessages[0]?.options?.triggerTurn, false)
  assert.match(message.content, /Current task: none/)
  assert.match(message.content, /Tasks: 0 remaining, 0 blocked, 0 complete, 0 omitted\./)
  assert.equal(value.widgets.get('todo'), undefined)
})

test('should keep the live plan given a failed tree snapshot append', async () => {
  //given
  const liveEntry = {
    type: 'custom',
    customType: TODO_STATE_ENTRY,
    data: { todos: [{ id: firstId, content: 'live task', status: 'in_progress', dependsOn: [] }] },
  }
  const olderEntry = {
    type: 'custom',
    customType: TODO_STATE_ENTRY,
    data: { todos: [{ id: secondId, content: 'older task', status: 'pending', dependsOn: [] }] },
  }
  const cause = new Error('append failed')
  const value = harness([liveEntry], true, { failure: { operation: 'appendEntry', error: cause } })
  await restoreTodos(value)
  value.replaceBranch([olderEntry])
  const branchChange = value.events.get('session_tree')
  const tool = value.registeredTool
  assert.ok(branchChange)
  assert.ok(tool)

  //when
  const execution = Promise.resolve(branchChange({ type: 'session_tree' }, value.ctx))

  //then
  await assert.rejects(execution, (error: unknown) => {
    assert.ok(error instanceof TodoUiError)
    assert.equal(error.operation, 'append-entry')
    assert.equal(error.cause, cause)
    return true
  })
  const result = await tool.execute(
    'todo-call',
    { status: ['pending', 'in_progress', 'completed', 'omitted', 'blocked'] },
    undefined,
    undefined,
    value.ctx,
  )
  assert.deepEqual(
    (result as TodoToolResult<Todo[]>).structuredContent.map(({ content }) => content),
    ['live task'],
  )
  assert.deepEqual(value.appendedEntries, [])
})

test('should keep the saved plan given a failed tree status summary', async () => {
  //given
  const liveEntry = {
    type: 'custom',
    customType: TODO_STATE_ENTRY,
    data: { todos: [{ id: firstId, content: 'live task', status: 'in_progress', dependsOn: [] }] },
  }
  const olderEntry = {
    type: 'custom',
    customType: TODO_STATE_ENTRY,
    data: { todos: [{ id: secondId, content: 'older task', status: 'pending', dependsOn: [] }] },
  }
  const cause = new Error('message failed')
  const value = harness([liveEntry], true, { failure: { operation: 'sendMessage', error: cause } })
  await restoreTodos(value)
  value.replaceBranch([olderEntry])
  value.widgets.set('todo', undefined)
  const branchChange = value.events.get('session_tree')
  const tool = value.registeredTool
  assert.ok(branchChange)
  assert.ok(tool)

  //when
  const execution = Promise.resolve(branchChange({ type: 'session_tree' }, value.ctx))

  //then
  await assert.rejects(execution, (error: unknown) => {
    assert.ok(error instanceof TodoUiError)
    assert.equal(error.operation, 'send-message')
    assert.equal(error.cause, cause)
    return true
  })
  assert.deepEqual(
    extractLatestTodoSnapshot(value.appendedEntries).map((todo) => todo.content),
    ['live task'],
  )
  const result = await tool.execute(
    'todo-call',
    { status: ['pending', 'in_progress', 'completed', 'omitted', 'blocked'] },
    undefined,
    undefined,
    value.ctx,
  )
  assert.deepEqual(
    (result as TodoToolResult<Todo[]>).structuredContent.map(({ content }) => content),
    ['live task'],
  )
  assert.notEqual(value.widgets.get('todo'), undefined)
  assert.deepEqual(value.sentMessages, [])
})

test('should reject Todo calls given Plannotator execution of an approved plan', async () => {
  //given
  const value = harness(branchWithTodos, true, { phase: 'executing' })
  await restoreTodos(value)

  //when
  const execution = executeTodoTool(value, 'todo_show')

  //then
  await assert.rejects(execution, /disabled while Plannotator/)
  assert.equal(value.widgets.get('todo'), undefined)
})

test('should allow Todo calls given Plannotator returning to idle', async () => {
  //given
  const value = harness(branchWithTodos, true, { phase: 'executing' })
  await restoreTodos(value)
  value.setPhase('idle')
  const input = value.events.get('input')
  assert.ok(input)

  //when
  await input({ type: 'input' }, value.ctx)

  //then
  assert.notEqual(value.widgets.get('todo'), undefined)
  const result = await executeTodoTool(value, 'todo_show')
  assert.deepEqual(
    (result as TodoToolResult<Todo[]>).structuredContent.map(({ content }) => content),
    ['first task'],
  )
})

test('should wait for Plannotator status responses given an asynchronous request', async () => {
  //given
  const value = harness(branchWithTodos, true, {
    phaseResponses: [
      { phase: 'executing', delayMs: 10 },
      { phase: 'idle', delayMs: 10 },
    ],
  })
  await restoreTodos(value)
  const input = value.events.get('input')
  assert.ok(input)
  await assert.rejects(executeTodoTool(value, 'todo_show'), /disabled while Plannotator/)

  //when
  await input({ type: 'input' }, value.ctx)

  //then
  assert.notEqual(value.widgets.get('todo'), undefined)
  const result = await executeTodoTool(value, 'todo_show')
  assert.deepEqual(
    (result as TodoToolResult<Todo[]>).structuredContent.map(({ content }) => content),
    ['first task'],
  )
})

test('should ignore a Plannotator response given an expired bounded wait', async () => {
  //given
  const value = harness(branchWithTodos, true, { phaseResponses: [{ phase: 'executing', delayMs: 300 }] })
  await value.ready
  const input = value.events.get('input')
  assert.ok(input)

  //when
  await input({ type: 'input' }, value.ctx)
  await new Promise((resolve) => setTimeout(resolve, 350))

  //then
  const result = await executeTodoTool(value, 'todo_show')
  assert.deepEqual((result as TodoToolResult<Todo[]>).structuredContent, [])
})

test('should ignore stale Plannotator responses given overlapping requests', async () => {
  //given
  const value = harness([], true, {
    phaseResponses: [{ phase: 'executing', delayMs: 25 }, { phase: 'idle' }],
  })
  await value.ready
  const input = value.events.get('input')
  assert.ok(input)

  //when
  await Promise.all([input({ type: 'input' }, value.ctx), input({ type: 'input' }, value.ctx)])

  //then
  const result = await executeTodoTool(value, 'todo_show')
  assert.deepEqual((result as TodoToolResult<Todo[]>).structuredContent, [])
})

test('should clean up a Plannotator status request given an abort', async () => {
  //given
  const controller = new AbortController()
  const value = harness([], true, {
    phaseResponses: [{ phase: 'executing', delayMs: 300 }],
  })
  await value.ready
  const input = value.events.get('input')
  assert.ok(input)
  const context = { ...value.ctx, signal: controller.signal }
  const abortTimer = setTimeout(() => controller.abort(), 50)

  //when
  const outcome = await Promise.race([
    Promise.resolve(input({ type: 'input' }, context)).then(
      () => 'settled',
      () => 'settled',
    ),
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 150)),
  ])

  //then
  clearTimeout(abortTimer)
  assert.equal(outcome, 'settled')
  await new Promise((resolve) => setTimeout(resolve, 350))
  const result = await executeTodoTool(value, 'todo_show')
  assert.deepEqual((result as TodoToolResult<Todo[]>).structuredContent, [])
})

test('should return typed errors given a host that cannot append a snapshot', async () => {
  //given
  const cause = new Error('append failed')
  const value = harness([], true, { failure: { operation: 'appendEntry', error: cause } })
  await value.ready
  const tool = value.registeredTool
  assert.ok(tool)

  //when
  const execution = executeTodoTool(value, 'todo_add', { content: 'not persisted' })

  //then
  await assert.rejects(execution, (error: unknown) => {
    const typed = error instanceof PiToolError ? error.cause : error
    assert.ok(typed instanceof TodoUiError)
    assert.equal(typed.operation, 'append-entry')
    assert.equal(typed.cause, cause)
    return true
  })
  const readOnly = await tool.execute('todo-call', {}, undefined, undefined, value.ctx)
  assert.deepEqual((readOnly as TodoToolResult<Todo[]>).structuredContent, [])
})

test('should return typed errors given a host callback failure during compaction', async () => {
  //given
  const cause = new Error('message failed')
  const value = harness(branchWithTodos, true, { failure: { operation: 'sendMessage', error: cause } })
  await restoreTodos(value)
  const compact = value.events.get('session_compact')
  assert.ok(compact)

  //when
  const execution = Promise.resolve(compact({ type: 'session_compact', willRetry: false }, value.ctx))

  //then
  await assert.rejects(execution, (error: unknown) => {
    assert.ok(error instanceof TodoUiError)
    assert.equal(error.operation, 'send-message')
    assert.equal(error.cause, cause)
    return true
  })
})

test('should open /todos given active tracking', async () => {
  //given
  const value = harness(branchWithTodos, true)
  await restoreTodos(value)
  const command = value.registeredCommand('todos')?.handler
  assert.ok(command)

  //when
  await command('', value.ctx)

  //then
  assert.deepEqual(value.notifications, [])
})

test('should render dependency indentation in /todos given nested tasks', async () => {
  //given
  const value = harness(branchWithTodos, true)
  await restoreTodos(value)
  const command = value.registeredCommand('todos')?.handler
  assert.ok(command)

  //when
  await command('', value.ctx)

  //then
  const viewer = value.customView()
  assert.ok(viewer)
  const lines = viewer.render(120)
  const firstTask = lines.find((line) => line.includes('first task'))
  const secondTask = lines.find((line) => line.includes('second task'))
  assert.match(firstTask ?? '', /\[ \] first task/)
  assert.doesNotMatch(firstTask ?? '', /\(pending\)/)
  assert.match(secondTask ?? '', /^ {4}↳ \[!\] second task/)
  assert.doesNotMatch(secondTask ?? '', /\(blocked\)/)
})

test('should clear todos from the current branch given the /clear-todos command', async () => {
  //given
  const value = harness(branchWithTodos, true)
  await restoreTodos(value)
  const command = value.registeredCommand('clear-todos')?.handler
  assert.ok(command)

  //when
  await command('', value.ctx)

  //then
  assert.deepEqual(extractLatestTodoSnapshot(value.appendedEntries), [])
  assert.deepEqual(value.sentMessages, [
    {
      message: { customType: 'todo-clear', content: 'Cleared 2 todos', display: false },
      options: { triggerTurn: false },
    },
  ])
  assert.match(value.notifications.at(-1) ?? '', /Cleared 2 todos/)
})

test('should report zero cleared todos given an empty list', async () => {
  //given
  const value = harness()
  await value.ready
  const command = value.registeredCommand('clear-todos')?.handler
  assert.ok(command)

  //when
  await command('', value.ctx)

  //then
  assert.equal(value.appendedEntries.length, 0)
  assert.deepEqual(value.sentMessages, [
    {
      message: { customType: 'todo-clear', content: 'Cleared 0 todos', display: false },
      options: { triggerTurn: false },
    },
  ])
  assert.match(value.notifications.at(-1) ?? '', /Cleared 0 todos/)
})

test('should schedule the clear result for the next turn given a busy assistant', async () => {
  //given
  const value = harness(branchWithTodos, false)
  await restoreTodos(value)
  const command = value.registeredCommand('clear-todos')?.handler
  assert.ok(command)

  //when
  await command('', value.ctx)

  //then
  assert.deepEqual(value.sentMessages, [
    {
      message: { customType: 'todo-clear', content: 'Cleared 2 todos', display: false },
      options: { deliverAs: 'nextTurn' },
    },
  ])
})

test('should warn and keep the clear committed given message delivery failure', async () => {
  //given
  const value = harness(branchWithTodos, true, {
    failure: { operation: 'sendMessage', error: new Error('message failed') },
  })
  await restoreTodos(value)
  const command = value.registeredCommand('clear-todos')?.handler
  assert.ok(command)

  //when
  await command('', value.ctx)

  //then
  assert.deepEqual(extractLatestTodoSnapshot(value.appendedEntries), [])
  assert.equal(value.sentMessages.length, 0)
  assert.match(value.notifications.at(-1) ?? '', /Cleared 2 todos, but the assistant context was not updated/)
  assert.equal(value.notificationLevels.at(-1), 'warning')
})

test('should not send a success message given a failed clear transaction', async () => {
  //given
  const cause = new Error('entry failed')
  const value = harness(branchWithTodos, true, { failure: { operation: 'appendEntry', error: cause } })
  await restoreTodos(value)
  const command = value.registeredCommand('clear-todos')?.handler
  assert.ok(command)

  //when
  const execution = command('', value.ctx)

  //then
  await assert.rejects(execution, (error: unknown) => {
    assert.ok(error instanceof TodoUiError)
    assert.equal(error.operation, 'append-entry')
    assert.equal(error.cause, cause)
    return true
  })
  assert.deepEqual(value.sentMessages, [])
  assert.deepEqual(value.notifications, [])
})

test('should indent expanded todo details by dependency depth given nested tasks', async () => {
  //given
  const value = harness(
    [
      {
        type: 'custom',
        customType: TODO_STATE_ENTRY,
        data: {
          todos: [
            { id: firstId, content: 'first task', status: 'in_progress', dependsOn: [], details: 'first details' },
            {
              id: secondId,
              content: 'second task',
              status: 'pending',
              dependsOn: [firstId],
              details: 'second details',
            },
          ],
        },
      },
    ],
    true,
    { toolsExpanded: true },
  )
  await restoreTodos(value)
  const widgetFactory = value.widgets.get('todo') as unknown as ((tui: unknown, theme: Theme) => Renderable) | undefined
  assert.ok(widgetFactory)

  //when
  const lines = widgetFactory(undefined, value.theme).render(120)

  //then
  assert.equal(
    lines.find((line) => line.includes('second details')),
    '      second details',
  )
})

test('should render todo details given tool output expanded after widget creation', async () => {
  //given
  const value = harness(
    [
      {
        type: 'custom',
        customType: TODO_STATE_ENTRY,
        data: {
          todos: [
            { id: firstId, content: 'first task', status: 'in_progress', dependsOn: [], details: 'first details' },
          ],
        },
      },
    ],
    true,
    { toolsExpanded: false },
  )
  await restoreTodos(value)
  const widgetFactory = value.widgets.get('todo') as unknown as ((tui: unknown, theme: Theme) => Renderable) | undefined
  assert.ok(widgetFactory)
  const widget = widgetFactory(undefined, value.theme)
  assert.doesNotMatch(widget.render(120).join('\n'), /first details/)
  value.setToolsExpanded(true)

  //when
  const lines = widget.render(120)

  //then
  assert.match(lines.join('\n'), /first details/)
})

test('should hide todo details given tool output collapsed after widget creation', async () => {
  //given
  const value = harness(
    [
      {
        type: 'custom',
        customType: TODO_STATE_ENTRY,
        data: {
          todos: [
            { id: firstId, content: 'first task', status: 'in_progress', dependsOn: [], details: 'first details' },
          ],
        },
      },
    ],
    true,
    { toolsExpanded: true },
  )
  await restoreTodos(value)
  const widgetFactory = value.widgets.get('todo') as unknown as ((tui: unknown, theme: Theme) => Renderable) | undefined
  assert.ok(widgetFactory)
  const widget = widgetFactory(undefined, value.theme)
  value.setToolsExpanded(false)

  //when
  const lines = widget.render(120)

  //then
  assert.doesNotMatch(lines.join('\n'), /first details/)
})

test('should keep expanded todo details within the widget width given a narrow terminal', async () => {
  //given
  const value = harness(
    [
      {
        type: 'custom',
        customType: TODO_STATE_ENTRY,
        data: {
          todos: [
            { id: firstId, content: 'first task', status: 'in_progress', dependsOn: [], details: 'first details' },
          ],
        },
      },
    ],
    true,
    { toolsExpanded: true },
  )
  await restoreTodos(value)
  const widgetFactory = value.widgets.get('todo') as unknown as ((tui: unknown, theme: Theme) => Renderable) | undefined
  assert.ok(widgetFactory)

  //when
  const lines = widgetFactory(undefined, value.theme).render(3)

  //then
  assert.ok(lines.every((line) => visibleWidth(line) <= 3))
})

test('should report typed UI errors given a /todos command failure', async () => {
  //given
  const cause = new Error('viewer failed')
  const value = harness(branchWithTodos, true, { customError: cause })
  await restoreTodos(value)
  const command = value.registeredCommand('todos')?.handler
  assert.ok(command)

  //when
  const execution = command('', value.ctx)

  //then
  await assert.rejects(execution, (error: unknown) => {
    assert.ok(error instanceof TodoUiError)
    assert.equal(error.operation, 'show')
    assert.equal(error.message, 'Error: viewer failed')
    assert.equal(error.cause, cause)
    return true
  })
})

test('should report typed UI errors given a failure reading tool output expansion state', async () => {
  //given
  const cause = new Error('tool expansion state failed')
  const value = harness(branchWithTodos, true, {
    failure: { operation: 'getToolsExpanded', error: cause },
  })

  //when
  const execution = restoreTodos(value)

  //then
  await assert.rejects(execution, (error: unknown) => {
    assert.ok(error instanceof TodoUiError)
    assert.equal(error.operation, 'update')
    assert.equal(error.message, 'Error: tool expansion state failed')
    assert.equal(error.cause, cause)
    return true
  })
})
