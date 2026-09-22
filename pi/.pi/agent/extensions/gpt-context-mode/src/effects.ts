import type { Api, Model } from '@earendil-works/pi-ai'
import { Pi, PiContext, type PiExtensionError, PiSession, PiUi } from '@eratio08/pi-effect'
import { Context, Effect, Layer, Ref, Schema } from 'effect'
import {
  contextModeEmoji,
  contextModel,
  GPT_CONTEXT_MODE_ENTRY,
  GPT5_6_LOW_CONTEXT_WINDOWS,
  type GptContextMode,
  isGpt5Model,
  modelKey,
  parseGptContextCommand,
  restoreGptContextMode,
} from './core.ts'

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
    ) => Effect.Effect<void, GptContextModeError, GptContextModeState | Pi | PiContext | PiSession | PiUi>
    readonly restore: () => Effect.Effect<
      GptContextMode,
      GptContextModeError,
      GptContextModeState | Pi | PiContext | PiSession | PiUi
    >
    readonly applyModel: (
      model: Model<Api> | undefined,
    ) => Effect.Effect<boolean, GptContextModeError, GptContextModeState | Pi | PiContext | PiUi>
    readonly shutdown: () => Effect.Effect<void, GptContextModeError, PiContext | PiUi>
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
): Effect.fn.Return<void, GptContextModeError, PiContext | PiUi> {
  const context = yield* PiContext
  if (context.mode !== 'tui' || !context.hasUI) return
  const ui = yield* PiUi
  const theme = yield* mapPi('theme', ui.theme())
  const label = theme?.fg ? theme.fg('muted', 'context: ') : 'context: '
  const active = isGpt5Model(model)
  yield* mapPi('setStatus', ui.setStatus(STATUS_KEY, `${label}${contextModeEmoji(mode)}${active ? '' : ' (inactive)'}`))
})

const setModel = Effect.fnUntraced(function* (model: Model<Api>): Effect.fn.Return<void, GptContextModeError, Pi> {
  const pi = yield* Pi
  yield* mapPi('setModel', pi.model.set(model))
})

const applyModel = Effect.fnUntraced(function* (
  model: Model<Api> | undefined,
): Effect.fn.Return<boolean, GptContextModeError, GptContextModeState | Pi | PiContext | PiUi> {
  const state = yield* GptContextModeState
  const mode = yield* Ref.get(state.mode)
  if (!isGpt5Model(model)) {
    yield* updateStatus(mode, model)
    return false
  }

  const key = modelKey(model)
  const cachedWindows = yield* Ref.get(state.lowContextWindows)
  const lowContextWindow = cachedWindows.get(key) ?? GPT5_6_LOW_CONTEXT_WINDOWS.get(model.id) ?? model.contextWindow
  yield* Ref.set(state.lowContextWindows, new Map(cachedWindows).set(key, lowContextWindow))

  const nextModel = contextModel(model, mode, lowContextWindow)
  if (nextModel !== model) {
    const applied = yield* setModel(nextModel).pipe(
      Effect.as(true),
      Effect.catchTag('GptContextModeHostError', (error) =>
        Effect.gen(function* () {
          yield* notify(`Unable to set GPT-5.6 context mode: ${error.message}`, 'error')
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
): Effect.fn.Return<void, GptContextModeError, GptContextModeState | Pi | PiContext | PiSession | PiUi> {
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
  if (!isGpt5Model(model)) {
    yield* notify('GPT-5.6 context mode only applies to GPT-5.6 models', 'warning')
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
  GptContextModeState | Pi | PiContext | PiSession | PiUi
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

const shutdown = Effect.fnUntraced(function* (): Effect.fn.Return<void, GptContextModeError, PiContext | PiUi> {
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
  type GptContextModeError,
  GptContextModeHostError,
  GptContextModeLayer,
  GptContextModeService,
  GptContextModeState,
}
