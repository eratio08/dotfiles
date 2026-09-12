import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, Ref, Schema } from 'effect'
import {
  type CavemanMode,
  DEFAULT_MODE,
  getModeInstructions,
  parseCavemanCommand,
  parseModeChange,
  resolveSessionMode,
} from './core.ts'

const SAVE_TYPE = 'caveman-mode'
const STATUS_KEY = 'caveman'
const LEVEL_ICONS: Record<Exclude<CavemanMode, 'off'>, string> = {
  lite: '🌿',
  full: '⚡',
  ultra: '🔥',
  'wenyan-lite': '🌿',
  'wenyan-full': '⚡',
  'wenyan-ultra': '🔥',
}

export class CavemanContext extends Context.Service<CavemanContext, ExtensionContext>()('caveman/ExtensionContext') {}

export class CavemanHostError extends Schema.TaggedError<CavemanHostError>()('CavemanHostError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

function toHostError(operation: string, cause: unknown): CavemanHostError {
  return new CavemanHostError({ operation, message: String(cause) })
}

function tryHost<A>(operation: string, evaluate: () => A): Effect.Effect<A, CavemanHostError> {
  return Effect.try({
    try: evaluate,
    catch: (cause) => toHostError(operation, cause),
  })
}

const setStatus = Effect.fnUntraced(function* (
  mode: CavemanMode,
  isActive: boolean,
): Effect.fn.Return<void, CavemanHostError, CavemanContext> {
  const ctx = yield* CavemanContext
  yield* tryHost('setStatus', () => {
    if (!ctx.hasUI || !ctx.ui?.setStatus || !ctx.ui.theme?.fg) return
    if (mode === 'off') {
      ctx.ui.setStatus(STATUS_KEY, '')
      return
    }

    const theme = ctx.ui.theme
    const indicator = isActive ? theme.fg('accent', '●') : theme.fg('dim', '○')
    const icon = LEVEL_ICONS[mode as Exclude<CavemanMode, 'off'>] ?? '🪨'
    ctx.ui.setStatus(STATUS_KEY, `${indicator} 🪨 ${theme.fg('muted', 'caveman: ')}${theme.fg('text', icon)}`)
  })
})

const notify = Effect.fnUntraced(function* (
  message: string,
  type: 'info' | 'warning' | 'error',
): Effect.fn.Return<void, CavemanHostError, CavemanContext> {
  const ctx = yield* CavemanContext
  yield* tryHost('notify', () => {
    if (ctx.hasUI) {
      ctx.ui.notify(message, type)
    }
  })
})

export class Caveman extends Context.Service<
  Caveman,
  {
    readonly mode: Effect.Effect<CavemanMode>
    readonly agentActive: Effect.Effect<boolean>
    readonly notify: (
      message: string,
      type: 'info' | 'warning' | 'error',
    ) => Effect.Effect<void, CavemanHostError, CavemanContext>
    readonly setMode: (mode: CavemanMode, notify?: boolean) => Effect.Effect<void, CavemanHostError, CavemanContext>
    readonly handleCommand: (args: string) => Effect.Effect<void, CavemanHostError, CavemanContext>
    readonly handleInput: (text: string) => Effect.Effect<void, CavemanHostError, CavemanContext>
    readonly buildSystemPrompt: (systemPrompt: string) => Effect.Effect<string | undefined, CavemanHostError>
    readonly restoreMode: () => Effect.Effect<CavemanMode, CavemanHostError, CavemanContext>
    readonly setAgentActive: (isActive: boolean) => Effect.Effect<void, CavemanHostError, CavemanContext>
    readonly sendAlias: (skillName: string, args: string) => Effect.Effect<void, CavemanHostError, CavemanContext>
    readonly shutdown: () => Effect.Effect<void, CavemanHostError, CavemanContext>
  }
>()('caveman/Caveman') {}

export function CavemanLayer(pi: ExtensionAPI): Layer.Layer<Caveman, never, never> {
  return Layer.effect(
    Caveman,
    Effect.gen(function* () {
      const modeRef = yield* Ref.make<CavemanMode>(DEFAULT_MODE)
      const activeRef = yield* Ref.make(false)

      const mode = Ref.get(modeRef)
      const agentActive = Ref.get(activeRef)

      const setMode = Effect.fnUntraced(function* (modeValue: CavemanMode, shouldNotify = true) {
        yield* tryHost('appendEntry', () => pi.appendEntry(SAVE_TYPE, { mode: modeValue }))
        yield* Ref.set(modeRef, modeValue)
        const isActive = yield* Ref.get(activeRef)
        yield* setStatus(modeValue, isActive)
        if (shouldNotify) {
          yield* notify(`caveman: ${modeValue}`, 'info')
        }
      })

      const handleCommand = Effect.fnUntraced(function* (args: string) {
        const parsed = parseCavemanCommand(args, DEFAULT_MODE)
        if (parsed.type !== 'set-mode') {
          yield* notify('Unknown caveman mode', 'warning')
          return
        }
        yield* setMode(parsed.mode)
      })

      const handleInput = Effect.fnUntraced(function* (text: string) {
        const modeValue = parseModeChange(text, DEFAULT_MODE)
        if (modeValue) {
          yield* setMode(modeValue, false)
        }
      })

      const buildSystemPrompt = Effect.fnUntraced(function* (systemPrompt: string) {
        const modeValue = yield* Ref.get(modeRef)
        if (modeValue === 'off') return
        const instructions = getModeInstructions(modeValue)
        if (!instructions) return
        return `${systemPrompt}\n\n${instructions}`
      })

      const restoreMode = Effect.fnUntraced(function* () {
        const ctx = yield* CavemanContext
        const entries = yield* Effect.sync(() => ctx.sessionManager.getBranch())
        const modeValue = resolveSessionMode(entries, DEFAULT_MODE)
        yield* Ref.set(modeRef, modeValue)
        const isActive = yield* Ref.get(activeRef)
        yield* setStatus(modeValue, isActive)
        return modeValue
      })

      const setAgentActive = Effect.fnUntraced(function* (isActive: boolean) {
        yield* Ref.set(activeRef, isActive)
        const modeValue = yield* Ref.get(modeRef)
        yield* setStatus(modeValue, isActive)
      })

      const sendAlias = Effect.fnUntraced(function* (skillName: string, args: string) {
        const ctx = yield* CavemanContext
        const suffix = String(args ?? '').trim()
        const message = suffix ? `/skill:${skillName} ${suffix}` : `/skill:${skillName}`
        const isIdle = yield* Effect.sync(() => ctx.isIdle())
        if (isIdle) {
          yield* tryHost('sendUserMessage', () => pi.sendUserMessage(message))
          return
        }

        yield* tryHost('sendUserMessage', () => pi.sendUserMessage(message, { deliverAs: 'followUp' }))
        yield* notify(`${skillName} queued`, 'info')
      })

      const shutdown = Effect.fnUntraced(function* () {
        const ctx = yield* CavemanContext
        yield* Ref.set(activeRef, false)
        yield* tryHost('clearStatus', () => {
          if (ctx.hasUI) {
            ctx.ui.setStatus(STATUS_KEY, '')
          }
        })
      })

      return Caveman.of({
        mode,
        agentActive,
        notify,
        setMode,
        handleCommand,
        handleInput,
        buildSystemPrompt,
        restoreMode,
        setAgentActive,
        sendAlias,
        shutdown,
      })
    }),
  )
}
