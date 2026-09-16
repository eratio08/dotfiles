import type { Api, Model } from '@earendil-works/pi-ai'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
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

export class GptContextModeContext extends Context.Service<GptContextModeContext, ExtensionContext>()(
  'gpt-context-mode/ExtensionContext',
) {}

export class GptContextModePi extends Context.Service<GptContextModePi, ExtensionAPI>()('gpt-context-mode/Pi') {}

export class GptContextModeState extends Context.Service<
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

export class GptContextModeHostError extends Schema.TaggedError<GptContextModeHostError>()('GptContextModeHostError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

export class GptContextModeService extends Context.Service<
  GptContextModeService,
  {
    readonly handleCommand: (
      args: string,
    ) => Effect.Effect<void, GptContextModeHostError, GptContextModeContext | GptContextModePi | GptContextModeState>
    readonly restore: () => Effect.Effect<
      GptContextMode,
      GptContextModeHostError,
      GptContextModeContext | GptContextModePi | GptContextModeState
    >
    readonly applyModel: (
      model: Model<Api> | undefined,
    ) => Effect.Effect<boolean, GptContextModeHostError, GptContextModeContext | GptContextModePi | GptContextModeState>
    readonly shutdown: () => Effect.Effect<void, GptContextModeHostError, GptContextModeContext>
  }
>()('gpt-context-mode/GptContextModeService') {}

function hostMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function toHostError(operation: string, cause: unknown): GptContextModeHostError {
  return new GptContextModeHostError({ operation, message: hostMessage(cause) })
}

function tryHost<A>(operation: string, evaluate: () => A): Effect.Effect<A, GptContextModeHostError> {
  return Effect.try({
    try: evaluate,
    catch: (cause) => toHostError(operation, cause),
  })
}

const notify = Effect.fnUntraced(function* (
  message: string,
  type: 'info' | 'warning' | 'error',
): Effect.fn.Return<void, GptContextModeHostError, GptContextModeContext> {
  const ctx = yield* GptContextModeContext
  yield* tryHost('notify', () => {
    if (ctx.mode === 'tui' && ctx.hasUI) {
      ctx.ui.notify(message, type)
    }
  })
})

const updateStatus = Effect.fnUntraced(function* (
  mode: GptContextMode,
  model: Model<Api> | undefined,
): Effect.fn.Return<void, GptContextModeHostError, GptContextModeContext> {
  const ctx = yield* GptContextModeContext
  yield* tryHost('setStatus', () => {
    if (ctx.mode !== 'tui' || !ctx.hasUI) return
    const label = ctx.ui.theme?.fg ? ctx.ui.theme.fg('muted', 'context: ') : 'context: '
    const active = isGpt5Model(model)
    ctx.ui.setStatus(STATUS_KEY, `${label}${contextModeEmoji(mode)}${active ? '' : ' (inactive)'}`)
  })
})

const setModel = Effect.fnUntraced(function* (
  model: Model<Api>,
): Effect.fn.Return<void, GptContextModeHostError, GptContextModePi> {
  const pi = yield* GptContextModePi
  yield* Effect.tryPromise({
    try: () => pi.setModel(model),
    catch: (cause) => toHostError('setModel', cause),
  })
})

const applyModel = Effect.fnUntraced(function* (
  model: Model<Api> | undefined,
): Effect.fn.Return<boolean, GptContextModeHostError, GptContextModeContext | GptContextModePi | GptContextModeState> {
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
): Effect.fn.Return<void, GptContextModeHostError, GptContextModeContext | GptContextModePi | GptContextModeState> {
  const ctx = yield* GptContextModeContext
  const pi = yield* GptContextModePi
  const state = yield* GptContextModeState
  const mode = yield* Ref.get(state.mode)
  const nextMode = parseGptContextCommand(args, mode)
  if (!nextMode) {
    yield* notify('Usage: /gpt-context-mode [high|low|toggle]', 'warning')
    return
  }

  yield* Ref.set(state.mode, nextMode)
  yield* tryHost('appendEntry', () => pi.appendEntry(GPT_CONTEXT_MODE_ENTRY, { mode: nextMode }))
  const model = yield* tryHost('model', () => ctx.model)
  const applied = yield* applyModel(model)
  if (!isGpt5Model(model)) {
    yield* notify('GPT-5.6 context mode only applies to GPT-5.6 models', 'warning')
    return
  }
  if (applied) {
    const label = yield* tryHost('statusLabel', () => {
      if (ctx.mode !== 'tui' || !ctx.hasUI) return 'context: '
      return ctx.ui.theme?.fg ? ctx.ui.theme.fg('muted', 'context: ') : 'context: '
    })
    yield* notify(`${label}${contextModeEmoji(nextMode)}`, 'info')
  }
})

const restore = Effect.fnUntraced(function* (): Effect.fn.Return<
  GptContextMode,
  GptContextModeHostError,
  GptContextModeContext | GptContextModePi | GptContextModeState
> {
  const ctx = yield* GptContextModeContext
  const state = yield* GptContextModeState
  const entries = yield* tryHost('getEntries', () => ctx.sessionManager.getEntries())
  const mode = restoreGptContextMode(entries)
  yield* Ref.set(state.mode, mode)
  const model = yield* tryHost('model', () => ctx.model)
  yield* applyModel(model)
  return mode
})

const shutdown = Effect.fnUntraced(function* (): Effect.fn.Return<
  void,
  GptContextModeHostError,
  GptContextModeContext
> {
  const ctx = yield* GptContextModeContext
  yield* tryHost('clearStatus', () => {
    if (ctx.mode === 'tui' && ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined)
    }
  })
})

export const GptContextModeLayer: Layer.Layer<GptContextModeService, never, never> = Layer.succeed(
  GptContextModeService,
  GptContextModeService.of({
    handleCommand,
    restore,
    applyModel,
    shutdown,
  }),
)
