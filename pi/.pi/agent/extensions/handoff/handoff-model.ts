export const HANDOFF_MODEL_ENTRY = 'handoff-model'
export const HANDOFF_MODEL_APPLIED_ENTRY = 'handoff-model-applied'

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface HandoffModelState {
  provider: string
  modelId: string
  thinkingLevel: ThinkingLevel
}

const THINKING_LEVELS: readonly ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && THINKING_LEVELS.includes(value as ThinkingLevel)
}

function parseHandoffModelState(value: unknown): HandoffModelState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const provider = (value as { provider?: unknown }).provider
  const modelId = (value as { modelId?: unknown }).modelId
  const thinkingLevel = (value as { thinkingLevel?: unknown }).thinkingLevel
  if (typeof provider !== 'string' || typeof modelId !== 'string' || !isThinkingLevel(thinkingLevel)) {
    return undefined
  }

  return { provider, modelId, thinkingLevel }
}

export function getPendingHandoffModel(
  entries: readonly unknown[],
): { id: string; state: HandoffModelState } | undefined {
  let pending: { id: string; state: HandoffModelState } | undefined
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || (entry as { type?: unknown }).type !== 'custom') {
      continue
    }

    const customType = (entry as { customType?: unknown }).customType
    if (customType === HANDOFF_MODEL_ENTRY) {
      const id = (entry as { id?: unknown }).id
      const state = parseHandoffModelState((entry as { data?: unknown }).data)
      pending = typeof id === 'string' && state ? { id, state } : undefined
      continue
    }
    if (customType === HANDOFF_MODEL_APPLIED_ENTRY && pending) {
      const sourceId = ((entry as { data?: unknown }).data as { sourceId?: unknown } | undefined)?.sourceId
      if (sourceId === pending.id) {
        pending = undefined
      }
    }
  }
  return pending
}
