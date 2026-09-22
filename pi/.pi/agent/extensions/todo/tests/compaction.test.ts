import assert from 'node:assert/strict'
import test from 'node:test'
import { visibleWidth } from '@earendil-works/pi-tui'
import { PiToolError } from '@eratio08/pi-effect'
import todoExtension, { formatTodoOperationSummary } from '../index.ts'
import { type TodoToolResult, TodoUiError } from '../src/effects.ts'
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
type RegisteredCommand = { handler: (...args: unknown[]) => Promise<void> }
type Phase = 'idle' | 'planning' | 'executing'
type FailureOperation =
  | 'appendEntry'
  | 'sendMessage'
  | 'getActiveTools'
  | 'setActiveTools'
  | 'getBranch'
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

function harness(branch: unknown[] = [], idle = true, options: HarnessOptions = {}) {
  const events = new Map<string, EventHandler>()
  const sentMessages: SentMessage[] = []
  const activeTools = ['read', 'todo', 'write']
  const widgets = new Map<string, string[] | undefined>()
  const notifications: string[] = []
  let customView: Renderable | undefined
  const sessionEntries = [...branch]
  const appendedEntries: unknown[] = []
  const registeredToolNames: string[] = []
  let registeredTool: RegisteredTool | undefined
  let registeredCommand: RegisteredCommand | undefined
  let phase = options.phase
  const phaseResponses = [...(options.phaseResponses ?? [])]
  const fail = (operation: FailureOperation): void => {
    if (options.failure?.operation === operation) throw options.failure.error
  }
  const theme: Theme = {
    fg: (_color, text) => text,
    bold: (text) => text,
    strikethrough: (text) => text,
  }
  const pi = {
    on(event: string, handler: EventHandler) {
      events.set(event, handler)
    },
    registerTool(tool: RegisteredTool) {
      if (tool.name) registeredToolNames.push(tool.name)
      registeredTool = tool
    },
    appendEntry(customType: string, data: unknown) {
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
    registerCommand(_name: string, command: RegisteredCommand) {
      registeredCommand = command
    },
    sendMessage(message: SentMessage['message'], options: SentMessage['options']) {
      fail('sendMessage')
      sentMessages.push({ message, options })
    },
    getActiveTools() {
      fail('getActiveTools')
      return [...activeTools]
    },
    setActiveTools(next: string[]) {
      fail('setActiveTools')
      activeTools.splice(0, activeTools.length, ...next)
      options.onSetActiveTools?.()
    },
    events: {
      emit(channel: string, request: { respond: (response: unknown) => void }) {
        fail('emit')
        if (channel !== 'plannotator:request') return
        const response = phaseResponses.shift()
        const responsePhase = response?.phase ?? phase
        if (!responsePhase) return
        const respond = () => request.respond({ status: 'handled', result: { phase: responsePhase } })
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
      setWidget(key: string, content: string[] | undefined) {
        widgets.set(key, content)
      },
      notify(message: string) {
        fail('notify')
        notifications.push(message)
      },
      getToolsExpanded() {
        return options.toolsExpanded ?? false
      },
      async custom(factory: (tui: unknown, theme: Theme, keybindings: unknown, done: () => void) => unknown) {
        if (options.customError !== undefined) throw options.customError
        customView = factory(undefined, theme, undefined, () => {}) as Renderable
        return undefined
      },
    },
    isIdle: () => {
      fail('isIdle')
      return idle
    },
    sessionManager: {
      getCwd: () => '/tmp',
      getSessionId: () => 'test-session',
      getSessionFile: () => undefined,
      getSessionDir: () => '/tmp',
      getLeafId: () => null,
      getLeafEntry: () => undefined,
      getEntries: () => sessionEntries,
      getTree: () => [],
      getEntry: () => undefined,
      getBranch: () => {
        fail('getBranch')
        return sessionEntries
      },
      buildContextEntries: () => [],
      getLabel: () => undefined,
      getSessionName: () => undefined,
    },
    signal: undefined,
  }

  todoExtension(pi as never)

  return {
    ctx,
    events,
    sentMessages,
    activeTools,
    widgets,
    notifications,
    customView: () => customView,
    appendedEntries,
    registeredToolNames,
    theme,
    get registeredTool() {
      return registeredTool
    },
    get registeredCommand() {
      return registeredCommand
    },
    setToolsExpanded(expanded: boolean): void {
      options.toolsExpanded = expanded
    },
    setPhase(next: 'idle' | 'planning' | 'executing' | undefined) {
      phase = next
    },
    replaceBranch(next: readonly unknown[]) {
      sessionEntries.splice(0, sessionEntries.length, ...next)
    },
  }
}

const firstId = '018f0000-0000-7000-8000-000000000001'
const secondId = '018f0000-0001-7000-8000-000000000002'
const branchWithTodos = [
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
  const handler = value.events.get('session_start')
  assert.ok(handler)
  await handler({ type: 'session_start' }, value.ctx)
  await waitForTimers()
}

function todoCode(body: string): { code: string } {
  return { code: `export default async (todo: TodoApi) => { ${body} }` }
}

test('registers one todo tool and commits one snapshot after a successful program', async () => {
  //given
  const value = harness()
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
  assert.ok(tool.parameters?.properties?.code)
  const renderedCall = tool.renderCall?.({}, value.theme, { argsComplete: false })
  assert.ok(renderedCall)
  assert.match(renderedCall.render(120).join('\n'), /todo/)

  //when
  const code = todoCode("const task = await todo.add({ content: 'new task' }); return task.content").code
  const result = await tool.execute('todo-call', { code }, undefined, undefined, value.ctx)

  //then
  const details = (result as TodoToolResult).details
  assert.equal(details.output, 'new task')
  assert.equal(details.code, code)
  assert.equal(details.codeTruncated, false)
  assert.equal(Object.hasOwn(details, 'todos'), false)
  assert.equal(value.appendedEntries.length, 1)
  assert.equal((value.appendedEntries[0] as { customType: string }).customType, TODO_STATE_ENTRY)
})

test('truncates unusually large submitted code in tool details', async () => {
  //given
  const value = harness()
  const tool = value.registeredTool
  assert.ok(tool)
  const code = todoCode(`\n${Array.from({ length: 2100 }, () => '').join('\n')}\nreturn 'done'`)

  //when
  const result = await tool.execute('todo-call', code, undefined, undefined, value.ctx)

  //then
  const details = (result as TodoToolResult).details
  assert.equal(details.codeTruncated, true)
  assert.match(details.code ?? '', /Code truncated/)
})

test('formats todo operation summaries in stable order', () => {
  //given
  const summary = {
    added: 3,
    updated: 4,
    started: 1,
    completed: 1,
    omitted: 0,
    restored: 0,
    cleared: 0,
  }

  //when
  const formatted = formatTodoOperationSummary(summary)

  //then
  assert.equal(formatted, 'added 3 · updated 4 · started 1 · completed 1')
})

test('formats an empty todo operation summary as no changes', () => {
  //given
  const summary = {
    added: 0,
    updated: 0,
    started: 0,
    completed: 0,
    omitted: 0,
    restored: 0,
    cleared: 0,
  }

  //when
  const formatted = formatTodoOperationSummary(summary)

  //then
  assert.equal(formatted, 'no changes')
})

test('defines the complete todo result detail contract', () => {
  //given
  const value = harness()
  const renderResult = value.registeredTool?.renderResult
  assert.ok(renderResult)
  const result = {
    content: [{ type: 'text' as const, text: 'program output' }],
    details: {
      output: 'program output',
      truncated: false,
      summary: {
        added: 1,
        updated: 2,
        started: 3,
        completed: 4,
        omitted: 5,
        restored: 6,
        cleared: 7,
      },
      code: 'submitted code',
      codeTruncated: false,
    },
  } satisfies TodoToolResult

  //when
  const rendered = renderResult(result, { expanded: true }, value.theme, { isError: false })

  //then
  assert.match(rendered.render(120).join('\\n'), /program output/)
})

test('commits multiple program mutations in one session snapshot', async () => {
  //given
  const value = harness()
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
  assert.equal(Object.hasOwn(details, 'todos'), false)
  assert.equal(extractLatestTodoSnapshot(value.appendedEntries).length, 2)
})

test('reports every successful mutation count in tool details', async () => {
  //given
  const value = harness()
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
  assert.deepEqual((result as TodoToolResult).details.summary, {
    added: 2,
    updated: 1,
    started: 2,
    completed: 1,
    omitted: 1,
    restored: 1,
    cleared: 2,
  })
})

test('renders no changes on the collapsed todo call line', async () => {
  //given
  const value = harness(branchWithTodos, true)
  await restoreTodos(value)
  const tool = value.registeredTool
  assert.ok(tool)
  const renderCall = tool.renderCall
  const renderResult = tool.renderResult
  assert.ok(renderCall)
  assert.ok(renderResult)
  const state = {}
  const code = todoCode('return await todo.show()')
  const call = renderCall(code, value.theme, { state, expanded: false })

  //when
  const result = await tool.execute('todo-call', code, undefined, undefined, value.ctx)
  const rendered = renderResult(result, { expanded: false }, value.theme, { state, isError: false })

  //then
  assert.equal(call.render(120).join('\n').trimEnd(), 'todo · no changes (to expand)')
  assert.deepEqual(rendered.render(120), [])
})

test('rolls back all mutations when the program throws', async () => {
  //given
  const value = harness()
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
  assert.deepEqual((readOnly as TodoToolResult).details.summary, {
    added: 0,
    updated: 0,
    started: 0,
    completed: 0,
    omitted: 0,
    restored: 0,
    cleared: 0,
  })
})

test('commits mutations that remain after a caught API error', async () => {
  //given
  const value = harness()
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
  const details = (result as TodoToolResult).details
  assert.equal(details.output, 'kept')
  assert.deepEqual(details.summary, {
    added: 1,
    updated: 0,
    started: 0,
    completed: 0,
    omitted: 0,
    restored: 0,
    cleared: 0,
  })
  assert.equal(value.appendedEntries.length, 1)
})

test('does not append a snapshot or refresh the widget for a read-only program', async () => {
  //given
  const value = harness(branchWithTodos, true)
  await restoreTodos(value)
  const tool = value.registeredTool
  assert.ok(tool)
  const widget = value.widgets.get('todo')

  //when
  await tool.execute('todo-call', todoCode('return await todo.show()'), undefined, undefined, value.ctx)

  //then
  assert.deepEqual(value.appendedEntries, [])
  assert.equal(value.widgets.get('todo'), widget)
})

test('restores the durable snapshot and sends it during compaction', async () => {
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

test('keeps completed task states in the durable compaction snapshot', async () => {
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

test('restores state when the session branch changes', async () => {
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
  assert.equal((result as { details: { output: string } }).details.output, 'branch task')
})

test('preserves open task states when tree navigation carries a branch summary', async () => {
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

test('preserves newly added tasks when tree navigation carries an older snapshot', async () => {
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

test('suspends the todo tool while Plannotator executes the approved plan', async () => {
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

test('restores the tool when Plannotator returns to idle', async () => {
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

test('waits for asynchronous Plannotator status responses', async () => {
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

test('ignores a Plannotator response after the bounded wait expires', async () => {
  //given
  const value = harness(branchWithTodos, true, { phaseResponses: [{ phase: 'executing', delayMs: 300 }] })
  const input = value.events.get('input')
  assert.ok(input)

  //when
  await input({ type: 'input' }, value.ctx)
  await new Promise((resolve) => setTimeout(resolve, 350))

  //then
  assert.equal(value.activeTools.includes('todo'), true)
})

test('serializes concurrent phase transitions before updating the widget', async () => {
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
  input = value.events.get('input')
  assert.ok(input)

  //when
  await restoreTodos(value)
  await concurrentInput

  //then
  assert.equal(value.activeTools.includes('todo'), true)
  assert.notEqual(value.widgets.get('todo'), undefined)
})

test('returns typed errors when the host cannot append a snapshot', async () => {
  //given
  const cause = new Error('append failed')
  const value = harness([], true, { failure: { operation: 'appendEntry', error: cause } })
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
  assert.equal(Object.hasOwn((readOnly as TodoToolResult).details, 'todos'), false)
})

test('rolls back suspension when the active-tool host callback fails', async () => {
  //given
  const cause = new Error('tool update failed')
  const value = harness(branchWithTodos, true, {
    phase: 'executing',
    failure: { operation: 'setActiveTools', error: cause },
  })
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

test('returns typed errors when a host callback fails during compaction', async () => {
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

test('preserves the original program error through the transaction and tool layers', async () => {
  //given
  const value = harness()
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

test('renders operation summary on the collapsed todo call line without code line count', () => {
  //given
  const value = harness()
  const renderCall = value.registeredTool?.renderCall
  const renderResult = value.registeredTool?.renderResult
  assert.ok(renderCall)
  assert.ok(renderResult)
  const state = {}
  const call = renderCall({ code: 'line one\nline two' }, value.theme, { state, expanded: false })
  const result = {
    content: [{ type: 'text' as const, text: 'program output' }],
    details: {
      output: 'program output',
      truncated: false,
      summary: {
        added: 3,
        updated: 4,
        started: 1,
        completed: 1,
        omitted: 0,
        restored: 0,
        cleared: 0,
      },
      code: 'submitted code',
      codeTruncated: false,
      todos: [],
    },
  }

  //when
  const collapsed = renderResult(result, { expanded: false }, value.theme, { state, isError: false })

  //then
  assert.equal(
    call.render(120).join('\n').trimEnd(),
    'todo · added 3 · updated 4 · started 1 · completed 1 (to expand)',
  )
  assert.doesNotMatch(call.render(120).join('\n'), /lines/)
  assert.deepEqual(collapsed.render(120), [])
})

test('renders summary code and result in expanded todo output', () => {
  //given
  const value = harness()
  const renderResult = value.registeredTool?.renderResult
  assert.ok(renderResult)
  const result = {
    content: [{ type: 'text' as const, text: 'program output' }],
    details: {
      output: 'program output',
      truncated: false,
      summary: {
        added: 1,
        updated: 0,
        started: 1,
        completed: 0,
        omitted: 0,
        restored: 0,
        cleared: 0,
      },
      code: 'line one\nline two',
      codeTruncated: false,
      todos: [],
    },
  }

  //when
  const expanded = renderResult(result, { expanded: true }, value.theme, { isError: false })

  //then
  const lines = expanded.render(120)
  const text = lines.join('\n')
  const lineOneIndex = lines.findIndex((line) => line.includes('line one'))
  const lineTwoIndex = lines.findIndex((line) => line.includes('line two'))
  assert.match(text, /Summary/)
  assert.match(text, /added 1 · started 1/)
  assert.match(text, /Code/)
  assert.equal(lineTwoIndex, lineOneIndex + 1)
  assert.match(text, /Result/)
  assert.match(text, /program output/)
})

test('renders an empty summary in expanded todo output', () => {
  //given
  const value = harness()
  const renderResult = value.registeredTool?.renderResult
  assert.ok(renderResult)
  const result = {
    content: [{ type: 'text' as const, text: 'program output' }],
    details: {
      output: 'program output',
      truncated: false,
      summary: {
        added: 0,
        updated: 0,
        started: 0,
        completed: 0,
        omitted: 0,
        restored: 0,
        cleared: 0,
      },
      code: 'submitted code',
      codeTruncated: false,
      todos: [],
    },
  }

  //when
  const expanded = renderResult(result, { expanded: true }, value.theme, { isError: false })

  //then
  assert.match(expanded.render(120).join('\n'), /Summary[\s\S]*no changes/)
})

test('renders a code truncation notice in expanded todo output', () => {
  //given
  const value = harness()
  const renderResult = value.registeredTool?.renderResult
  assert.ok(renderResult)
  const result = {
    content: [{ type: 'text' as const, text: 'program output' }],
    details: {
      output: 'program output',
      truncated: false,
      summary: {
        added: 0,
        updated: 0,
        started: 0,
        completed: 0,
        omitted: 0,
        restored: 0,
        cleared: 0,
      },
      code: 'partial code',
      codeTruncated: true,
      todos: [],
    },
  }

  //when
  const expanded = renderResult(result, { expanded: true }, value.theme, { isError: false })

  //then
  const text = expanded.render(120).join('\n')
  assert.match(text, /Code \(truncated\)/)
  assert.match(text, /partial code/)
})

test('renders errors through the tool error channel', () => {
  //given
  const value = harness()
  const renderResult = value.registeredTool?.renderResult
  assert.ok(renderResult)

  //when
  const rendered = renderResult(
    { content: [{ type: 'text', text: 'program failed' }] },
    { expanded: false },
    value.theme,
    { isError: true },
  )

  //then
  assert.match(rendered.render(120).join('\n'), /program failed/)
})

test('renders collapsed and expanded program output', () => {
  //given
  const value = harness()
  const renderCall = value.registeredTool?.renderCall
  const renderResult = value.registeredTool?.renderResult
  assert.ok(renderCall)
  assert.ok(renderResult)
  const state = {}
  const code = { code: 'submitted code' }
  const call = renderCall(code, value.theme, { state, expanded: false })
  const result = {
    content: [{ type: 'text', text: 'program output' }],
    details: { output: 'program output', truncated: false, todos: [] },
  }

  //when
  const collapsed = renderResult(result, { expanded: false }, value.theme, { state, isError: false })
  const expandedCall = renderCall(code, value.theme, { state, expanded: true })
  const expanded = renderResult(result, { expanded: true }, value.theme, { state, isError: false })

  //then
  assert.equal(call.render(120).join('\n').trimEnd(), 'todo (to expand)')
  assert.deepEqual(collapsed.render(120), [])
  assert.equal(expandedCall.render(120).join('\n').trimEnd(), 'todo')
  assert.doesNotMatch(expandedCall.render(120).join('\n'), /to expand/)
  assert.match(expanded.render(120).join('\n'), /program output/)
  assert.match(expanded.render(120).join('\n'), /Submitted code unavailable/)
})

test('opens /todos while tracking is active', async () => {
  //given
  const value = harness(branchWithTodos, true)
  await restoreTodos(value)
  const command = value.registeredCommand?.handler
  assert.ok(command)

  //when
  await command('', value.ctx)

  //then
  assert.deepEqual(value.notifications, [])
})

test('renders dependency indentation in /todos', async () => {
  //given
  const value = harness(branchWithTodos, true)
  await restoreTodos(value)
  const command = value.registeredCommand?.handler
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

test('indents expanded todo details with dependency depth', async () => {
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

test('renders todo details when tool output expands after widget creation', async () => {
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

test('keeps expanded todo details within a narrow widget width', async () => {
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

test('reports typed UI errors from /todos', async () => {
  //given
  const cause = new Error('viewer failed')
  const value = harness(branchWithTodos, true, { customError: cause })
  await restoreTodos(value)
  const command = value.registeredCommand?.handler
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
