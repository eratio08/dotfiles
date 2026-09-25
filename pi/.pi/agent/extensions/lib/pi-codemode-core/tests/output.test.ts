import { describe, expect, test } from 'bun:test'
import { formatValue, serializeOutput, truncateOutput } from '../src/output.ts'

describe('code mode output', () => {
  test('should format primitive and JSON values given supported input', () => {
    //given
    const values = [undefined, null, 'text', { answer: 42 }]

    //when
    const formatted = values.map((value) => formatValue(value))

    //then
    expect(formatted).toEqual(['undefined', 'null', 'text', '{\n  "answer": 42\n}'])
  })

  test('should fall back to string conversion given a circular value', () => {
    //given
    const value: Record<string, unknown> = {}
    value.self = value

    //when
    const output = formatValue(value)

    //then
    expect(output).toBe('[object Object]')
  })

  test('should enforce byte and line limits given oversized output', () => {
    //given
    const value = 'one\ntwo\nthree'

    //when
    const result = serializeOutput(value, { maxBytes: 30, maxLines: 2 })

    //then
    expect(result.truncated).toBe(true)
    expect(new TextEncoder().encode(result.output).byteLength).toBeLessThanOrEqual(30)
    expect(result.output.split('\n').length).toBeLessThanOrEqual(2)
  })

  test('should keep the truncation notice within the byte limit given a small output budget', () => {
    //given
    const value = 'long output'

    //when
    const result = truncateOutput(value, { maxBytes: 5, maxLines: 1 })

    //then
    expect(result).toEqual({ output: '... o', truncated: true })
  })
})
