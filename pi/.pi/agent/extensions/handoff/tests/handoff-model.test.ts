import assert from 'node:assert/strict'
import { getPendingHandoffModel } from '../src/handoff-model.ts'

const handoffEntry = {
  type: 'custom',
  id: 'handoff-1',
  customType: 'handoff-model',
  data: {
    provider: 'anthropic',
    modelId: 'claude-opus-4-5',
    thinkingLevel: 'xhigh',
  },
}

assert.deepEqual(getPendingHandoffModel([handoffEntry]), {
  id: 'handoff-1',
  state: {
    provider: 'anthropic',
    modelId: 'claude-opus-4-5',
    thinkingLevel: 'xhigh',
  },
})

assert.equal(
  getPendingHandoffModel([
    handoffEntry,
    {
      type: 'custom',
      id: 'applied-1',
      customType: 'handoff-model-applied',
      data: { sourceId: 'handoff-1', applied: true },
    },
  ]),
  undefined,
)

assert.deepEqual(
  getPendingHandoffModel([
    handoffEntry,
    {
      type: 'custom',
      id: 'applied-1',
      customType: 'handoff-model-applied',
      data: { sourceId: 'handoff-1', applied: true },
    },
    {
      type: 'custom',
      id: 'handoff-2',
      customType: 'handoff-model',
      data: { provider: 'openai', modelId: 'gpt-5', thinkingLevel: 'medium' },
    },
  ]),
  {
    id: 'handoff-2',
    state: { provider: 'openai', modelId: 'gpt-5', thinkingLevel: 'medium' },
  },
)

assert.equal(
  getPendingHandoffModel([
    {
      type: 'custom',
      id: 'bad',
      customType: 'handoff-model',
      data: { provider: 'openai', modelId: 'gpt-5', thinkingLevel: 'wild' },
    },
  ]),
  undefined,
)

console.log('handoff model state check: ok')
