import assert from 'node:assert/strict'
import test from 'node:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import { PiToolError } from '@eratio/pi-effect-codemode'
import todoExtension from '../index.ts'
import { TodoUiError } from '../src/effects.ts'
import type { Todo } from '../src/model.ts'
import { extractLatestTodoSnapshot, TODO_STATE_ENTRY } from '../src/state.ts'

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
  description?: string
  executionMode?: string
  promptSnippet?: string
  promptGuidelines?: string[]
  parameters?: { properties?: { code?: unknown } }
  execute: (...args: unknown[]) => Promise<unknown>
  renderCall?: (...args: unknown[]) => Renderable
  renderResult?: (...args: unknown[]) => Renderable
}
type TodoToolResult = {
  readonly content: readonly { readonly type: string; readonly text?: string }[]
  readonly details: { readonly operations?: Readonly<Record<string, number>> }
}
type RegisteredCommand = { handler: (...args: unknown[]) => Promise<void> }
type Phase = 'idle' | 'planning' | 'executing'
type FailureOperation =
  | 'appendEntry'
  | 'sendMessage'
  | 'getActiveTools'
  | 'setActiveTools'
  | 'getBranch'
  | 'getToolsExpanded'
  | 'notify'
  | 'isIdle'
  | 'emit'
type HarnessOptions = {
  customError?: unknown
  phase?: Phase
  phaseResponses?: Array<{ phase: Phase; delayMs?: number }>
  failure?: { operation: FailureOperation; error: Error }
  onSetActiveTools?: () => void
  toolsExpanded?: boolean
}

type Harness = {
  ready: Promise<unknown>
  ctx: Record<string, unknown>
  events: Map<string, EventHandler>
  sentMessages: SentMessage[]
  activeTools: string[]
  widgets: Map<string, string[] | undefined>
  notifications: string[]
  notificationLevels: Array<string | undefined>
  customView: () => Renderable | undefined
  appendedEntries: unknown[]
  registeredToolNames: string[]
  theme: Theme
  readonly registeredTool: RegisteredTool | undefined
  registeredCommand(name: string): RegisteredCommand | undefined
  setToolsExpanded(expanded: boolean): void
  setPhase(next: Phase | undefined): void
  replaceBranch(next: readonly unknown[]): void
}

function harness(branch: unknown[] = [], idle = true, options: HarnessOptions = {}): Harness {
  const events = new Map<string, EventHandler>()
  const sentMessages: SentMessage[] = []
  const activeTools = ['read', 'todo', 'write']
  const widgets = new Map<string, string[] | undefined>()
  const notifications: string[] = []
  const notificationLevels: Array<string | undefined> = []
  let customView: Renderable | undefined
  const sessionEntries = [...branch]
  const appendedEntries: unknown[] = []
  const registeredToolNames: string[] = []
  let registeredTool: RegisteredTool | undefined
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
      if (tool.name) registeredToolNames.push(tool.name)
      registeredTool = tool
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
      fail('getActiveTools')
      return [...activeTools]
    },
    setActiveTools(next: string[]): void {
      fail('setActiveTools')
      activeTools.splice(0, activeTools.length, ...next)
      options.onSetActiveTools?.()
    },
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
    activeTools,
    widgets,
    notifications,
    notificationLevels,
    customView: (): Renderable | undefined => customView,
    appendedEntries,
    registeredToolNames,
    theme,
    get registeredTool(): RegisteredTool | undefined {
      return registeredTool
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

function todoCode(body: string): { code: string } {
  return { code: `export default async (todo: TodoApi) => { ${body} }` }
}

test('should suspend todo tracking given an approved plan submission', async () => {
  //given
  const value = harness([], true, { phase: 'executing' })
  await value.ready
  const handler = value.events.get('tool_result')
  assert.ok(handler)

  //when
  await handler({ toolName: 'plannotator_submit_plan', details: { approved: true, plan: 'accepted' } }, value.ctx)

  //then
  assert.equal(value.activeTools.includes('todo'), false)
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
    assert.equal(value.activeTools.includes('todo'), true)
  })
}

test('should not carry open tasks given a malformed marked snapshot', async () => {
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
  assert.equal(value.widgets.get('todo'), undefined)
  assert.equal(value.sentMessages.length, 0)
})

test('should register one todo tool and commit one snapshot given a successful program', async () => {
  //given
  const value = harness()
  await value.ready
  const tool = value.registeredTool
  assert.ok(tool)
  assert.equal(tool.name, 'todo')
  assert.equal(
    tool.description,
    'Run TypeScript code that reads and updates the current todo plan for non-trivial work with three or more tasks.',
  )
  assert.deepEqual(value.registeredToolNames, ['todo'])
  assert.equal(tool.executionMode, 'sequential')
  assert.match(tool.promptSnippet ?? '', /non-trivial work with three or more tasks/)
  assert.match(tool.promptGuidelines?.join('\n') ?? '', /Use todo only for non-trivial work with three or more tasks/)
  assert.match(tool.promptGuidelines?.join('\n') ?? '', /TodoApi/)
  assert.match(tool.promptGuidelines?.join('\n') ?? '', /todo\.help\(\)/)
  assert.doesNotMatch(tool.promptGuidelines?.join('\n') ?? '', /interface TodoId/)
  assert.ok(tool.parameters?.properties?.code)
  const renderedCall = tool.renderCall?.({}, value.theme, { argsComplete: false })
  assert.ok(renderedCall)
  assert.match(renderedCall.render(120).join('\n'), /Todo/)

  //when
  const code = todoCode("const task = await todo.add({ content: 'new task' }); return task.content").code
  const result = await tool.execute('todo-call', { code }, undefined, undefined, value.ctx)

  //then
  const typedResult = result as TodoToolResult
  assert.equal(typedResult.content[0]?.text, 'new task')
  assert.deepEqual(typedResult.details.operations, { add: 1 })
  assert.equal(value.appendedEntries.length, 1)
  assert.equal((value.appendedEntries[0] as { customType: string }).customType, TODO_STATE_ENTRY)
})

test('should commit multiple program mutations in one session snapshot given a single session', async () => {
  //given
  const value = harness()
  await value.ready
  const tool = value.registeredTool
  assert.ok(tool)

  //when
  const result = await tool.execute(
    'todo-call',
    todoCode(
      "const first = await todo.add({ content: 'first' }); const second = await todo.add({ content: 'second', dependsOn: [first.id] }); return [first.id, second.id]",
    ),
    undefined,
    undefined,
    value.ctx,
  )

  //then
  const details = (result as TodoToolResult).details
  assert.deepEqual(details.operations, { add: 2 })
  assert.equal(extractLatestTodoSnapshot(value.appendedEntries).length, 2)
})

test('should report every successful mutation count in tool details given multiple mutations', async () => {
  //given
  const value = harness()
  await value.ready
  const tool = value.registeredTool
  assert.ok(tool)

  //when
  const result = await tool.execute(
    'todo-call',
    todoCode(
      "const first = await todo.add({ content: 'first' }); const second = await todo.add({ content: 'second' }); await todo.show(); await todo.update(second.id, { details: 'updated' }); try { await todo.update('018f0000-0000-7000-8000-000000000099', {}) } catch {} await todo.next(); await todo.complete(); await todo.next(); await todo.omit(second.id); await todo.restore(second.id); await todo.clear(); return 'done'",
    ),
    undefined,
    undefined,
    value.ctx,
  )

  //then
  assert.deepEqual((result as TodoToolResult).details.operations, {
    add: 2,
    show: 1,
    update: 2,
    next: 2,
    complete: 1,
    omit: 1,
    restore: 1,
    clear: 1,
  })
})

test('should roll back all mutations given a program that throws', async () => {
  //given
  const value = harness()
  await value.ready
  const tool = value.registeredTool
  assert.ok(tool)

  //when
  const execution = tool.execute(
    'todo-call',
    todoCode("await todo.add({ content: 'discarded' }); throw new Error('program failed')"),
    undefined,
    undefined,
    value.ctx,
  )

  //then
  await assert.rejects(execution, /program failed/)
  assert.deepEqual(value.appendedEntries, [])
  const readOnly = await tool.execute(
    'todo-call',
    todoCode('return await todo.show()'),
    undefined,
    undefined,
    value.ctx,
  )
  assert.deepEqual((readOnly as TodoToolResult).details.operations, { show: 1 })
})

test('should roll back draft mutations given an aborted pending Todo program', async () => {
  //given
  const value = harness()
  await value.ready
  const tool = value.registeredTool
  assert.ok(tool)
  const controller = new AbortController()
  const execution = tool.execute(
    'todo-call',
    todoCode("await todo.add({ content: 'cancelled' }); await new Promise(() => {})"),
    controller.signal,
    undefined,
    value.ctx,
  )
  const abort = new Promise<void>((resolve) =>
    setTimeout(() => {
      controller.abort()
      resolve()
    }, 100),
  )

  //when
  await abort

  //then
  await assert.rejects(execution)
  assert.deepEqual(value.appendedEntries, [])
  const readOnly = await tool.execute(
    'todo-call',
    todoCode('return await todo.show()'),
    undefined,
    undefined,
    value.ctx,
  )
  assert.deepEqual((readOnly as TodoToolResult).details.operations, { show: 1 })
})

test('should commit the remaining mutations given a caught API error', async () => {
  //given
  const value = harness()
  await value.ready
  const tool = value.registeredTool
  assert.ok(tool)

  //when
  const result = await tool.execute(
    'todo-call',
    todoCode(
      "const task = await todo.add({ content: 'kept' }); try { await todo.update('bad-id', {}) } catch {} return task.content",
    ),
    undefined,
    undefined,
    value.ctx,
  )

  //then
  const typedResult = result as TodoToolResult
  assert.equal(typedResult.content[0]?.text, 'kept')
  assert.deepEqual(typedResult.details.operations, { add: 1, update: 1 })
  assert.equal(value.appendedEntries.length, 1)
})

test('should not append a snapshot or refresh the widget given a read-only program', async () => {
  //given
  const value = harness(branchWithTodos, true)
  await restoreTodos(value)
  const tool = value.registeredTool
  assert.ok(tool)
  const widget = value.widgets.get('todo')

  //when
  const result = await tool.execute('todo-call', todoCode('return await todo.show()'), undefined, undefined, value.ctx)

  //then
  assert.equal((result as TodoToolResult).details.operations?.show, 1)
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

test('should restore state given a session branch change', async () => {
  //given
  const value = harness(branchWithTodos, true)
  await restoreTodos(value)
  value.replaceBranch([
    {
      type: 'custom',
      customType: TODO_STATE_ENTRY,
      data: { todos: [{ id: secondId, content: 'branch task', status: 'pending', dependsOn: [] }] },
    },
  ])
  const branchChange = value.events.get('session_tree')
  assert.ok(branchChange)

  //when
  await branchChange({ type: 'session_tree' }, value.ctx)

  //then
  const tool = value.registeredTool
  assert.ok(tool)
  const result = await tool.execute(
    'todo-call',
    todoCode('return (await todo.show())[0]?.content'),
    undefined,
    undefined,
    value.ctx,
  )
  assert.equal((result as TodoToolResult).content[0]?.text, 'branch task')
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
  await tool.execute(
    'todo-call',
    todoCode(
      "await todo.add({ content: 'new task one', dependsOn: ['018f0000-0000-7000-8000-000000000001'] }); await todo.add({ content: 'new task two' }); return 'added'",
    ),
    undefined,
    undefined,
    value.ctx,
  )
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
})

test('should suspend the todo tool given Plannotator execution of an approved plan', async () => {
  //given
  const value = harness(branchWithTodos, true, { phase: 'executing' })
  await restoreTodos(value)
  const tool = value.registeredTool
  assert.ok(tool)

  //when
  const execution = tool.execute('todo-call', todoCode('return await todo.show()'), undefined, undefined, value.ctx)

  //then
  await assert.rejects(execution, /disabled while Plannotator/)
  assert.equal(value.activeTools.includes('todo'), false)
  assert.equal(value.widgets.get('todo'), undefined)
})

test('should restore the tool given Plannotator returning to idle', async () => {
  //given
  const value = harness(branchWithTodos, true, { phase: 'executing' })
  await restoreTodos(value)
  value.setPhase('idle')
  const input = value.events.get('input')
  assert.ok(input)

  //when
  await input({ type: 'input' }, value.ctx)

  //then
  assert.equal(value.activeTools.includes('todo'), true)
  assert.notEqual(value.widgets.get('todo'), undefined)
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
  assert.equal(value.activeTools.includes('todo'), false)

  //when
  await input({ type: 'input' }, value.ctx)

  //then
  assert.equal(value.activeTools.includes('todo'), true)
  assert.notEqual(value.widgets.get('todo'), undefined)
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
  assert.equal(value.activeTools.includes('todo'), true)
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
  assert.equal(value.activeTools.includes('todo'), true)
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
  assert.equal(value.activeTools.includes('todo'), true)
})

test('should serialize phase transitions before updating the widget given concurrent changes', async () => {
  //given
  let value!: ReturnType<typeof harness>
  let input: EventHandler | undefined
  let concurrentInput: Promise<unknown> | undefined
  let triggered = false
  value = harness(branchWithTodos, true, {
    phase: 'executing',
    onSetActiveTools: () => {
      if (triggered) return
      triggered = true
      value.setPhase('idle')
      if (input) concurrentInput = Promise.resolve(input({ type: 'input' }, value.ctx))
    },
  })
  await value.ready
  input = value.events.get('input')
  assert.ok(input)

  //when
  await restoreTodos(value)
  await concurrentInput

  //then
  assert.equal(value.activeTools.includes('todo'), true)
  assert.notEqual(value.widgets.get('todo'), undefined)
})

test('should return typed errors given a host that cannot append a snapshot', async () => {
  //given
  const cause = new Error('append failed')
  const value = harness([], true, { failure: { operation: 'appendEntry', error: cause } })
  await value.ready
  const tool = value.registeredTool
  assert.ok(tool)

  //when
  const execution = tool.execute(
    'todo-call',
    todoCode("await todo.add({ content: 'not persisted' }); return 'done'"),
    undefined,
    undefined,
    value.ctx,
  )

  //then
  await assert.rejects(execution, (error: unknown) => {
    const typed = error instanceof PiToolError ? error.cause : error
    assert.ok(typed instanceof TodoUiError)
    assert.equal(typed.operation, 'append-entry')
    assert.equal(typed.cause, cause)
    return true
  })
  const readOnly = await tool.execute(
    'todo-call',
    todoCode('return await todo.show()'),
    undefined,
    undefined,
    value.ctx,
  )
  assert.equal((readOnly as TodoToolResult).content[0]?.text, '[]')
})

test('should roll back suspension given a failed active-tool host callback', async () => {
  //given
  const cause = new Error('tool update failed')
  const value = harness(branchWithTodos, true, {
    phase: 'executing',
    failure: { operation: 'setActiveTools', error: cause },
  })
  await value.ready
  const sessionStart = value.events.get('session_start')
  assert.ok(sessionStart)

  //when
  const execution = Promise.resolve(sessionStart({ type: 'session_start' }, value.ctx))

  //then
  await assert.rejects(execution, (error: unknown) => {
    assert.ok(error instanceof TodoUiError)
    assert.equal(error.operation, 'set-active-tools')
    assert.equal(error.cause, cause)
    return true
  })
  assert.equal(value.activeTools.includes('todo'), true)
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

test('should preserve the original program error given transaction and tool layers', async () => {
  //given
  const value = harness()
  await value.ready
  const tool = value.registeredTool
  assert.ok(tool)
  const cause = new Error('program failed')

  //when
  const execution = tool.execute(
    'todo-call',
    todoCode("throw new Error('program failed')"),
    undefined,
    undefined,
    value.ctx,
  )

  //then
  await assert.rejects(execution, (error: unknown) => {
    const typed = error instanceof PiToolError ? error.cause : error
    assert.ok(typed instanceof TodoUiError)
    assert.equal(typed.operation, 'execute')
    assert.notEqual(typed.cause, undefined)
    assert.equal((typed.cause as { message: string }).message, cause.message)
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
