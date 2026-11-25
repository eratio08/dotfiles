import assert from 'node:assert/strict'
import test from 'node:test'
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'
import handoffExtension from '../index.ts'
import { getHandoffMessages, HANDOFF_MODEL_APPLIED_ENTRY, HANDOFF_MODEL_ENTRY } from '../src/extension.ts'

type Action =
  | { kind: 'append'; customType: string; data: unknown }
  | { kind: 'message'; message: unknown; options: unknown }
  | { kind: 'user'; content: string }

type HarnessOptions = {
  branch?: readonly unknown[]
  prompt?: string | null
  promptError?: Error
  navigationCancelled?: boolean
  restoredModel?: unknown
}

type EventHandler = (event: { type?: string }, ctx: ExtensionContext) => Promise<void>

type Harness = {
  pi: ExtensionAPI
  command: (args: string, ctx: ExtensionCommandContext) => Promise<void>
  beforeAgentStart: EventHandler
  sessionShutdown: EventHandler
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
      type: 'custom',
      id: 'todo-state',
      parentId: 'root',
      timestamp: new Date().toISOString(),
      customType: 'todo',
      data: {
        todos: [
          {
            id: '018f00000000-7000-8000-0000-000000000001',
            content: 'active work',
            status: 'in_progress',
            dependsOn: [],
          },
          { id: '018f00000001-7000-8000-0000-000000000002', content: 'later work', status: 'pending', dependsOn: [] },
        ],
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
  const setModelCalls: unknown[] = []
  const thinkingLevels: string[] = []
  const model = { provider: 'test-provider', id: 'test-model' }
  const pendingModel = options.restoredModel
  const events = new Map<string, EventHandler>()
  let command: Harness['command'] | undefined

  const pi = {
    on(event: string, handler: EventHandler): void {
      events.set(event, handler)
    },
    registerCommand(_name: string, options: { handler: Harness['command'] }): void {
      command = options.handler
    },
    appendEntry(customType: string, data: Parameters<ExtensionAPI['appendEntry']>[1]): void {
      actions.push({ kind: 'append', customType, data })
    },
    sendMessage(
      message: Parameters<ExtensionAPI['sendMessage']>[0],
      options: Parameters<ExtensionAPI['sendMessage']>[1],
    ): void {
      actions.push({ kind: 'message', message, options })
    },
    sendUserMessage(content: string): void {
      actions.push({ kind: 'user', content })
    },
    setModel: async (value: Parameters<ExtensionAPI['setModel']>[0]): Promise<boolean> => {
      setModelCalls.push(value)
      return true
    },
    setThinkingLevel(level: string): void {
      thinkingLevels.push(level)
    },
    getThinkingLevel(): 'medium' {
      return 'medium'
    },
  } as ExtensionAPI

  handoffExtension(pi)

  const context = {
    ...({} as ExtensionCommandContext),
    ui: {
      ...({} as ExtensionContext['ui']),
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
      getSessionFile: () => sessionFile,
      getSessionId: () => sessionId,
      getEntries: () => branch,
    } as ExtensionContext['sessionManager'],
    modelRegistry: Object.assign({} as ExtensionContext['modelRegistry'], {
      find: () => pendingModel as ReturnType<ExtensionContext['modelRegistry']['find']>,
      complete: async (): Promise<never> => {
        throw new Error('model completion should not run in this harness')
      },
    }),
    model: model as ExtensionContext['model'],
    scopedModels: [],
    thinkingLevel: 'high',
    signal: undefined,
    isIdle: () => true,
    waitForIdle: async (): Promise<void> => {
      waitForIdleCalls += 1
    },
    navigateTree: async (
      targetId: string,
      navigationOptions: Parameters<ExtensionCommandContext['navigateTree']>[1],
    ): Promise<{ cancelled: boolean }> => {
      navigation.push({ targetId, options: navigationOptions })
      return { cancelled: options.navigationCancelled ?? false }
    },
    newSession: async (): Promise<never> => {
      newSessionCalls += 1
      throw new Error('newSession must not be called')
    },
  } as ExtensionCommandContext

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
    get waitForIdleCalls(): number {
      return waitForIdleCalls
    },
  }
}

test('should keep message order and the latest summary given a compacted branch', () => {
  const before = { role: 'user', content: 'old', timestamp: 1 }
  const kept = { role: 'user', content: 'kept', timestamp: 2 }
  const after = { role: 'user', content: 'new', timestamp: 3 }
  const branch = [
    { type: 'message', id: 'old', message: before },
    { type: 'custom', id: 'custom' },
    { type: 'message', id: 'kept', message: kept },
    {
      type: 'compaction',
      id: 'compact',
      firstKeptEntryId: 'kept',
      summary: 'summary',
      tokensBefore: 10,
      timestamp: '2024-01-01T00:00:00Z',
    },
    { type: 'message', id: 'after', message: after },
  ] as SessionEntry[]

  assert.deepEqual(getHandoffMessages(branch.slice(0, 3)), [before, kept])
  assert.deepEqual(getHandoffMessages(branch), [
    { role: 'compactionSummary', summary: 'summary', tokensBefore: 10, timestamp: Date.parse('2024-01-01T00:00:00Z') },
    kept,
    after,
  ])
})

test('should branch in the current session and preserve continuation ordering given a handoff request', async () => {
  //given
  const harness = makeHarness({ prompt: 'Continue from the generated handoff.' })

  //when
  await harness.command('', harness.context)

  //then
  assert.equal(harness.waitForIdleCalls, 1)
  assert.deepEqual(harness.navigation, [{ targetId: 'root', options: { summarize: false } }])
  assert.deepEqual(
    harness.actions.map((action) => action.kind),
    ['append', 'append', 'message', 'user'],
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
  const todoEntry = harness.actions[1]
  assert.equal(todoEntry.kind, 'append')
  assert.equal(todoEntry.customType, 'todo')
  assert.deepEqual(todoEntry.data, {
    todos: [
      { id: '018f00000000-7000-8000-0000-000000000001', content: 'active work', status: 'in_progress', dependsOn: [] },
      { id: '018f00000001-7000-8000-0000-000000000002', content: 'later work', status: 'pending', dependsOn: [] },
    ],
  })
  assert.deepEqual(
    harness.actions.filter((action) => action.kind === 'append' && action.customType === 'todo'),
    [todoEntry],
  )
  const todoAction = harness.actions[2]
  assert.equal(todoAction.kind, 'message')
  assert.deepEqual(todoAction.options, { triggerTurn: false })
  assert.deepEqual(todoAction.message, {
    customType: 'todo',
    content: (todoAction.message as { content: string }).content,
    display: false,
  })
  assert.match((todoAction.message as { content: string }).content, /TODO STATUS/)
  assert.deepEqual(harness.actions[3], { kind: 'user', content: 'Continue from the generated handoff.' })
  assert.deepEqual(harness.branch, harness.originalBranch)
  assert.equal(harness.sessionFile, '/tmp/handoff-session.jsonl')
  assert.equal(harness.sessionId, 'handoff-session')
})

test('should continue given no Todo items', async () => {
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

test('should leave the current branch unchanged given cancelled generation', async () => {
  //given
  const harness = makeHarness({ prompt: null })

  //when
  await harness.command('', harness.context)

  //then
  assert.deepEqual(harness.navigation, [])
  assert.deepEqual(harness.actions, [])
  assert.deepEqual(harness.notifications, [{ message: 'Cancelled', type: 'info' }])
})

test('should leave the current branch unchanged given cancelled navigation', async () => {
  //given
  const harness = makeHarness({ prompt: 'Continue.', navigationCancelled: true })

  //when
  await harness.command('', harness.context)

  //then
  assert.deepEqual(harness.navigation, [{ targetId: 'root', options: { summarize: false } }])
  assert.deepEqual(harness.actions, [])
  assert.deepEqual(harness.notifications, [{ message: 'Branch cancelled', type: 'info' }])
})

test('should report generation failures and avoid navigation given a failed generation', async () => {
  //given
  const harness = makeHarness({ promptError: new Error('generation failed') })

  //when
  await harness.command('', harness.context)

  //then
  assert.deepEqual(harness.navigation, [])
  assert.deepEqual(harness.actions, [])
  assert.deepEqual(harness.notifications, [{ message: 'generation failed', type: 'error' }])
})

test('should dispose the runtime once given repeated shutdown events', async () => {
  //given
  const harness = makeHarness()
  const context = harness.context

  //when
  await harness.sessionShutdown({}, context)
  await harness.sessionShutdown({}, context)

  //then
  assert.deepEqual(harness.actions, [])
  assert.deepEqual(harness.notifications, [])
})

test('should restore the pending model given the next agent turn', async () => {
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
    ui: {
      ...({} as ExtensionContext['ui']),
      notify: (message: string, type?: string) => harness.notifications.push({ message, type }),
    },
    sessionManager: { getBranch: () => [pendingModel] } as ExtensionContext['sessionManager'],
    modelRegistry: Object.assign({} as ExtensionContext['modelRegistry'], {
      find: () =>
        ({ provider: 'test-provider', id: 'test-model' }) as ReturnType<ExtensionContext['modelRegistry']['find']>,
    }),
    signal: undefined,
  } as ExtensionContext

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
