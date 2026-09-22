import { describe, expect, test } from 'bun:test'
import { formatCodeModeValue, serializeCodeModeOutput, truncateCodeModeOutput } from '../src/code-mode-output.ts'

describe('code mode output', () => {
  test('formats primitive and JSON values', () => {
    //given
    const values = [undefined, null, 'text', { answer: 42 }]

    //when
    const formatted = values.map((value) => formatCodeModeValue(value))

    //then
    expect(formatted).toEqual(['undefined', 'null', 'text', '{\n  "answer": 42\n}'])
  })

  test('falls back to string for circular values', () => {
    //given
    const value: Record<string, unknown> = {}
    value.self = value

    //when
    const output = formatCodeModeValue(value)

    //then
    expect(output).toBe('[object Object]')
  })

  test('truncates output within byte and line limits', () => {
    //given
    const value = 'one\ntwo\nthree'

    //when
    const result = serializeCodeModeOutput(value, { maxBytes: 30, maxLines: 2 })

    //then
    expect(result.truncated).toBe(true)
    expect(new TextEncoder().encode(result.output).byteLength).toBeLessThanOrEqual(30)
    expect(result.output.split('\n').length).toBeLessThanOrEqual(2)
  })

  test('keeps the truncation notice inside a small byte limit', () => {
    //given
    const value = 'long output'

    //when
    const result = truncateCodeModeOutput(value, { maxBytes: 5, maxLines: 1 })

    //then
    expect(result).toEqual({ output: '... o', truncated: true })
  })
})
