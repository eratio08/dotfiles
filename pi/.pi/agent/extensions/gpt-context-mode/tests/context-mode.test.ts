import assert from 'node:assert/strict'
import test from 'node:test'
import type { Model } from '@earendil-works/pi-ai'
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Effect, Layer, ManagedRuntime } from 'effect'
import gptContextModeExtension, {
  GPT5_HIGH_CONTEXT_WINDOW as PUBLIC_HIGH_CONTEXT_WINDOW,
  parseGptContextCommand as publicParseGptContextCommand,
  restoreGptContextMode as publicRestoreGptContextMode,
} from '../index.ts'
import {
  contextModeEmoji,
  contextModel,
  GPT5_6_LOW_CONTEXT_WINDOWS,
  GPT5_HIGH_CONTEXT_WINDOW,
  type GptContextMode,
  isGpt5Model,
  modelKey,
  parseGptContextCommand,
  restoreGptContextMode,
} from '../src/core.ts'
import {
  GptContextModeContext,
  type GptContextModeHostError,
  GptContextModeLayer,
  GptContextModePi,
  GptContextModeService,
  GptContextModeState,
} from '../src/effects.ts'

type Gpt5Model = Model<'openai-responses'>
type NotificationType = 'info' | 'warning' | 'error'
type Notification = { message: string; type: NotificationType }
type Status = { key: string; value: string | undefined }
type Command = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> }
type EventHandler = (event: never, ctx: ExtensionContext) => Promise<void>
type ServiceProgram<A> = Effect.Effect<
  A,
  GptContextModeHostError,
  GptContextModeContext | GptContextModePi | GptContextModeState
>

type HarnessSnapshot = {
  activeModel: Gpt5Model
  modelChanges: Gpt5Model[]
  notifications: Notification[]
  savedModes: Array<{ mode: GptContextMode }>
  statuses: Status[]
}

type LayerHarness = {
  run<A>(use: (service: GptContextModeService['Service']) => ServiceProgram<A>): Promise<A>
  setEntries(entries: unknown[]): void
  snapshot(): HarnessSnapshot
  dispose(): Promise<void>
}

type LayerHarnessOptions = {
  hasUI?: boolean
  initialModel?: Gpt5Model
  setModelFailure?: unknown
  setModelPending?: boolean
  signal?: AbortSignal
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
    appendEntry(_type: string, data: { mode: GptContextMode }) {
      savedModes.push(data)
    },
    async setModel(nextModel: Gpt5Model): Promise<boolean> {
      if (options.setModelPending) {
        return new Promise<boolean>(() => {})
      }
      if (options.setModelFailure !== undefined) {
        throw options.setModelFailure
      }
      activeModel = nextModel
      modelChanges.push(nextModel)
      return true
    },
  } as unknown as ExtensionAPI
  const ctx = {
    hasUI: options.hasUI ?? true,
    mode: 'tui',
    signal: options.signal,
    get model() {
      return activeModel
    },
    ui: {
      notify(message: string, type: NotificationType) {
        notifications.push({ message, type })
      },
      setStatus(key: string, value: string | undefined) {
        statuses.push({ key, value })
      },
    },
    sessionManager: {
      getEntries() {
        return entries
      },
    },
  } as unknown as ExtensionContext
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(GptContextModeLayer, GptContextModeState.layer, Layer.succeed(GptContextModePi, pi)),
  )
  const run = <A>(use: (service: GptContextModeService['Service']) => ServiceProgram<A>): Promise<A> =>
    runtime.runPromise(Effect.provideService(GptContextModeService.use(use), GptContextModeContext, ctx), {
      signal: ctx.signal,
    })

  return {
    run,
    setEntries(nextEntries) {
      entries = nextEntries
    },
    snapshot() {
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
  commands: Map<string, Command>
  events: Map<string, EventHandler>
  modelChanges: Gpt5Model[]
  notifications: Notification[]
  savedModes: Array<{ mode: GptContextMode }>
  statuses: Status[]
  ctx: ExtensionCommandContext
  setEntries(entries: unknown[]): void
}

function contextHarness(options: LayerHarnessOptions = {}): ExtensionHarness {
  let activeModel = options.initialModel ?? model()
  let entries: unknown[] = []
  const commands = new Map<string, Command>()
  const events = new Map<string, EventHandler>()
  const modelChanges: Gpt5Model[] = []
  const notifications: Notification[] = []
  const savedModes: Array<{ mode: GptContextMode }> = []
  const statuses: Status[] = []
  const pi = {
    registerCommand(name: string, command: Command) {
      commands.set(name, command)
    },
    on(event: string, handler: EventHandler) {
      events.set(event, handler)
    },
    appendEntry(_type: string, data: { mode: GptContextMode }) {
      savedModes.push(data)
    },
    async setModel(nextModel: Gpt5Model): Promise<boolean> {
      if (options.setModelPending) {
        return new Promise<boolean>(() => {})
      }
      if (options.setModelFailure !== undefined) {
        throw options.setModelFailure
      }
      activeModel = nextModel
      modelChanges.push(nextModel)
      return true
    },
  } as unknown as ExtensionAPI
  const ctx = {
    hasUI: options.hasUI ?? true,
    mode: 'tui',
    signal: options.signal,
    get model() {
      return activeModel
    },
    ui: {
      notify(message: string, type: NotificationType) {
        notifications.push({ message, type })
      },
      setStatus(key: string, value: string | undefined) {
        statuses.push({ key, value })
      },
    },
    sessionManager: {
      getEntries() {
        return entries
      },
    },
  } as unknown as ExtensionCommandContext

  gptContextModeExtension(pi)

  return {
    commands,
    events,
    modelChanges,
    notifications,
    savedModes,
    statuses,
    ctx,
    setEntries(nextEntries) {
      entries = nextEntries
    },
  }
}

function detectGpt5Models(supported: Gpt5Model): { supported: boolean; unsupported: boolean } {
  return {
    supported: isGpt5Model(supported),
    unsupported: isGpt5Model({ ...supported, id: 'gpt-5.5' }),
  }
}

async function observeAbortedCommand(harness: ExtensionHarness, controller: AbortController): Promise<boolean> {
  const command = harness.commands.get('gpt-context-mode')
  if (!command) {
    throw new Error('context-mode command was not registered')
  }
  const pending = command.handler('high', harness.ctx)
  controller.abort()
  try {
    await pending
    return false
  } catch {
    return true
  }
}

async function runShutdownTwice(harness: ExtensionHarness): Promise<Status[]> {
  const shutdown = harness.events.get('session_shutdown')
  if (!shutdown) {
    throw new Error('context-mode shutdown handler was not registered')
  }
  await shutdown({} as never, harness.ctx)
  await shutdown({} as never, harness.ctx)
  return [...harness.statuses]
}

async function restoreAndSelect(harness: ExtensionHarness): Promise<Gpt5Model[]> {
  const sessionStart = harness.events.get('session_start')
  const modelSelect = harness.events.get('model_select')
  if (!sessionStart || !modelSelect) {
    throw new Error('context-mode lifecycle handlers were not registered')
  }
  await sessionStart({} as never, harness.ctx)
  await modelSelect(
    {
      model: model(),
      previousModel: undefined,
      source: 'cycle',
    } as never,
    harness.ctx,
  )
  return [...harness.modelChanges]
}

test('exports the high context window through the extension entry point', () => {
  //given
  const expected = GPT5_HIGH_CONTEXT_WINDOW

  //when
  const actual = PUBLIC_HIGH_CONTEXT_WINDOW

  //then
  assert.equal(actual, expected)
})

test('exports command parsing through the extension entry point', () => {
  //given
  const currentMode: GptContextMode = 'low'

  //when
  const nextMode = publicParseGptContextCommand('toggle', currentMode)

  //then
  assert.equal(nextMode, 'high')
})

test('exports persistence restoration through the extension entry point', () => {
  //given
  const entries = [{ type: 'custom', customType: 'gpt-context-mode', data: { mode: 'high' } }]

  //when
  const mode = publicRestoreGptContextMode(entries)

  //then
  assert.equal(mode, 'high')
})

test('parses an explicit high command', () => {
  //given
  const currentMode: GptContextMode = 'low'

  //when
  const nextMode = parseGptContextCommand('high', currentMode)

  //then
  assert.equal(nextMode, 'high')
})

test('parses an explicit low command', () => {
  //given
  const currentMode: GptContextMode = 'high'

  //when
  const nextMode = parseGptContextCommand('low', currentMode)

  //then
  assert.equal(nextMode, 'low')
})

test('toggles high mode from low mode', () => {
  //given
  const currentMode: GptContextMode = 'low'

  //when
  const nextMode = parseGptContextCommand('toggle', currentMode)

  //then
  assert.equal(nextMode, 'high')
})

test('toggles low mode from high mode when the command is empty', () => {
  //given
  const currentMode: GptContextMode = 'high'

  //when
  const nextMode = parseGptContextCommand('', currentMode)

  //then
  assert.equal(nextMode, 'low')
})

test('rejects an unknown command', () => {
  //given
  const currentMode: GptContextMode = 'low'

  //when
  const nextMode = parseGptContextCommand('unknown', currentMode)

  //then
  assert.equal(nextMode, undefined)
})

test('restores the latest saved context mode', () => {
  //given
  const entries = [
    { type: 'custom', customType: 'gpt-context-mode', data: { mode: 'high' } },
    { type: 'custom', customType: 'other', data: { mode: 'low' } },
    { type: 'custom', customType: 'gpt-context-mode', data: { mode: 'low' } },
  ]

  //when
  const mode = restoreGptContextMode(entries)

  //then
  assert.equal(mode, 'low')
})

test('uses the low fallback when no mode is saved', () => {
  //given
  const entries: unknown[] = []

  //when
  const mode = restoreGptContextMode(entries)

  //then
  assert.equal(mode, 'low')
})

test('preserves model identity while changing its context window', () => {
  //given
  const source = model()

  //when
  const next = contextModel(source, 'high', source.contextWindow)

  //then
  assert.notEqual(next, source)
  assert.equal(next.contextWindow, GPT5_HIGH_CONTEXT_WINDOW)
  assert.equal(next.id, source.id)
  assert.equal(next.provider, source.provider)
  assert.equal(next.maxTokens, source.maxTokens)
})

test('preserves model identity when the context window is already correct', () => {
  //given
  const source = model(GPT5_HIGH_CONTEXT_WINDOW)

  //when
  const next = contextModel(source, 'high', 272000)

  //then
  assert.equal(next, source)
})

test('detects only configured GPT-5.6 models', () => {
  //given
  const supported = model()

  //when
  const detected = detectGpt5Models(supported)

  //then
  assert.equal(detected.supported, true)
  assert.equal(detected.unsupported, false)
})

test('builds a provider and model key', () => {
  //given
  const source = model()

  //when
  const key = modelKey(source)

  //then
  assert.equal(key, 'github-copilot/gpt-5.6-sol')
})

test('maps modes to their status emoji', () => {
  //given
  const mode: GptContextMode = 'high'

  //when
  const emoji = contextModeEmoji(mode)

  //then
  assert.equal(emoji, '🚀')
})

test('applies high mode through the Effect layer and persists it', async () => {
  //given

  //when
  const outcome = await withLayerHarness(async (harness) => {
    await harness.run((service) => service.handleCommand('high'))
    return harness.snapshot()
  })

  //then
  const modelChange = outcome.modelChanges.at(-1)

  assert.equal(modelChange?.contextWindow, GPT5_HIGH_CONTEXT_WINDOW)
  assert.equal(modelChange?.id, 'gpt-5.6-sol')
  assert.equal(modelChange?.provider, 'github-copilot')
  assert.equal(modelChange?.maxTokens, 128000)
  assert.deepEqual(outcome.savedModes, [{ mode: 'high' }])
  assert.match(outcome.statuses.at(-1)?.value ?? '', /context: 🚀/)
})

test('returns to the cached low window after a high transition', async () => {
  //given

  //when
  const outcome = await withLayerHarness(async (harness) => {
    await harness.run((service) =>
      Effect.gen(function* () {
        yield* service.handleCommand('high')
        yield* service.handleCommand('toggle')
      }),
    )
    return harness.snapshot()
  })

  //then
  const modelChange = outcome.modelChanges.at(-1)
  assert.equal(modelChange?.contextWindow, 272000)
  assert.deepEqual(outcome.savedModes, [{ mode: 'high' }, { mode: 'low' }])
})

test('uses the model-specific low context window through the Effect layer', async () => {
  //given
  const source = model(GPT5_HIGH_CONTEXT_WINDOW, 'gpt-5.6-luna')

  //when
  const outcome = await withLayerHarness(async (harness) => {
    await harness.run((service) => service.applyModel(source))
    return harness.snapshot()
  })

  //then
  const modelChange = outcome.modelChanges.at(-1)
  assert.equal(modelChange?.contextWindow, GPT5_6_LOW_CONTEXT_WINDOWS.get(source.id))
})

test('restores the saved mode from session entries through the Effect layer', async () => {
  //given
  const entries = [{ type: 'custom', customType: 'gpt-context-mode', data: { mode: 'high' } }]

  //when
  const outcome = await withLayerHarness(async (harness) => {
    harness.setEntries(entries)
    const mode = await harness.run((service) => service.restore())
    return { mode, snapshot: harness.snapshot() }
  })

  //then
  const modelChange = outcome.snapshot.modelChanges.at(-1)
  assert.equal(outcome.mode, 'high')
  assert.equal(modelChange?.contextWindow, GPT5_HIGH_CONTEXT_WINDOW)
})

test('warns without changing state for an invalid command', async () => {
  //given

  //when
  const outcome = await withLayerHarness(async (harness) => {
    await harness.run((service) => service.handleCommand('unknown'))
    return harness.snapshot()
  })

  //then
  const notification = outcome.notifications.at(-1)

  assert.equal(notification?.type, 'warning')
  assert.match(notification?.message ?? '', /Usage: \/gpt-context-mode/)
  assert.equal(outcome.modelChanges.length, 0)
  assert.deepEqual(outcome.savedModes, [])
})

test('recovers from a model change failure and restores the previous status', async () => {
  //given
  const options = { setModelFailure: new Error('model unavailable') }

  //when
  const outcome = await withLayerHarness(async (harness) => {
    await harness.run((service) => service.handleCommand('high'))
    return harness.snapshot()
  }, options)

  //then
  const notification = outcome.notifications.at(-1)

  assert.equal(notification?.type, 'error')
  assert.match(notification?.message ?? '', /model unavailable/)
  assert.equal(outcome.modelChanges.length, 0)
  assert.match(outcome.statuses.at(-1)?.value ?? '', /context: 🚀/)
})

test('does not call UI methods when UI is unavailable', async () => {
  //given
  const options = { hasUI: false }

  //when
  const outcome = await withLayerHarness(async (harness) => {
    await harness.run((service) =>
      Effect.gen(function* () {
        yield* service.handleCommand('high')
        yield* service.shutdown()
      }),
    )
    return harness.snapshot()
  }, options)

  //then
  const uiCalls = outcome.notifications.length + outcome.statuses.length

  assert.equal(uiCalls, 0)
  assert.equal(outcome.activeModel.contextWindow, GPT5_HIGH_CONTEXT_WINDOW)
})

test('clears the status through the Effect layer during shutdown', async () => {
  //given

  //when
  const outcome = await withLayerHarness(async (harness) => {
    await harness.run((service) => service.shutdown())
    return harness.snapshot()
  })

  //then
  const status = outcome.statuses.at(-1)
  assert.deepEqual(status, { key: 'gpt-context-mode', value: undefined })
})

test('reapplies the saved mode after session start and model selection', async () => {
  //given
  const harness = contextHarness()
  harness.setEntries([{ type: 'custom', customType: 'gpt-context-mode', data: { mode: 'high' } }])

  //when
  const modelChanges = await restoreAndSelect(harness)

  //then
  assert.equal(modelChanges.at(-1)?.contextWindow, GPT5_HIGH_CONTEXT_WINDOW)
  assert.equal(modelChanges.length, 2)
})

test('restores entries from the active session tree branch', async () => {
  //given
  const harness = contextHarness({ initialModel: model(GPT5_HIGH_CONTEXT_WINDOW) })
  harness.setEntries([
    { type: 'custom', customType: 'gpt-context-mode', data: { mode: 'high' } },
    { type: 'custom', customType: 'gpt-context-mode', data: { mode: 'low' } },
  ])
  const sessionTree = harness.events.get('session_tree')
  assert.ok(sessionTree)

  //when
  await sessionTree({} as never, harness.ctx)

  //then
  assert.equal(harness.modelChanges.at(-1)?.contextWindow, 272000)
})

test('warns when the selected model is not GPT-5.6', async () => {
  //given
  const harness = contextHarness({ initialModel: { ...model(), id: 'gpt-5.5' } })
  const command = harness.commands.get('gpt-context-mode')
  assert.ok(command)

  //when
  await command.handler('high', harness.ctx)

  //then
  assert.equal(harness.modelChanges.length, 0)
  assert.equal(harness.notifications.at(-1)?.type, 'warning')
  assert.match(harness.notifications.at(-1)?.message ?? '', /only applies to GPT-5\.6 models/)
  assert.match(harness.statuses.at(-1)?.value ?? '', /inactive/)
})

test('propagates the callback abort signal to the Effect runtime', async () => {
  //given
  const controller = new AbortController()
  const harness = contextHarness({ setModelPending: true, signal: controller.signal })

  //when
  const aborted = await observeAbortedCommand(harness, controller)

  //then
  assert.equal(aborted, true)
})

test('clears status only once when session shutdown is repeated', async () => {
  //given
  const harness = contextHarness()

  //when
  const statuses = await runShutdownTwice(harness)

  //then
  assert.deepEqual(statuses, [{ key: 'gpt-context-mode', value: undefined }])
})
