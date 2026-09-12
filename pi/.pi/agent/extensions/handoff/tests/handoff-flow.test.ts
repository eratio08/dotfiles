import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent'
import handoffExtension from '../index.ts'
import { HANDOFF_MODEL_APPLIED_ENTRY, HANDOFF_MODEL_ENTRY } from '../src/handoff-model.ts'

type Action =
  | { kind: 'append'; customType: string; data: unknown }
  | { kind: 'message'; message: unknown; options: unknown }
  | { kind: 'label'; entryId: string; label: string }
  | { kind: 'user'; content: string }

type HarnessOptions = {
  branch?: readonly unknown[]
  prompt?: string | null
  promptError?: Error
  navigationCancelled?: boolean
  restoredModel?: unknown
}

type Harness = {
  pi: ExtensionAPI
  command: (args: string, ctx: ExtensionCommandContext) => Promise<void>
  beforeAgentStart: (event: unknown, ctx: ExtensionContext) => Promise<unknown>
  sessionShutdown: (event: unknown, ctx: ExtensionContext) => Promise<unknown>
  actions: Action[]
  notifications: Array<{ message: string; type: string | undefined }>
  navigation: Array<{ targetId: string; options: unknown }>
  branch: readonly unknown[]
  sessionFile: string
  sessionId: string
  waitForIdleCalls: number
  context: ExtensionCommandContext
  originalBranch: readonly unknown[]
  setModelCalls: unknown[]
  thinkingLevels: string[]
  newSessionCalls: number
}

function makeBranch(withTodos = false): readonly unknown[] {
  const entries: unknown[] = [
    {
      type: 'message',
      id: 'root',
      parentId: null,
      timestamp: new Date().toISOString(),
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'Continue the work.' }],
        timestamp: Date.now(),
      },
    },
  ]
  if (withTodos) {
    entries.push({
      type: 'message',
      id: 'todo-result',
      parentId: 'root',
      timestamp: new Date().toISOString(),
      message: {
        role: 'toolResult',
        toolCallId: 'todo-call',
        toolName: 'todowrite',
        content: [{ type: 'text', text: 'Todo state' }],
        isError: false,
        timestamp: Date.now(),
        details: {
          todos: [
            { content: 'active work', status: 'in_progress', priority: 'high' },
            { content: 'later work', status: 'pending', priority: 'low' },
          ],
        },
      },
    })
  }
  return entries
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const actions: Action[] = []
  const notifications: Array<{ message: string; type: string | undefined }> = []
  const navigation: Array<{ targetId: string; options: unknown }> = []
  const branch = options.branch ?? makeBranch(true)
  const originalBranch = [...branch]
  const sessionFile = '/tmp/handoff-session.jsonl'
  const sessionId = 'handoff-session'
  let waitForIdleCalls = 0
  let newSessionCalls = 0
  let leafId = (branch.at(-1) as { id?: string } | undefined)?.id ?? null
  const setModelCalls: unknown[] = []
  const thinkingLevels: string[] = []
  const model = { provider: 'test-provider', id: 'test-model' }
  const pendingModel = options.restoredModel
  const events = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<unknown>>()
  let command: Harness['command'] | undefined

  const pi = {
    on(event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<unknown>): void {
      events.set(event, handler)
    },
    registerCommand(_name: string, options: { handler: Harness['command'] }): void {
      command = options.handler
    },
    appendEntry(customType: string, data: unknown): void {
      actions.push({ kind: 'append', customType, data })
    },
    sendMessage(message: unknown, options: unknown): void {
      actions.push({ kind: 'message', message, options })
      leafId = 'todo-entry'
    },
    setLabel(entryId: string, label: string): void {
      actions.push({ kind: 'label', entryId, label })
    },
    sendUserMessage(content: string): void {
      actions.push({ kind: 'user', content })
    },
    setModel: async (value: unknown): Promise<boolean> => {
      setModelCalls.push(value)
      return true
    },
    setThinkingLevel(level: string): void {
      thinkingLevels.push(level)
    },
    getThinkingLevel(): 'medium' {
      return 'medium'
    },
  } as unknown as ExtensionAPI

  handoffExtension(pi)

  const context = {
    ui: {
      custom: async <T>(): Promise<T> => {
        if (options.promptError) {
          throw options.promptError
        }
        return options.prompt as T
      },
      notify(message: string, type?: 'info' | 'warning' | 'error'): void {
        notifications.push({ message, type })
      },
    },
    mode: 'tui',
    hasUI: true,
    cwd: '/tmp',
    sessionManager: {
      getBranch: () => branch,
      getLeafId: () => leafId,
      getSessionFile: () => sessionFile,
      getSessionId: () => sessionId,
      getEntries: () => branch,
    },
    modelRegistry: {
      find: () => pendingModel,
      complete: async (): Promise<never> => {
        throw new Error('model completion should not run in this harness')
      },
    },
    model,
    scopedModels: [],
    thinkingLevel: 'high',
    signal: undefined,
    isIdle: () => true,
    waitForIdle: async (): Promise<void> => {
      waitForIdleCalls += 1
    },
    navigateTree: async (targetId: string, navigationOptions: unknown): Promise<{ cancelled: boolean }> => {
      navigation.push({ targetId, options: navigationOptions })
      return { cancelled: options.navigationCancelled ?? false }
    },
    newSession: async (): Promise<never> => {
      newSessionCalls += 1
      throw new Error('newSession must not be called')
    },
  } as unknown as ExtensionCommandContext

  const beforeAgentStart = events.get('before_agent_start')
  const sessionShutdown = events.get('session_shutdown')
  if (!command || !beforeAgentStart || !sessionShutdown) {
    throw new Error('handoff extension did not register expected handlers')
  }

  return {
    pi,
    command,
    beforeAgentStart,
    sessionShutdown,
    actions,
    notifications,
    navigation,
    branch,
    sessionFile,
    sessionId,
    context,
    originalBranch,
    setModelCalls,
    thinkingLevels,
    newSessionCalls,
    get waitForIdleCalls() {
      return waitForIdleCalls
    },
  }
}

test('branches in the current session and preserves continuation ordering', async () => {
  //given
  const harness = makeHarness({ prompt: 'Continue from the generated handoff.' })

  //when
  await harness.command('', harness.context)

  //then
  assert.equal(harness.waitForIdleCalls, 1)
  assert.deepEqual(harness.navigation, [{ targetId: 'root', options: { summarize: false } }])
  assert.deepEqual(
    harness.actions.map((action) => action.kind),
    ['append', 'message', 'label', 'user'],
  )
  const modelEntry = harness.actions[0]
  assert.equal(modelEntry.kind, 'append')
  assert.equal(modelEntry.customType, HANDOFF_MODEL_ENTRY)
  assert.deepEqual(modelEntry.data, {
    provider: 'test-provider',
    modelId: 'test-model',
    thinkingLevel: 'high',
  })
  assert.equal(harness.newSessionCalls, 0)
  const todoAction = harness.actions[1]
  assert.equal(todoAction.kind, 'message')
  assert.deepEqual(todoAction.options, { triggerTurn: false })
  assert.deepEqual(todoAction.message, {
    customType: 'todo',
    content: (todoAction.message as { content: string }).content,
    display: false,
    details: {
      todos: [
        { content: 'active work', status: 'in_progress', priority: 'high' },
        { content: 'later work', status: 'pending', priority: 'low' },
      ],
    },
  })
  assert.match((todoAction.message as { content: string }).content, /TODO STATUS/)
  assert.deepEqual(harness.actions[2], { kind: 'label', entryId: 'todo-entry', label: 'Handoff 1' })
  assert.deepEqual(harness.actions[3], { kind: 'user', content: 'Continue from the generated handoff.' })
  assert.deepEqual(harness.branch, harness.originalBranch)
  assert.equal(harness.sessionFile, '/tmp/handoff-session.jsonl')
  assert.equal(harness.sessionId, 'handoff-session')
})

test('increments the handoff tree label number', async () => {
  //given
  const branch = [
    ...makeBranch(true),
    {
      type: 'custom',
      id: 'previous-handoff',
      parentId: 'todo-result',
      timestamp: new Date().toISOString(),
      customType: HANDOFF_MODEL_ENTRY,
      data: {},
    },
  ]
  const harness = makeHarness({ branch, prompt: 'Continue from the next handoff.' })

  //when
  await harness.command('', harness.context)

  //then
  assert.deepEqual(harness.actions[2], { kind: 'label', entryId: 'todo-entry', label: 'Handoff 2' })
})

test('continues without Todo items', async () => {
  //given
  const harness = makeHarness({ branch: makeBranch(false), prompt: 'Continue without Todo state.' })

  //when
  await harness.command('', harness.context)

  //then
  assert.deepEqual(harness.navigation, [{ targetId: 'root', options: { summarize: false } }])
  assert.deepEqual(
    harness.actions.map((action) => action.kind),
    ['append', 'user'],
  )
  assert.deepEqual(harness.actions[1], { kind: 'user', content: 'Continue without Todo state.' })
})

test('leaves the current branch unchanged when generation is cancelled', async () => {
  //given
  const harness = makeHarness({ prompt: null })

  //when
  await harness.command('', harness.context)

  //then
  assert.deepEqual(harness.navigation, [])
  assert.deepEqual(harness.actions, [])
  assert.deepEqual(harness.notifications, [{ message: 'Cancelled', type: 'info' }])
})

test('leaves the current branch unchanged when navigation is cancelled', async () => {
  //given
  const harness = makeHarness({ prompt: 'Continue.', navigationCancelled: true })

  //when
  await harness.command('', harness.context)

  //then
  assert.deepEqual(harness.navigation, [{ targetId: 'root', options: { summarize: false } }])
  assert.deepEqual(harness.actions, [])
  assert.deepEqual(harness.notifications, [{ message: 'Branch cancelled', type: 'info' }])
})

test('reports generation failures without navigating', async () => {
  //given
  const harness = makeHarness({ promptError: new Error('generation failed') })

  //when
  await harness.command('', harness.context)

  //then
  assert.deepEqual(harness.navigation, [])
  assert.deepEqual(harness.actions, [])
  assert.deepEqual(harness.notifications, [{ message: 'generation failed', type: 'error' }])
})

test('disposes the runtime once when shutdown repeats', async () => {
  //given
  const harness = makeHarness()
  const context = harness.context as unknown as ExtensionContext

  //when
  await harness.sessionShutdown({}, context)
  await harness.sessionShutdown({}, context)

  //then
  assert.deepEqual(harness.actions, [])
  assert.deepEqual(harness.notifications, [])
})

test('restores the pending model before the agent turn', async () => {
  //given
  const pendingModel = {
    type: 'custom',
    id: 'handoff-model-entry',
    customType: HANDOFF_MODEL_ENTRY,
    data: { provider: 'test-provider', modelId: 'test-model', thinkingLevel: 'high' },
  }
  const harness = makeHarness({
    branch: [pendingModel],
    restoredModel: { provider: 'test-provider', id: 'test-model' },
  })
  const context = {
    ...({} as ExtensionContext),
    hasUI: true,
    ui: { notify: (message: string, type?: string) => harness.notifications.push({ message, type }) },
    sessionManager: { getBranch: () => [pendingModel] },
    modelRegistry: { find: () => ({ provider: 'test-provider', id: 'test-model' }) },
    signal: undefined,
  } as unknown as ExtensionContext

  //when
  await harness.beforeAgentStart({}, context)

  //then
  assert.deepEqual(harness.actions, [
    {
      kind: 'append',
      customType: HANDOFF_MODEL_APPLIED_ENTRY,
      data: { sourceId: 'handoff-model-entry', applied: true, reason: undefined },
    },
  ])
  assert.deepEqual(harness.notifications, [])
  assert.deepEqual(harness.setModelCalls, [{ provider: 'test-provider', id: 'test-model' }])
  assert.deepEqual(harness.thinkingLevels, ['high'])
})
