export const GPT5_HIGH_CONTEXT_WINDOW = 1_050_000

export const GPT5_6_LOW_CONTEXT_WINDOWS: ReadonlyMap<string, number> = new Map([
  ['gpt-5.6-luna', 200_000],
  ['gpt-5.6-sol', 272_000],
  ['gpt-5.6-terra', 272_000],
])

export const GPT_CONTEXT_MODE_ENTRY = 'gpt-context-mode'

export type GptContextMode = 'low' | 'high'

export type GptContextModeModel = {
  readonly api: string
  readonly id: string
  readonly provider: string
  readonly contextWindow: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isGptContextMode(value: unknown): value is GptContextMode {
  return value === 'low' || value === 'high'
}

export function contextModeEmoji(mode: GptContextMode): string {
  return mode === 'low' ? '🪶' : '🚀'
}

export function parseGptContextCommand(args: string, currentMode: GptContextMode): GptContextMode | undefined {
  const command = args.trim().toLowerCase()
  if (!command || command === 'toggle') {
    return currentMode === 'low' ? 'high' : 'low'
  }
  if (command === 'low' || command === 'high') {
    return command
  }
  return undefined
}

export function restoreGptContextMode(branch: readonly unknown[], fallback: GptContextMode = 'low'): GptContextMode {
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

export function isGpt5Model<T extends GptContextModeModel>(model: T | undefined): model is T {
  return model?.api === 'openai-responses' && GPT5_6_LOW_CONTEXT_WINDOWS.has(model.id)
}

export function modelKey(model: GptContextModeModel): string {
  return `${model.provider}/${model.id}`
}

export function contextModel<T extends GptContextModeModel>(
  model: T,
  mode: GptContextMode,
  lowContextWindow: number,
): T {
  const contextWindow = mode === 'high' ? GPT5_HIGH_CONTEXT_WINDOW : lowContextWindow
  return model.contextWindow === contextWindow ? model : { ...model, contextWindow }
}
