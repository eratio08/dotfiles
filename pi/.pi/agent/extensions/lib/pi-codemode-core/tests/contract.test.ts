import { describe, expect, test } from 'bun:test'
import * as Program from '../src/program.ts'
import * as WorkerProtocol from '../src/worker-protocol.ts'

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
    const error = Program.validateProgramDefinition(invalid)

    //then
    expect(error).toMatchObject({ _tag: 'validation', operation: 'definition' })
  })

  test('should reject invalid timeout configuration given a zero timeout', () => {
    //given
    const invalid = { cwd: '/tmp', filenamePrefix: 'test', timeoutMs: 0 }

    //when
    const error = Program.validateProgramRunOptions(invalid)

    //then
    expect(error).toMatchObject({ _tag: 'validation', operation: 'options' })
  })

  test('should preserve tagged failures given worker transport', () => {
    //given
    const failure = Program.createProgramFailure({
      _tag: 'invoke',
      operation: 'read',
      message: 'Read failed.',
      cause: { detail: 'not found' },
    })

    //when
    const decoded = WorkerProtocol.deserializeProgramError(WorkerProtocol.serializeProgramError(failure))

    //then
    expect(decoded).toEqual(failure)
    expect(Program.isProgramFailure(decoded)).toBe(true)
  })

  test('should preserve exception data given worker transport', () => {
    //given
    const error = new TypeError('bad value')

    //when
    const decoded = WorkerProtocol.deserializeProgramError(WorkerProtocol.serializeProgramError(error))

    //then
    expect(decoded).toMatchObject({ _tag: 'invoke', name: 'TypeError', message: 'bad value' })
  })

  test('should return a deserialize failure given malformed worker data', () => {
    //given
    const malformed = { kind: 'failure', failure: { _tag: 'invoke' } } as unknown as WorkerProtocol.WorkerError

    //when
    const decoded = WorkerProtocol.deserializeProgramError(malformed)

    //then
    expect(decoded).toMatchObject({ _tag: 'deserialize' })
  })
})
