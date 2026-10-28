import assert from 'node:assert/strict'
import test from 'node:test'
import type { Model } from '@earendil-works/pi-ai'
import { Pi, PiContext, type PiContextTag, PiSession, PiUi } from '@eratio08/pi-effect'
import { Effect, Layer, ManagedRuntime } from 'effect'
import lowContextModeExtension, {
  LOW_CONTEXT_WINDOW as PUBLIC_LOW_CONTEXT_WINDOW,
  parseLowContextCommand as publicParseLowContextCommand,
  restoreLowContextMode as publicRestoreLowContextMode,
} from '../index.ts'
import {
  contextModeEmoji,
  contextModel,
  type LowContextMode,
  type LowContextModeError,
  LowContextModeLayer,
  LowContextModeService,
  LowContextModeState,
  modelKey,
  parseLowContextCommand,
  restoreLowContextMode,
} from '../src/extension.ts'

const LARGE_CONTEXT_WINDOW = 1_050_000

type ContextTestModel = Model<'openai-responses'>
type NotificationType = 'info' | 'warning' | 'error'
type Notification = { message: string; type: NotificationType }
type Status = { key: string; value: string | undefined }
type ServiceProgram<A> = Effect.Effect<
  A,
  LowContextModeError,
  LowContextModeService | LowContextModeState | Pi | PiContextTag | PiSession | PiUi
>
type LayerHarness = {
  run<A>(use: (service: LowContextModeService['Service']) => ServiceProgram<A>): Promise<A>
  setEntries(entries: unknown[]): void
  snapshot(): {
    activeModel: ContextTestModel
    modelChanges: ContextTestModel[]
    notifications: Notification[]
    savedModes: Array<{ mode: LowContextMode }>
    statuses: Status[]
  }
  dispose(): Promise<void>
}
type LayerHarnessOptions = {
  hasUI?: boolean
  initialModel?: ContextTestModel
  setModelFailure?: unknown
  setModelRejected?: boolean
  registeredModels?: ContextTestModel[]
}

function model(contextWindow = 272000, id = 'gpt-5.6-sol'): ContextTestModel {
  return {
    id,
    name: `GPT-5.6 ${id.slice(-3)}`,
    api: 'openai-responses',
    provider: 'github-copilot',
    baseUrl: 'https://api.enterprise.githubcopilot.com',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
    contextWindow,
    maxTokens: 128000,
  }
}

function createLayerHarness(options: LayerHarnessOptions = {}): LayerHarness {
  let activeModel = options.initialModel ?? model()
  let entries: unknown[] = []
  const modelChanges: ContextTestModel[] = []
  const notifications: Notification[] = []
  const savedModes: Array<{ mode: LowContextMode }> = []
  const statuses: Status[] = []
  const pi = {
    model: {
      set: (nextModel: ContextTestModel): Effect.Effect<boolean, LowContextModeError> =>
        options.setModelFailure === undefined
          ? Effect.sync(() => {
              if (options.setModelRejected) return false
              activeModel = nextModel
              modelChanges.push(nextModel)
              return true
            })
          : Effect.fail(options.setModelFailure as LowContextModeError),
    },
  }
  const context = {
    mode: 'tui',
    hasUI: options.hasUI ?? true,
    get model(): ContextTestModel {
      return activeModel
    },
    findModel: (provider: string, id: string): Effect.Effect<ContextTestModel | undefined> =>
      Effect.succeed(
        (options.registeredModels ?? [options.initialModel ?? model()]).find(
          (item) => item.provider === provider && item.id === id,
        ),
      ),
  }
  const session = {
    branch: (): Effect.Effect<unknown[]> => Effect.succeed(entries),
    appendEntry: (_type: string, data: { mode: LowContextMode }): Effect.Effect<void> =>
      Effect.sync(() => {
        savedModes.push(data)
      }),
  }
  const ui = {
    notify: (message: string, type: NotificationType): Effect.Effect<void> =>
      Effect.sync(() => {
        if (options.hasUI !== false) notifications.push({ message, type })
      }),
    setStatus: (key: string, value: string | undefined): Effect.Effect<void> =>
      Effect.sync(() => {
        if (options.hasUI !== false) statuses.push({ key, value })
      }),
    theme: (): Effect.Effect<undefined> => Effect.succeed(undefined),
  }
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      LowContextModeLayer,
      LowContextModeState.layer,
      Layer.succeed(Pi, pi as never),
      Layer.succeed(PiContext, context as never),
      Layer.succeed(PiSession, session as never),
      Layer.succeed(PiUi, ui as never),
    ),
  )
  const run = <A>(use: (service: LowContextModeService['Service']) => ServiceProgram<A>): Promise<A> =>
    runtime.runPromise(LowContextModeService.use(use) as never)

  return {
    run,
    setEntries(nextEntries: unknown[]): void {
      entries = nextEntries
    },
    snapshot(): ReturnType<LayerHarness['snapshot']> {
      return {
        activeModel,
        modelChanges: [...modelChanges],
        notifications: [...notifications],
        savedModes: [...savedModes],
        statuses: [...statuses],
      }
    },
    dispose: () => runtime.dispose(),
  }
}

async function withLayerHarness<A>(
  use: (harness: LayerHarness) => Promise<A>,
  options?: LayerHarnessOptions,
): Promise<A> {
  const harness = createLayerHarness(options)
  try {
    return await use(harness)
  } finally {
    await harness.dispose()
  }
}

type ExtensionHarness = {
  commands: Map<string, (args: string, context: unknown) => Promise<void>>
  events: Map<string, (event: unknown, context: unknown) => Promise<unknown>>
  modelChanges: ContextTestModel[]
  notifications: Notification[]
  statuses: Status[]
  savedEntries: Array<{ type: string; data: { mode: LowContextMode } }>
  context: unknown
  setEntries(entries: unknown[]): void
  setBranch(entries: unknown[]): void
}

async function createExtensionHarness(options: LayerHarnessOptions = {}): Promise<ExtensionHarness> {
  let activeModel = options.initialModel ?? model()
  let entries: unknown[] = []
  let branch: unknown[] | undefined
  const commands = new Map<string, (args: string, context: unknown) => Promise<void>>()
  const events = new Map<string, (event: unknown, context: unknown) => Promise<unknown>>()
  const modelChanges: ContextTestModel[] = []
  const notifications: Notification[] = []
  const statuses: Status[] = []
  const savedEntries: Array<{ type: string; data: { mode: LowContextMode } }> = []
  const api = {
    on: (name: string, handler: (event: unknown, context: unknown) => Promise<unknown>): void => {
      events.set(name, handler)
    },
    registerCommand: (
      name: string,
      definition: { handler: (args: string, context: unknown) => Promise<void> },
    ): void => {
      commands.set(name, definition.handler)
    },
    appendEntry: (type: string, data: { mode: LowContextMode }): void => {
      savedEntries.push({ type, data })
    },
    setModel: async (nextModel: ContextTestModel): Promise<boolean> => {
      if (options.setModelFailure !== undefined) throw options.setModelFailure
      if (options.setModelRejected) return false
      activeModel = nextModel
      modelChanges.push(nextModel)
      await events.get('model_select')?.({ model: nextModel }, context)
      return true
    },
  }
  const context = {
    mode: 'tui',
    hasUI: options.hasUI ?? true,
    cwd: process.cwd(),
    signal: undefined,
    get model(): ContextTestModel {
      return activeModel
    },
    modelRegistry: {
      find: (provider: string, id: string): ContextTestModel | undefined =>
        (options.registeredModels ?? [options.initialModel ?? model()]).find(
          (item) => item.provider === provider && item.id === id,
        ),
    },
    ui: {
      notify: (message: string, type: NotificationType): void => {
        notifications.push({ message, type })
      },
      setStatus: (key: string, value: string | undefined): void => {
        statuses.push({ key, value })
      },
      theme: undefined,
    },
    sessionManager: {
      getCwd: (): string => process.cwd(),
      getSessionId: (): string => 'test-session',
      getSessionFile: (): undefined => undefined,
      getSessionDir: (): string => process.cwd(),
      getLeafId: (): null => null,
      getLeafEntry: (): undefined => undefined,
      getEntries: (): unknown[] => entries,
      getTree: (): unknown[] => [],
      getEntry: (): undefined => undefined,
      getBranch: (): unknown[] => branch ?? entries,
      buildContextEntries: (): unknown[] => [],
      getLabel: (): undefined => undefined,
      getSessionName: (): undefined => undefined,
    },
  }
  await lowContextModeExtension(api as never)
  return {
    commands,
    events,
    modelChanges,
    notifications,
    statuses,
    savedEntries,
    context,
    setEntries(nextEntries: unknown[]): void {
      entries = nextEntries
    },
    setBranch(nextBranch: unknown[]): void {
      branch = nextBranch
    },
  }
}

test('should export the low context window given an extension entry-point import', () => {
  //given
  const expected = 272_000

  //when
  const actual = PUBLIC_LOW_CONTEXT_WINDOW

  //then
  assert.equal(actual, expected)
})

test('should export command parsing and persistence helpers given a module import', () => {
  //given
  const entries = [{ type: 'custom', customType: 'low-context-mode', data: { mode: 'off' } }]

  //when
  const parsed = publicParseLowContextCommand('toggle', 'on')
  const restored = publicRestoreLowContextMode(entries)

  //then
  assert.equal(parsed, 'off')
  assert.equal(restored, 'off')
})

test('should parse commands and restore the latest saved mode given command input and persisted state', () => {
  //given
  const entries = [
    { type: 'custom', customType: 'low-context-mode', data: { mode: 'off' } },
    { type: 'custom', customType: 'low-context-mode', data: { mode: 'on' } },
  ]

  //when
  const parsed = parseLowContextCommand('', 'off')
  const restored = restoreLowContextMode(entries)

  //then
  assert.equal(parsed, 'on')
  assert.equal(restored, 'on')
})

test('should change only the context window given a mode transition', () => {
  //given
  const source = model()

  //when
  const changed = contextModel(source, 'off', LARGE_CONTEXT_WINDOW)

  //then
  assert.equal(changed.id, source.id)
  assert.equal(changed.contextWindow, LARGE_CONTEXT_WINDOW)
})

test('should build stable model keys and display off mode given model configuration', () => {
  //given
  const selectedModel = model()

  //when
  const result = [modelKey(selectedModel), contextModeEmoji('off')]

  //then
  assert.deepEqual(result, ['github-copilot/gpt-5.6-sol', '🚀'])
})

test('should restore and persist off mode given shared services', async () => {
  //given
  const outcome = await withLayerHarness(
    async (harness) => {
      await harness.run((service) => service.handleCommand('off'))
      return harness.snapshot()
    },
    { registeredModels: [model(LARGE_CONTEXT_WINDOW)] },
  )

  //when
  const modelChange = outcome.modelChanges.at(-1)

  //then
  assert.equal(modelChange?.contextWindow, LARGE_CONTEXT_WINDOW)
  assert.deepEqual(outcome.savedModes, [{ mode: 'off' }])
  assert.match(outcome.statuses.at(-1)?.value ?? '', /context: 🚀/)
})

test('should use the shared low window given a transition from off mode', async () => {
  //given
  const source = model(LARGE_CONTEXT_WINDOW, 'gpt-5.6-luna')

  //when
  const outcome = await withLayerHarness(async (harness) => {
    await harness.run((service) => service.applyModel(source))
    return harness.snapshot()
  })

  //then
  assert.equal(outcome.modelChanges.at(-1)?.contextWindow, 272_000)
})

test('should set any GPT model to the shared low window and restore its original window', async () => {
  //given
  const source = model(1_000_000, 'gpt-6.1-sol')

  //when
  const outcome = await withLayerHarness(async (harness) => {
    await harness.run((service) => service.applyModel(source))
    await harness.run((service) => service.handleCommand('off'))
    return harness.snapshot()
  })

  //then
  assert.deepEqual(
    outcome.modelChanges.map((changed) => changed.contextWindow),
    [272_000, 1_000_000],
  )
})

test('should restore saved mode given the shared session service', async () => {
  //given
  const entries = [{ type: 'custom', customType: 'low-context-mode', data: { mode: 'off' } }]

  //when
  const outcome = await withLayerHarness(
    async (harness) => {
      harness.setEntries(entries)
      const mode = await harness.run((service) => service.restore())
      return { mode, snapshot: harness.snapshot() }
    },
    { registeredModels: [model(LARGE_CONTEXT_WINDOW)] },
  )

  //then
  assert.equal(outcome.mode, 'off')
  assert.equal(outcome.snapshot.modelChanges.at(-1)?.contextWindow, LARGE_CONTEXT_WINDOW)
})

test('should warn and preserve state given an invalid command', async () => {
  //given
  const outcome = await withLayerHarness(async (harness) => {
    await harness.run((service) => service.handleCommand('unknown'))
    return harness.snapshot()
  })

  //when
  const notification = outcome.notifications.at(-1)

  //then
  assert.equal(notification?.type, 'warning')
  assert.equal(outcome.modelChanges.length, 0)
  assert.deepEqual(outcome.savedModes, [])
})

test('should recover state given a model change failure', async () => {
  //given
  const outcome = await withLayerHarness(
    async (harness) => {
      await harness.run((service) => service.handleCommand('off'))
      return harness.snapshot()
    },
    { setModelFailure: new Error('model unavailable'), registeredModels: [model(LARGE_CONTEXT_WINDOW)] },
  )

  //when
  const notification = outcome.notifications.at(-1)

  //then
  assert.equal(notification?.type, 'error')
  assert.match(notification?.message ?? '', /model unavailable/)
  assert.match(outcome.statuses.at(-1)?.value ?? '', /context: 🪶.*not applied/)
})

test('should avoid UI calls given an unavailable UI', async () => {
  //given
  const outcome = await withLayerHarness(
    async (harness) => {
      await harness.run((service) => service.handleCommand('off'))
      await harness.run((service) => service.shutdown())
      return harness.snapshot()
    },
    { hasUI: false, registeredModels: [model(LARGE_CONTEXT_WINDOW)] },
  )

  //when
  const uiCalls = outcome.notifications.length + outcome.statuses.length

  //then
  assert.equal(uiCalls, 0)
  assert.equal(outcome.activeModel.contextWindow, LARGE_CONTEXT_WINDOW)
})

test('should reapply saved mode given session start and model selection', async () => {
  //given
  const harness = await createExtensionHarness({ initialModel: model(LARGE_CONTEXT_WINDOW) })
  harness.setEntries([{ type: 'custom', customType: 'low-context-mode', data: { mode: 'on' } }])

  //when
  await harness.events.get('session_start')?.({}, harness.context)
  await harness.events.get('model_select')?.({ model: model(LARGE_CONTEXT_WINDOW) }, harness.context)

  //then
  assert.equal(harness.modelChanges.at(-1)?.contextWindow, 272_000)
  assert.equal(harness.modelChanges.length, 2)
})

test('should apply on mode given a non-GPT model', async () => {
  //given
  const harness = await createExtensionHarness({ initialModel: { ...model(1_000_000), id: 'o3' } })
  const command = harness.commands.get('low-context-mode')
  assert.ok(command)

  //when
  await command('on', harness.context)

  //then
  assert.equal(harness.modelChanges.at(-1)?.contextWindow, 272_000)
  assert.equal(harness.notifications.at(-1)?.type, 'info')
})

test('should clear status only once given repeated session shutdown events', async () => {
  //given
  const harness = await createExtensionHarness()
  const shutdown = harness.events.get('session_shutdown')
  assert.ok(shutdown)

  //when
  await shutdown({}, harness.context)
  await shutdown({}, harness.context)

  //then
  assert.deepEqual(harness.statuses, [{ key: 'low-context-mode', value: undefined }])
})

test('should restore only the active branch given session start and tree navigation', async () => {
  const harness = await createExtensionHarness({ initialModel: model(LARGE_CONTEXT_WINDOW) })
  const high = { type: 'custom', customType: 'low-context-mode', data: { mode: 'off' } }
  const low = { type: 'custom', customType: 'low-context-mode', data: { mode: 'on' } }
  harness.setEntries([low, high])
  harness.setBranch([low])

  await harness.events.get('session_start')?.({}, harness.context)
  assert.equal(harness.modelChanges.at(-1)?.contextWindow, 272_000)

  harness.setBranch([high])
  await harness.events.get('session_tree')?.({}, harness.context)
  assert.equal(harness.modelChanges.at(-1)?.contextWindow, LARGE_CONTEXT_WINDOW)
})

test('should cap only larger windows given models from different providers', () => {
  const small = { ...model(128_000), provider: 'anthropic', id: 'claude' }
  const exact = { ...model(272_000), provider: 'google', id: 'gemini' }
  const large = { ...model(1_000_000), provider: 'openai', id: 'other' }

  assert.equal(contextModel(small, 'on', small.contextWindow), small)
  assert.equal(contextModel(exact, 'on', exact.contextWindow), exact)
  assert.deepEqual(contextModel(large, 'on', large.contextWindow), { ...large, contextWindow: 272_000 })
})

test('should restore the configured window after reload given a capped active model', async () => {
  const original = { ...model(1_000_000), provider: 'anthropic', id: 'claude' }
  const harness = await createExtensionHarness({
    initialModel: { ...original, contextWindow: 272_000 },
    registeredModels: [original],
  })
  harness.setEntries([{ type: 'custom', customType: 'low-context-mode', data: { mode: 'on' } }])

  await harness.events.get('session_start')?.({}, harness.context)
  await harness.commands.get('low-context-mode')?.('off', harness.context)

  assert.equal(harness.modelChanges.at(-1)?.contextWindow, 1_000_000)
  assert.equal(harness.modelChanges.length, 1)
})

test('should preserve mode and report failure given a rejected model change', async () => {
  const outcome = await withLayerHarness(
    async (harness) => {
      await harness.run((service) => service.handleCommand('on'))
      return harness.snapshot()
    },
    { initialModel: model(1_000_000), setModelRejected: true },
  )

  assert.equal(outcome.activeModel.contextWindow, 1_000_000)
  assert.deepEqual(outcome.savedModes, [])
  assert.match(outcome.notifications.at(-1)?.message ?? '', /rejected/)
  assert.match(outcome.statuses.at(-1)?.value ?? '', /not applied/)
})

test('should leave unknown context windows unchanged given on mode', async () => {
  const outcome = await withLayerHarness(
    async (harness) => {
      await harness.run((service) => service.handleCommand('on'))
      return harness.snapshot()
    },
    { initialModel: model(0) },
  )

  assert.equal(outcome.modelChanges.length, 0)
  assert.match(outcome.statuses.at(-1)?.value ?? '', /unknown/)
})

test('should not guess the original window given a capped model missing from the registry', async () => {
  const harness = await createExtensionHarness({ initialModel: model(272_000), registeredModels: [] })

  await harness.events.get('session_start')?.({}, harness.context)
  await harness.commands.get('low-context-mode')?.('off', harness.context)

  assert.equal(harness.modelChanges.length, 0)
  assert.match(harness.statuses.at(-1)?.value ?? '', /unknown/)
  assert.ok(harness.notifications.some((item) => item.type === 'warning' && /unavailable/.test(item.message)))
})

test('should leave a smaller selected model unchanged given on mode', async () => {
  const small = { ...model(128_000), provider: 'google', id: 'gemini' }
  const harness = await createExtensionHarness({ initialModel: small })

  await harness.events.get('session_start')?.({}, harness.context)

  assert.equal(harness.modelChanges.length, 0)
})

test('should restore the latest valid old or new mode given mixed session entries', () => {
  const legacyLow = { type: 'custom', customType: 'gpt-context-mode', data: { mode: 'low' } }
  const legacyHigh = { type: 'custom', customType: 'gpt-context-mode', data: { mode: 'high' } }
  const newOn = { type: 'custom', customType: 'low-context-mode', data: { mode: 'on' } }
  const newOff = { type: 'custom', customType: 'low-context-mode', data: { mode: 'off' } }
  const invalid = { type: 'custom', customType: 'low-context-mode', data: { mode: 'low' } }

  assert.equal(restoreLowContextMode([legacyLow]), 'on')
  assert.equal(restoreLowContextMode([legacyHigh]), 'off')
  assert.equal(restoreLowContextMode([legacyHigh, newOn, invalid]), 'on')
  assert.equal(restoreLowContextMode([newOff, legacyLow]), 'on')
})

test('should restore a legacy off mode given an active session branch', async () => {
  const harness = await createExtensionHarness({
    initialModel: model(272_000),
    registeredModels: [model(1_000_000)],
  })
  harness.setEntries([{ type: 'custom', customType: 'low-context-mode', data: { mode: 'on' } }])
  harness.setBranch([{ type: 'custom', customType: 'gpt-context-mode', data: { mode: 'high' } }])

  await harness.events.get('session_start')?.({}, harness.context)

  assert.equal(harness.modelChanges.at(-1)?.contextWindow, 1_000_000)
})

test('should write the renamed entry given the renamed toggle command', async () => {
  const harness = await createExtensionHarness()

  await harness.commands.get('low-context-mode')?.('off', harness.context)

  assert.deepEqual(harness.savedEntries, [{ type: 'low-context-mode', data: { mode: 'off' } }])
  assert.equal(harness.commands.has('gpt-context-mode'), false)
})

test('should warn without changing a virtual model given low context mode', async () => {
  const virtual = {
    ...model(1_000_000),
    api: 'pi-virtual',
    provider: 'router',
    id: 'auto',
  } as unknown as ContextTestModel
  const harness = await createExtensionHarness({ initialModel: virtual })

  await harness.events.get('session_start')?.({}, harness.context)

  assert.equal(harness.modelChanges.length, 0)
  assert.match(harness.statuses.at(-1)?.value ?? '', /virtual.*not supported/)
  assert.ok(harness.notifications.some((item) => item.type === 'warning' && /virtual/.test(item.message)))
})

test('should restore each provider window given models with the same id', async () => {
  const first = { ...model(1_000_000, 'shared'), provider: 'first' }
  const second = { ...model(500_000, 'shared'), provider: 'second' }
  const harness = await createExtensionHarness({ initialModel: first, registeredModels: [first, second] })

  await harness.events.get('session_start')?.({}, harness.context)
  await harness.events.get('model_select')?.({ model: second }, harness.context)
  await harness.commands.get('low-context-mode')?.('off', harness.context)
  await harness.events.get('model_select')?.({ model: first }, harness.context)

  assert.deepEqual(
    harness.modelChanges.map((item) => [item.provider, item.contextWindow]),
    [
      ['first', 272_000],
      ['second', 272_000],
      ['second', 500_000],
    ],
  )
})

test('should treat an invalid registry window as unknown given a capped model', async () => {
  const harness = await createExtensionHarness({ initialModel: model(272_000), registeredModels: [model(-1)] })

  await harness.events.get('session_start')?.({}, harness.context)
  await harness.commands.get('low-context-mode')?.('off', harness.context)

  assert.equal(harness.modelChanges.length, 0)
  assert.match(harness.statuses.at(-1)?.value ?? '', /unknown/)
})
