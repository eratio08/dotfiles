import type { Api, Model } from '@earendil-works/pi-ai'
import { Pi, PiContext, type PiContextTag, type PiExtensionError, PiSession, PiUi } from '@eratio08/pi-effect'
import { Context, Effect, Layer, Ref, Schema } from 'effect'

const LOW_CONTEXT_WINDOW = 272_000

const LOW_CONTEXT_MODE_ENTRY = 'low-context-mode'

type LowContextMode = 'on' | 'off'

type LowContextModeModel = {
  readonly api: string
  readonly id: string
  readonly provider: string
  readonly contextWindow: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isLowContextMode(value: unknown): value is LowContextMode {
  return value === 'on' || value === 'off'
}

function contextModeEmoji(mode: LowContextMode): string {
  return mode === 'on' ? '🪶' : '🚀'
}

function parseLowContextCommand(args: string, currentMode: LowContextMode): LowContextMode | undefined {
  const command = args.trim().toLowerCase()
  if (!command || command === 'toggle') {
    return currentMode === 'on' ? 'off' : 'on'
  }
  if (command === 'on' || command === 'off') {
    return command
  }
  return undefined
}

function restoreLowContextMode(branch: readonly unknown[], fallback: LowContextMode = 'on'): LowContextMode {
  let mode = fallback
  for (const value of branch) {
    if (!isRecord(value) || value.type !== 'custom' || !isRecord(value.data)) {
      continue
    }
    if (value.customType === LOW_CONTEXT_MODE_ENTRY && isLowContextMode(value.data.mode)) {
      mode = value.data.mode
    } else if (value.customType === 'gpt-context-mode') {
      if (value.data.mode === 'low') mode = 'on'
      if (value.data.mode === 'high') mode = 'off'
    }
  }
  return mode
}

function modelKey(model: LowContextModeModel): string {
  return `${model.provider}/${model.id}`
}

function contextModel<T extends LowContextModeModel>(model: T, mode: LowContextMode, originalContextWindow: number): T {
  const contextWindow = mode === 'on' ? Math.min(originalContextWindow, LOW_CONTEXT_WINDOW) : originalContextWindow
  return model.contextWindow === contextWindow ? model : { ...model, contextWindow }
}

const STATUS_KEY = 'low-context-mode'

type LowContextModeError = LowContextModeHostError | PiExtensionError

class LowContextModeState extends Context.Service<
  LowContextModeState,
  {
    readonly mode: Ref.Ref<LowContextMode>
    readonly originalContextWindows: Ref.Ref<ReadonlyMap<string, number>>
  }
>()('low-context-mode/State') {
  static readonly layer = Layer.effect(
    LowContextModeState,
    Effect.gen(function* () {
      const mode = yield* Ref.make<LowContextMode>('on')
      const originalContextWindows = yield* Ref.make<ReadonlyMap<string, number>>(new Map())
      return LowContextModeState.of({ mode, originalContextWindows })
    }),
  )
}

class LowContextModeHostError extends Schema.TaggedError<LowContextModeHostError>()('LowContextModeHostError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

class LowContextModeService extends Context.Service<
  LowContextModeService,
  {
    readonly handleCommand: (
      args: string,
    ) => Effect.Effect<void, LowContextModeError, LowContextModeState | Pi | PiContextTag | PiSession | PiUi>
    readonly restore: () => Effect.Effect<
      LowContextMode,
      LowContextModeError,
      LowContextModeState | Pi | PiContextTag | PiSession | PiUi
    >
    readonly applyModel: (
      model: Model<Api> | undefined,
    ) => Effect.Effect<boolean, LowContextModeError, LowContextModeState | Pi | PiContextTag | PiUi>
    readonly shutdown: () => Effect.Effect<void, LowContextModeError, PiContextTag | PiUi>
  }
>()('low-context-mode/LowContextModeService') {}

function toHostError(operation: string, cause: unknown): LowContextModeHostError {
  return new LowContextModeHostError({ operation, message: cause instanceof Error ? cause.message : String(cause) })
}

function mapPi<A, E>(operation: string, effect: Effect.Effect<A, E>): Effect.Effect<A, LowContextModeError> {
  return effect.pipe(Effect.mapError((cause) => toHostError(operation, cause)))
}

const notify = Effect.fnUntraced(function* (
  message: string,
  type: 'info' | 'warning' | 'error',
): Effect.fn.Return<void, LowContextModeError, PiUi> {
  const ui = yield* PiUi
  yield* mapPi('notify', ui.notify(message, type))
})

const updateStatus = Effect.fnUntraced(function* (
  mode: LowContextMode,
  model: Model<Api> | undefined,
  failed = false,
  unknownOriginal = false,
): Effect.fn.Return<void, LowContextModeError, PiContextTag | PiUi> {
  const context = yield* PiContext
  if (context.mode !== 'tui' || !context.hasUI) return
  const ui = yield* PiUi
  const theme = yield* mapPi('theme', ui.theme())
  const label = theme?.fg ? theme.fg('muted', 'context: ') : 'context: '
  const suffix = failed
    ? ' (not applied)'
    : mode === 'on' && model?.api === 'pi-virtual'
      ? ' (virtual model not supported)'
      : unknownOriginal || !model || !Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0
        ? ' (unknown)'
        : ''
  yield* mapPi('setStatus', ui.setStatus(STATUS_KEY, `${label}${contextModeEmoji(mode)}${suffix}`))
})

const setModel = Effect.fnUntraced(function* (model: Model<Api>): Effect.fn.Return<void, LowContextModeError, Pi> {
  const pi = yield* Pi
  const applied = yield* mapPi('setModel', pi.model.set(model))
  if (!applied) {
    return yield* Effect.fail(
      new LowContextModeHostError({ operation: 'setModel', message: 'Model selection was rejected' }),
    )
  }
})

const applyModel = Effect.fnUntraced(function* (
  model: Model<Api> | undefined,
): Effect.fn.Return<boolean, LowContextModeError, LowContextModeState | Pi | PiContextTag | PiUi> {
  const state = yield* LowContextModeState
  const mode = yield* Ref.get(state.mode)
  if (model?.api === 'pi-virtual') {
    yield* updateStatus(mode, model)
    if (mode === 'on') yield* notify('Low context mode cannot limit virtual model routes', 'warning')
    return true
  }

  if (!model || !Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0) {
    yield* updateStatus(mode, model)
    return true
  }

  const context = yield* PiContext
  const registeredModel = yield* mapPi('findModel', context.findModel(model.provider, model.id))
  const key = modelKey(model)
  const cachedWindows = yield* Ref.get(state.originalContextWindows)
  const registeredWindow = registeredModel?.contextWindow
  const validRegisteredWindow =
    registeredWindow !== undefined && Number.isSafeInteger(registeredWindow) && registeredWindow > 0
      ? registeredWindow
      : undefined
  if (validRegisteredWindow === undefined && !cachedWindows.has(key) && model.contextWindow === LOW_CONTEXT_WINDOW) {
    yield* updateStatus(mode, model, false, true)
    yield* notify('Original context window is unavailable; leaving the model unchanged', 'warning')
    return true
  }

  const originalContextWindow = validRegisteredWindow ?? cachedWindows.get(key) ?? model.contextWindow
  yield* Ref.set(state.originalContextWindows, new Map(cachedWindows).set(key, originalContextWindow))

  const nextModel = contextModel(model, mode, originalContextWindow)
  if (nextModel !== model) {
    const applied = yield* setModel(nextModel).pipe(
      Effect.as(true),
      Effect.catchTag('LowContextModeHostError', (error) =>
        Effect.gen(function* () {
          yield* notify(`Unable to set context mode: ${error.message}`, 'error')
          yield* updateStatus(mode, model, true)
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
): Effect.fn.Return<void, LowContextModeError, LowContextModeState | Pi | PiContextTag | PiSession | PiUi> {
  const context = yield* PiContext
  const session = yield* PiSession
  const state = yield* LowContextModeState
  const mode = yield* Ref.get(state.mode)
  const nextMode = parseLowContextCommand(args, mode)
  if (!nextMode) {
    yield* notify('Usage: /low-context-mode [on|off|toggle]', 'warning')
    return
  }

  yield* Ref.set(state.mode, nextMode)
  const applied = yield* applyModel(context.model)
  if (!applied) {
    yield* Ref.set(state.mode, mode)
    yield* updateStatus(mode, context.model, true)
    return
  }

  yield* mapPi('appendEntry', session.appendEntry(LOW_CONTEXT_MODE_ENTRY, { mode: nextMode }))
  if (nextMode !== 'on' || context.model?.api !== 'pi-virtual') {
    yield* notify(`context: ${contextModeEmoji(nextMode)}`, 'info')
  }
})

const restore = Effect.fnUntraced(function* (): Effect.fn.Return<
  LowContextMode,
  LowContextModeError,
  LowContextModeState | Pi | PiContextTag | PiSession | PiUi
> {
  const context = yield* PiContext
  const session = yield* PiSession
  const state = yield* LowContextModeState
  const entries = yield* mapPi('getBranch', session.branch())
  const mode = restoreLowContextMode(entries)
  yield* Ref.set(state.mode, mode)
  yield* applyModel(context.model)
  return mode
})

const shutdown = Effect.fnUntraced(function* (): Effect.fn.Return<void, LowContextModeError, PiContextTag | PiUi> {
  const ui = yield* PiUi
  yield* mapPi('clearStatus', ui.setStatus(STATUS_KEY, undefined))
})

const LowContextModeLayer: Layer.Layer<LowContextModeService, never, never> = Layer.succeed(
  LowContextModeService,
  LowContextModeService.of({
    handleCommand,
    restore,
    applyModel,
    shutdown,
  }),
)

export {
  contextModeEmoji,
  contextModel,
  isLowContextMode,
  LOW_CONTEXT_MODE_ENTRY,
  LOW_CONTEXT_WINDOW,
  type LowContextMode,
  type LowContextModeError,
  LowContextModeHostError,
  LowContextModeLayer,
  type LowContextModeModel,
  LowContextModeService,
  LowContextModeState,
  modelKey,
  parseLowContextCommand,
  restoreLowContextMode,
}
