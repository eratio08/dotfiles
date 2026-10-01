import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, Ref, Result, Schema } from 'effect'

const VALID_MODES = ['off', 'lite', 'full', 'ultra', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra'] as const

type CavemanMode = (typeof VALID_MODES)[number]
const CavemanModeSchema = Schema.Literals(VALID_MODES)
const CavemanModeEntrySchema = Schema.Struct({
  type: Schema.Literal('custom'),
  customType: Schema.Literal('caveman-mode'),
  data: Schema.Struct({ mode: CavemanModeSchema }),
})

const DEFAULT_MODE: CavemanMode = 'full'
const MODE_SET = new Set<string>(VALID_MODES)

function normalizeMode(value: unknown, fallback: CavemanMode | null = null): CavemanMode | null {
  if (typeof value !== 'string') return fallback
  const mode = value.trim().toLowerCase()
  if (mode === 'wenyan') return 'wenyan-full'
  return MODE_SET.has(mode) ? (mode as CavemanMode) : fallback
}

function resolveSessionMode(entries: unknown, fallbackMode: CavemanMode = DEFAULT_MODE): CavemanMode {
  const fallback = normalizeMode(fallbackMode, DEFAULT_MODE) ?? DEFAULT_MODE
  const decodedEntries = Schema.decodeUnknownResult(Schema.Array(Schema.Unknown))(entries)
  if (Result.isFailure(decodedEntries)) return fallback

  for (let index = decodedEntries.success.length - 1; index >= 0; index -= 1) {
    const decodedEntry = Schema.decodeUnknownResult(CavemanModeEntrySchema)(decodedEntries.success[index])
    if (Result.isSuccess(decodedEntry)) return decodedEntry.success.data.mode
  }

  return fallback
}

function parseCavemanCommand(
  text: string,
  defaultMode: CavemanMode = DEFAULT_MODE,
): { type: 'set-mode'; mode: CavemanMode } | { type: 'invalid'; reason: 'invalid-mode'; mode: string } {
  const fallback = normalizeMode(defaultMode, DEFAULT_MODE) ?? DEFAULT_MODE
  const normalizedText = String(text || '')
    .trim()
    .toLowerCase()

  if (!normalizedText) {
    return { type: 'set-mode', mode: fallback }
  }

  const [primary] = normalizedText.split(/\s+/)
  const mode = normalizeMode(primary)
  if (mode) return { type: 'set-mode', mode }
  if (['stop', 'disable'].includes(primary)) return { type: 'set-mode', mode: 'off' }
  return { type: 'invalid', reason: 'invalid-mode', mode: primary }
}

function parseModeChange(text: string, defaultMode: CavemanMode = DEFAULT_MODE): CavemanMode | null {
  const fallback = normalizeMode(defaultMode, DEFAULT_MODE) ?? DEFAULT_MODE
  const normalizedText = String(text || '')
    .trim()
    .toLowerCase()
  if (!normalizedText) return null

  if (
    /\b(stop|disable|deactivate|turn off)\b.*\bcaveman\b/.test(normalizedText) ||
    /\bcaveman\b.*\b(stop|disable|deactivate|turn off)\b/.test(normalizedText) ||
    /\bnormal mode\b/.test(normalizedText)
  ) {
    return 'off'
  }

  const commandMatch = normalizedText.match(/^\/caveman(?:\s+(\S+))?$/)
  if (commandMatch) {
    const parsed = parseCavemanCommand(commandMatch[1] || '', fallback)
    return parsed.type === 'set-mode' ? parsed.mode : null
  }

  if (
    /\b(caveman mode|talk like caveman|use caveman|less tokens|be brief)\b/.test(normalizedText) ||
    /\b(activate|enable|turn on|start)\b.*\bcaveman\b/.test(normalizedText) ||
    /\bcaveman\b.*\b(mode|activate|enable|turn on|start)\b/.test(normalizedText)
  ) {
    return fallback
  }

  return null
}

function getModeInstructions(mode: CavemanMode): string {
  const activeMode = normalizeMode(mode, DEFAULT_MODE) ?? DEFAULT_MODE
  if (activeMode === 'off') return ''

  const common = [
    `CAVEMAN MODE ACTIVE — level: ${activeMode}`,
    'Respond terse like smart caveman. Keep technical substance exact.',
    "Preserve user's dominant language.",
    'Keep code, commands, API names, commit types, exact error strings verbatim.',
    'Code, commits, PR text normal.',
    'Drop caveman style for security warnings, irreversible actions, or when compression creates ambiguity. Resume after clear part done.',
  ]

  const perMode: Record<Exclude<CavemanMode, 'off'>, string[]> = {
    lite: ['No filler, pleasantries, or hedging.', 'Keep full sentences.'],
    full: [
      'Drop articles, filler, pleasantries, hedging.',
      'Fragments OK.',
      'No decorative tables or long raw logs unless asked.',
    ],
    ultra: ['Ultra terse.', 'Strip conjunctions when meaning stays unambiguous.', 'State each fact once.'],
    'wenyan-lite': ['Use semi-classical Chinese.', 'Compressed style, but keep grammar readable.'],
    'wenyan-full': ['Use classical Chinese with high terseness.', 'Prefer compact classical phrasing.'],
    'wenyan-ultra': [
      'Use extremely terse classical Chinese.',
      'Maximum compression without losing technical correctness.',
    ],
  }

  return [...common, ...perMode[activeMode as Exclude<CavemanMode, 'off'>]].join('\n')
}

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

class CavemanContext extends Context.Service<CavemanContext, ExtensionContext>()('caveman/ExtensionContext') {}

class CavemanHostError extends Schema.TaggedError<CavemanHostError>()('CavemanHostError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

function toHostError(operation: string, cause: unknown): CavemanHostError {
  return new CavemanHostError({ operation, message: String(cause) })
}

function tryHost<A>(operation: string, evaluate: () => A): Effect.Effect<A, CavemanHostError> {
  return Effect.try({
    try: evaluate,
    catch: (cause: unknown) => toHostError(operation, cause),
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

class Caveman extends Context.Service<
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

function CavemanLayer(pi: ExtensionAPI): Layer.Layer<Caveman, never, never> {
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

export {
  Caveman,
  CavemanContext,
  CavemanHostError,
  CavemanLayer,
  type CavemanMode,
  CavemanModeEntrySchema,
  CavemanModeSchema,
  DEFAULT_MODE,
  getModeInstructions,
  normalizeMode,
  parseCavemanCommand,
  parseModeChange,
  resolveSessionMode,
  VALID_MODES,
}
