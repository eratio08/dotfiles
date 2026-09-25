import assert from 'node:assert/strict'
import test from 'node:test'
import type { Model } from '@earendil-works/pi-ai'
import { Pi, PiContext, PiSession, PiUi } from '@eratio08/pi-effect'
import { Effect, Layer, ManagedRuntime } from 'effect'
import gptContextModeExtension, {
  GPT5_HIGH_CONTEXT_WINDOW as PUBLIC_HIGH_CONTEXT_WINDOW,
  parseGptContextCommand as publicParseGptContextCommand,
  restoreGptContextMode as publicRestoreGptContextMode,
} from '../index.ts'
import {
  contextModeEmoji,
  contextModel,
  GPT_CONTEXT_LOW_WINDOWS,
  GPT5_HIGH_CONTEXT_WINDOW,
  type GptContextMode,
  isGptContextModel,
  modelKey,
  parseGptContextCommand,
  restoreGptContextMode,
} from '../src/core.ts'
import {
  type GptContextModeError,
  GptContextModeLayer,
  GptContextModeService,
  GptContextModeState,
} from '../src/effects.ts'

type Gpt5Model = Model<'openai-responses'>
type NotificationType = 'info' | 'warning' | 'error'
type Notification = { message: string; type: NotificationType }
type Status = { key: string; value: string | undefined }
type ServiceProgram<A> = Effect.Effect<
  A,
  GptContextModeError,
  GptContextModeService | GptContextModeState | Pi | PiContext | PiSession | PiUi
>
type LayerHarness = {
  run<A>(use: (service: GptContextModeService['Service']) => ServiceProgram<A>): Promise<A>
  setEntries(entries: unknown[]): void
  snapshot(): {
    activeModel: Gpt5Model
    modelChanges: Gpt5Model[]
    notifications: Notification[]
    savedModes: Array<{ mode: GptContextMode }>
    statuses: Status[]
  }
  dispose(): Promise<void>
}
type LayerHarnessOptions = {
  hasUI?: boolean
  initialModel?: Gpt5Model
  setModelFailure?: unknown
}

function model(contextWindow = 272000, id = 'gpt-5.6-sol'): Gpt5Model {
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
  const modelChanges: Gpt5Model[] = []
  const notifications: Notification[] = []
  const savedModes: Array<{ mode: GptContextMode }> = []
  const statuses: Status[] = []
  const pi = {
    model: {
      set: (nextModel: Gpt5Model): Effect.Effect<boolean, GptContextModeError> =>
        options.setModelFailure === undefined
          ? Effect.sync(() => {
              activeModel = nextModel
              modelChanges.push(nextModel)
              return true
            })
          : Effect.fail(options.setModelFailure as GptContextModeError),
    },
  }
  const context = {
    mode: 'tui',
    hasUI: options.hasUI ?? true,
    get model(): Gpt5Model {
      return activeModel
    },
  }
  const session = {
    entries: (): Effect.Effect<unknown[]> => Effect.succeed(entries),
    appendEntry: (_type: string, data: { mode: GptContextMode }): Effect.Effect<void> =>
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
      GptContextModeLayer,
      GptContextModeState.layer,
      Layer.succeed(Pi, pi as never),
      Layer.succeed(PiContext, context as never),
      Layer.succeed(PiSession, session as never),
      Layer.succeed(PiUi, ui as never),
    ),
  )
  const run = <A>(use: (service: GptContextModeService['Service']) => ServiceProgram<A>): Promise<A> =>
    runtime.runPromise(GptContextModeService.use(use) as never)

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
  modelChanges: Gpt5Model[]
  notifications: Notification[]
  statuses: Status[]
  context: unknown
  setEntries(entries: unknown[]): void
}

async function createExtensionHarness(options: LayerHarnessOptions = {}): Promise<ExtensionHarness> {
  let activeModel = options.initialModel ?? model()
  let entries: unknown[] = []
  const commands = new Map<string, (args: string, context: unknown) => Promise<void>>()
  const events = new Map<string, (event: unknown, context: unknown) => Promise<unknown>>()
  const modelChanges: Gpt5Model[] = []
  const notifications: Notification[] = []
  const statuses: Status[] = []
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
    appendEntry: (_type: string, _data: { mode: GptContextMode }): void => undefined,
    setModel: async (nextModel: Gpt5Model): Promise<boolean> => {
      if (options.setModelFailure !== undefined) throw options.setModelFailure
      activeModel = nextModel
      modelChanges.push(nextModel)
      return true
    },
  }
  const context = {
    mode: 'tui',
    hasUI: options.hasUI ?? true,
    cwd: process.cwd(),
    signal: undefined,
    get model(): Gpt5Model {
      return activeModel
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
      getBranch: (): unknown[] => [],
      buildContextEntries: (): unknown[] => [],
      getLabel: (): undefined => undefined,
      getSessionName: (): undefined => undefined,
    },
  }
  await gptContextModeExtension(api as never)
  return {
    commands,
    events,
    modelChanges,
    notifications,
    statuses,
    context,
    setEntries(nextEntries: unknown[]): void {
      entries = nextEntries
    },
  }
}

test('should export the high context window given an extension entry-point import', () => {
  //given
  const expected = GPT5_HIGH_CONTEXT_WINDOW

  //when
  const actual = PUBLIC_HIGH_CONTEXT_WINDOW

  //then
  assert.equal(actual, expected)
})

test('should export command parsing and persistence helpers given a module import', () => {
  //given
  const entries = [{ type: 'custom', customType: 'gpt-context-mode', data: { mode: 'high' } }]

  //when
  const parsed = publicParseGptContextCommand('toggle', 'low')
  const restored = publicRestoreGptContextMode(entries)

  //then
  assert.equal(parsed, 'high')
  assert.equal(restored, 'high')
})

test('should parse commands and restore the latest saved mode given command input and persisted state', () => {
  //given
  const entries = [
    { type: 'custom', customType: 'gpt-context-mode', data: { mode: 'high' } },
    { type: 'custom', customType: 'gpt-context-mode', data: { mode: 'low' } },
  ]

  //when
  const parsed = parseGptContextCommand('', 'high')
  const restored = restoreGptContextMode(entries)

  //then
  assert.equal(parsed, 'low')
  assert.equal(restored, 'low')
})

test('should change only the context window given a mode transition', () => {
  //given
  const source = model()

  //when
  const changed = contextModel(source, 'high', source.contextWindow)

  //then
  assert.equal(changed.id, source.id)
  assert.equal(changed.contextWindow, GPT5_HIGH_CONTEXT_WINDOW)
})

test('should detect configured models and build stable keys given model configuration', () => {
  //given
  const supported = model()
  const unsupported = { ...supported, id: 'gpt-5.5' }

  //when
  const gpt6 = { ...supported, id: 'gpt-6-luna', contextWindow: 1_000_000 }
  const result = [
    isGptContextModel(supported),
    isGptContextModel(gpt6),
    isGptContextModel(unsupported),
    modelKey(supported),
    contextModeEmoji('high'),
  ]

  //then
  assert.deepEqual(result, [true, true, false, 'github-copilot/gpt-5.6-sol', '🚀'])
})

test('should apply and persist high mode and update status given shared services', async () => {
  //given
  const outcome = await withLayerHarness(async (harness) => {
    await harness.run((service) => service.handleCommand('high'))
    return harness.snapshot()
  })

  //when
  const modelChange = outcome.modelChanges.at(-1)

  //then
  assert.equal(modelChange?.contextWindow, GPT5_HIGH_CONTEXT_WINDOW)
  assert.deepEqual(outcome.savedModes, [{ mode: 'high' }])
  assert.match(outcome.statuses.at(-1)?.value ?? '', /context: 🚀/)
})

test('should use the model-specific low window given a transition from high mode', async () => {
  //given
  const source = model(GPT5_HIGH_CONTEXT_WINDOW, 'gpt-5.6-luna')

  //when
  const outcome = await withLayerHarness(async (harness) => {
    await harness.run((service) => service.applyModel(source))
    return harness.snapshot()
  })

  //then
  assert.equal(outcome.modelChanges.at(-1)?.contextWindow, GPT_CONTEXT_LOW_WINDOWS.get(source.id))
})

test('should use the default context window given a GPT-6 model', async () => {
  //given
  const source = model(1_000_000, 'gpt-6-luna')

  //when
  const outcome = await withLayerHarness(async (harness) => {
    await harness.run((service) => service.applyModel(source))
    return harness.snapshot()
  })

  //then
  assert.equal(outcome.modelChanges.at(-1)?.contextWindow, 272000)
})

test('should restore saved mode given the shared session service', async () => {
  //given
  const entries = [{ type: 'custom', customType: 'gpt-context-mode', data: { mode: 'high' } }]

  //when
  const outcome = await withLayerHarness(async (harness) => {
    harness.setEntries(entries)
    const mode = await harness.run((service) => service.restore())
    return { mode, snapshot: harness.snapshot() }
  })

  //then
  assert.equal(outcome.mode, 'high')
  assert.equal(outcome.snapshot.modelChanges.at(-1)?.contextWindow, GPT5_HIGH_CONTEXT_WINDOW)
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
      await harness.run((service) => service.handleCommand('high'))
      return harness.snapshot()
    },
    { setModelFailure: new Error('model unavailable') },
  )

  //when
  const notification = outcome.notifications.at(-1)

  //then
  assert.equal(notification?.type, 'error')
  assert.match(notification?.message ?? '', /model unavailable/)
  assert.match(outcome.statuses.at(-1)?.value ?? '', /context: 🚀/)
})

test('should avoid UI calls given an unavailable UI', async () => {
  //given
  const outcome = await withLayerHarness(
    async (harness) => {
      await harness.run((service) => service.handleCommand('high'))
      await harness.run((service) => service.shutdown())
      return harness.snapshot()
    },
    { hasUI: false },
  )

  //when
  const uiCalls = outcome.notifications.length + outcome.statuses.length

  //then
  assert.equal(uiCalls, 0)
  assert.equal(outcome.activeModel.contextWindow, GPT5_HIGH_CONTEXT_WINDOW)
})

test('should reapply saved mode given session start and model selection', async () => {
  //given
  const harness = await createExtensionHarness()
  harness.setEntries([{ type: 'custom', customType: 'gpt-context-mode', data: { mode: 'high' } }])

  //when
  await harness.events.get('session_start')?.({}, harness.context)
  await harness.events.get('model_select')?.({ model: model() }, harness.context)

  //then
  assert.equal(harness.modelChanges.at(-1)?.contextWindow, GPT5_HIGH_CONTEXT_WINDOW)
  assert.equal(harness.modelChanges.length, 2)
})

test('should warn given a selected model that is not a supported GPT model', async () => {
  //given
  const harness = await createExtensionHarness({ initialModel: { ...model(), id: 'gpt-5.5' } })
  const command = harness.commands.get('gpt-context-mode')
  assert.ok(command)

  //when
  await command('high', harness.context)

  //then
  assert.equal(harness.modelChanges.length, 0)
  assert.equal(harness.notifications.at(-1)?.type, 'warning')
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
  assert.deepEqual(harness.statuses, [{ key: 'gpt-context-mode', value: undefined }])
})
