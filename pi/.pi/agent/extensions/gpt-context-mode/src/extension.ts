import type { Api, Model } from '@earendil-works/pi-ai'
import { Pi, PiContext, type PiContextTag, type PiExtensionError, PiSession, PiUi } from '@eratio08/pi-effect'
import { Context, Effect, Layer, Ref, Schema } from 'effect'

const GPT5_HIGH_CONTEXT_WINDOW = 1_050_000
const GPT6_HIGH_CONTEXT_WINDOW = 1_000_000

const GPT_CONTEXT_LOW_WINDOWS: ReadonlyMap<string, number> = new Map([
  ['gpt-5.6-luna', 200_000],
  ['gpt-5.6-sol', 272_000],
  ['gpt-5.6-terra', 272_000],
  ['gpt-6-luna', 272_000],
  ['gpt-6-sol', 272_000],
])

const GPT_CONTEXT_HIGH_WINDOWS: ReadonlyMap<string, number> = new Map([
  ['gpt-5.6-luna', GPT5_HIGH_CONTEXT_WINDOW],
  ['gpt-5.6-sol', GPT5_HIGH_CONTEXT_WINDOW],
  ['gpt-5.6-terra', GPT5_HIGH_CONTEXT_WINDOW],
  ['gpt-6-luna', GPT6_HIGH_CONTEXT_WINDOW],
  ['gpt-6-sol', GPT6_HIGH_CONTEXT_WINDOW],
])

const GPT_CONTEXT_MODE_ENTRY = 'gpt-context-mode'

type GptContextMode = 'low' | 'high'

type GptContextModeModel = {
  readonly api: string
  readonly id: string
  readonly provider: string
  readonly contextWindow: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isGptContextMode(value: unknown): value is GptContextMode {
  return value === 'low' || value === 'high'
}

function contextModeEmoji(mode: GptContextMode): string {
  return mode === 'low' ? '🪶' : '🚀'
}

function parseGptContextCommand(args: string, currentMode: GptContextMode): GptContextMode | undefined {
  const command = args.trim().toLowerCase()
  if (!command || command === 'toggle') {
    return currentMode === 'low' ? 'high' : 'low'
  }
  if (command === 'low' || command === 'high') {
    return command
  }
  return undefined
}

function restoreGptContextMode(branch: readonly unknown[], fallback: GptContextMode = 'low'): GptContextMode {
  let mode = fallback
  for (const value of branch) {
    if (!isRecord(value) || value.type !== 'custom' || value.customType !== GPT_CONTEXT_MODE_ENTRY) {
      continue
    }
    const data = value.data
    if (isRecord(data) && isGptContextMode(data.mode)) {
      mode = data.mode
    }
  }
  return mode
}

function isGptContextModel<T extends GptContextModeModel>(model: T | undefined): model is T {
  return model?.api === 'openai-responses' && GPT_CONTEXT_LOW_WINDOWS.has(model.id)
}

function modelKey(model: GptContextModeModel): string {
  return `${model.provider}/${model.id}`
}

function contextModel<T extends GptContextModeModel>(
  model: T,
  mode: GptContextMode,
  lowContextWindow: number,
  highContextWindow = GPT5_HIGH_CONTEXT_WINDOW,
): T {
  const contextWindow = mode === 'high' ? highContextWindow : lowContextWindow
  return model.contextWindow === contextWindow ? model : { ...model, contextWindow }
}

const STATUS_KEY = 'gpt-context-mode'

type GptContextModeError = GptContextModeHostError | PiExtensionError

class GptContextModeState extends Context.Service<
  GptContextModeState,
  {
    readonly mode: Ref.Ref<GptContextMode>
    readonly lowContextWindows: Ref.Ref<ReadonlyMap<string, number>>
  }
>()('gpt-context-mode/State') {
  static readonly layer = Layer.effect(
    GptContextModeState,
    Effect.gen(function* () {
      const mode = yield* Ref.make<GptContextMode>('low')
      const lowContextWindows = yield* Ref.make<ReadonlyMap<string, number>>(new Map())
      return GptContextModeState.of({ mode, lowContextWindows })
    }),
  )
}

class GptContextModeHostError extends Schema.TaggedError<GptContextModeHostError>()('GptContextModeHostError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

class GptContextModeService extends Context.Service<
  GptContextModeService,
  {
    readonly handleCommand: (
      args: string,
    ) => Effect.Effect<void, GptContextModeError, GptContextModeState | Pi | PiContextTag | PiSession | PiUi>
    readonly restore: () => Effect.Effect<
      GptContextMode,
      GptContextModeError,
      GptContextModeState | Pi | PiContextTag | PiSession | PiUi
    >
    readonly applyModel: (
      model: Model<Api> | undefined,
    ) => Effect.Effect<boolean, GptContextModeError, GptContextModeState | Pi | PiContextTag | PiUi>
    readonly shutdown: () => Effect.Effect<void, GptContextModeError, PiContextTag | PiUi>
  }
>()('gpt-context-mode/GptContextModeService') {}

function toHostError(operation: string, cause: unknown): GptContextModeHostError {
  return new GptContextModeHostError({ operation, message: cause instanceof Error ? cause.message : String(cause) })
}

function mapPi<A, E>(operation: string, effect: Effect.Effect<A, E>): Effect.Effect<A, GptContextModeError> {
  return effect.pipe(Effect.mapError((cause) => toHostError(operation, cause)))
}

const notify = Effect.fnUntraced(function* (
  message: string,
  type: 'info' | 'warning' | 'error',
): Effect.fn.Return<void, GptContextModeError, PiUi> {
  const ui = yield* PiUi
  yield* mapPi('notify', ui.notify(message, type))
})

const updateStatus = Effect.fnUntraced(function* (
  mode: GptContextMode,
  model: Model<Api> | undefined,
): Effect.fn.Return<void, GptContextModeError, PiContextTag | PiUi> {
  const context = yield* PiContext
  if (context.mode !== 'tui' || !context.hasUI) return
  const ui = yield* PiUi
  const theme = yield* mapPi('theme', ui.theme())
  const label = theme?.fg ? theme.fg('muted', 'context: ') : 'context: '
  const active = isGptContextModel(model)
  yield* mapPi('setStatus', ui.setStatus(STATUS_KEY, `${label}${contextModeEmoji(mode)}${active ? '' : ' (inactive)'}`))
})

const setModel = Effect.fnUntraced(function* (model: Model<Api>): Effect.fn.Return<void, GptContextModeError, Pi> {
  const pi = yield* Pi
  yield* mapPi('setModel', pi.model.set(model))
})

const applyModel = Effect.fnUntraced(function* (
  model: Model<Api> | undefined,
): Effect.fn.Return<boolean, GptContextModeError, GptContextModeState | Pi | PiContextTag | PiUi> {
  const state = yield* GptContextModeState
  const mode = yield* Ref.get(state.mode)
  if (!isGptContextModel(model)) {
    yield* updateStatus(mode, model)
    return false
  }

  const key = modelKey(model)
  const cachedWindows = yield* Ref.get(state.lowContextWindows)
  const lowContextWindow = cachedWindows.get(key) ?? GPT_CONTEXT_LOW_WINDOWS.get(model.id) ?? model.contextWindow
  const highContextWindow = GPT_CONTEXT_HIGH_WINDOWS.get(model.id) ?? model.contextWindow
  yield* Ref.set(state.lowContextWindows, new Map(cachedWindows).set(key, lowContextWindow))

  const nextModel = contextModel(model, mode, lowContextWindow, highContextWindow)
  if (nextModel !== model) {
    const applied = yield* setModel(nextModel).pipe(
      Effect.as(true),
      Effect.catchTag('GptContextModeHostError', (error) =>
        Effect.gen(function* () {
          yield* notify(`Unable to set GPT context mode: ${error.message}`, 'error')
          yield* updateStatus(mode, model)
          return false
        }),
      ),
    )
    if (!applied) return false
  }

  yield* updateStatus(mode, nextModel)
  return true
})

const handleCommand = Effect.fnUntraced(function* (
  args: string,
): Effect.fn.Return<void, GptContextModeError, GptContextModeState | Pi | PiContextTag | PiSession | PiUi> {
  const context = yield* PiContext
  const session = yield* PiSession
  const state = yield* GptContextModeState
  const mode = yield* Ref.get(state.mode)
  const nextMode = parseGptContextCommand(args, mode)
  if (!nextMode) {
    yield* notify('Usage: /gpt-context-mode [high|low|toggle]', 'warning')
    return
  }

  yield* Ref.set(state.mode, nextMode)
  yield* mapPi('appendEntry', session.appendEntry(GPT_CONTEXT_MODE_ENTRY, { mode: nextMode }))
  const model = context.model
  const applied = yield* applyModel(model)
  if (!isGptContextModel(model)) {
    yield* notify('GPT context mode only applies to supported GPT models', 'warning')
    return
  }
  if (applied) {
    const ui = yield* PiUi
    const theme = yield* mapPi('theme', ui.theme())
    const label = theme?.fg ? theme.fg('muted', 'context: ') : 'context: '
    yield* notify(`${label}${contextModeEmoji(nextMode)}`, 'info')
  }
})

const restore = Effect.fnUntraced(function* (): Effect.fn.Return<
  GptContextMode,
  GptContextModeError,
  GptContextModeState | Pi | PiContextTag | PiSession | PiUi
> {
  const context = yield* PiContext
  const session = yield* PiSession
  const state = yield* GptContextModeState
  const entries = yield* mapPi('getEntries', session.entries())
  const mode = restoreGptContextMode(entries)
  yield* Ref.set(state.mode, mode)
  yield* applyModel(context.model)
  return mode
})

const shutdown = Effect.fnUntraced(function* (): Effect.fn.Return<void, GptContextModeError, PiContextTag | PiUi> {
  const ui = yield* PiUi
  yield* mapPi('clearStatus', ui.setStatus(STATUS_KEY, undefined))
})

const GptContextModeLayer: Layer.Layer<GptContextModeService, never, never> = Layer.succeed(
  GptContextModeService,
  GptContextModeService.of({
    handleCommand,
    restore,
    applyModel,
    shutdown,
  }),
)

export {
  contextModeEmoji,
  contextModel,
  GPT_CONTEXT_HIGH_WINDOWS,
  GPT_CONTEXT_LOW_WINDOWS,
  GPT_CONTEXT_MODE_ENTRY,
  GPT5_HIGH_CONTEXT_WINDOW,
  type GptContextMode,
  type GptContextModeError,
  GptContextModeHostError,
  GptContextModeLayer,
  type GptContextModeModel,
  GptContextModeService,
  GptContextModeState,
  isGptContextMode,
  isGptContextModel,
  modelKey,
  parseGptContextCommand,
  restoreGptContextMode,
}
