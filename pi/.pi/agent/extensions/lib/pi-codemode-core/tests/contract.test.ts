import { describe, expect, test } from 'bun:test'
import { validateProgramDefinition, validateProgramRunOptions } from '../src/contract.ts'
import { createProgramFailure, deserializeProgramError, isProgramFailure, serializeProgramError } from '../src/index.ts'
import type { WorkerError } from '../src/protocol.ts'

const definition = {
  apiName: 'ExampleApi',
  programName: 'ExampleProgram',
  declarations: '',
  methods: [{ name: 'read', kind: 'async' as const }],
  examples: [],
}

describe('code mode contracts', () => {
  test('should reject an empty source configuration given a definition with no methods', () => {
    //given
    const invalid = { ...definition, methods: [] }

    //when
    const error = validateProgramDefinition(invalid)

    //then
    expect(error).toMatchObject({ _tag: 'validation', operation: 'definition' })
  })

  test('should reject invalid timeout configuration given a zero timeout', () => {
    //given
    const invalid = { cwd: '/tmp', filenamePrefix: 'test', timeoutMs: 0 }

    //when
    const error = validateProgramRunOptions(invalid)

    //then
    expect(error).toMatchObject({ _tag: 'validation', operation: 'options' })
  })

  test('should preserve tagged failures given worker transport', () => {
    //given
    const failure = createProgramFailure({
      _tag: 'invoke',
      operation: 'read',
      message: 'Read failed.',
      cause: { detail: 'not found' },
    })

    //when
    const decoded = deserializeProgramError(serializeProgramError(failure))

    //then
    expect(decoded).toEqual(failure)
    expect(isProgramFailure(decoded)).toBe(true)
  })

  test('should preserve exception data given worker transport', () => {
    //given
    const error = new TypeError('bad value')

    //when
    const decoded = deserializeProgramError(serializeProgramError(error))

    //then
    expect(decoded).toMatchObject({ _tag: 'invoke', name: 'TypeError', message: 'bad value' })
  })

  test('should return a deserialize failure given malformed worker data', () => {
    //given
    const malformed = { kind: 'failure', failure: { _tag: 'invoke' } } as unknown as WorkerError

    //when
    const decoded = deserializeProgramError(malformed)

    //then
    expect(decoded).toMatchObject({ _tag: 'deserialize' })
  })
})
