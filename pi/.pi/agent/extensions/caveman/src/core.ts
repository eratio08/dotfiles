import { Result, Schema } from 'effect'

export const VALID_MODES = ['off', 'lite', 'full', 'ultra', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra'] as const

export type CavemanMode = (typeof VALID_MODES)[number]
export const CavemanModeSchema = Schema.Literals(VALID_MODES)
export const CavemanModeEntrySchema = Schema.Struct({
  type: Schema.Literal('custom'),
  customType: Schema.Literal('caveman-mode'),
  data: Schema.Struct({ mode: CavemanModeSchema }),
})

export const DEFAULT_MODE: CavemanMode = 'full'
const MODE_SET = new Set<string>(VALID_MODES)

export function normalizeMode(value: unknown, fallback: CavemanMode | null = null): CavemanMode | null {
  if (typeof value !== 'string') return fallback
  const mode = value.trim().toLowerCase()
  if (mode === 'wenyan') return 'wenyan-full'
  return MODE_SET.has(mode) ? (mode as CavemanMode) : fallback
}

export function resolveSessionMode(entries: unknown, fallbackMode: CavemanMode = DEFAULT_MODE): CavemanMode {
  const fallback = normalizeMode(fallbackMode, DEFAULT_MODE) ?? DEFAULT_MODE
  const decodedEntries = Schema.decodeUnknownResult(Schema.Array(Schema.Unknown))(entries)
  if (Result.isFailure(decodedEntries)) return fallback

  for (let index = decodedEntries.success.length - 1; index >= 0; index -= 1) {
    const decodedEntry = Schema.decodeUnknownResult(CavemanModeEntrySchema)(decodedEntries.success[index])
    if (Result.isSuccess(decodedEntry)) return decodedEntry.success.data.mode
  }

  return fallback
}

export function parseCavemanCommand(
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

export function parseModeChange(text: string, defaultMode: CavemanMode = DEFAULT_MODE): CavemanMode | null {
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

export function getModeInstructions(mode: CavemanMode): string {
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
