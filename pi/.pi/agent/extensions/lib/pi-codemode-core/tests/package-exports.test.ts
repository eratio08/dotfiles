import { describe, expect, test } from 'bun:test'
import { CodeModeEffectHost, createCodeModeCore } from '@eratio/pi-codemode-core'
import { serializeCodeModeOutput } from '@eratio/pi-codemode-core/output'

describe('package exports', () => {
  test('loads the root and output entry points', () => {
    expect(typeof CodeModeEffectHost).toBe('function')
    expect(typeof createCodeModeCore).toBe('function')
    expect(typeof serializeCodeModeOutput).toBe('function')
  })
})
