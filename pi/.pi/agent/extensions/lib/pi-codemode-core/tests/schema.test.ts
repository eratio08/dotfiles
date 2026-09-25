import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { validateProgramDefinition, validateProgramRunOptions } from '../src/contract.ts'
import { deserializeProgramError } from '../src/index.ts'
import {
  CodeModeAsyncResponseSchema,
  CodeModeEncodedHostErrorSchema,
  CodeModeFailureSchema,
  CodeModeFailureWireValueSchema,
  CodeModeHostErrorEnvelopeSchema,
  CodeModeSyncResponseSchema,
  CodeModeWireValueSchema,
  CodeModeWorkerFailureMessageSchema,
  CodeModeWorkerMessageSchema,
} from '../src/schema.ts'

const definition = {
  apiName: 'ExampleApi',
  programName: 'ExampleProgram',
  declarations: '',
  methods: [{ name: 'read', kind: 'async' as const }],
  examples: ['await api.read()'],
}

describe('code mode schemas', () => {
  test('should accept a public definition given valid data', () => {
    //given
    const value = definition

    //when
    const error = validateProgramDefinition(value)

    //then
    expect(error).toBeUndefined()
  })

  test('should accept run options given valid data', () => {
    //given
    const value = { cwd: '/tmp', filenamePrefix: 'schema', timeoutMs: 1000, execution: 'worker' as const }

    //when
    const error = validateProgramRunOptions(value)

    //then
    expect(error).toBeUndefined()
  })

  test('should preserve the definition validation message given an invalid definition', () => {
    //given
    const value = { ...definition, methods: [] }

    //when
    const error = validateProgramDefinition(value)

    //then
    expect(error).toEqual({
      _tag: 'validation',
      operation: 'definition',
      message: 'The code mode must declare at least one method.',
    })
  })

  test('should preserve the options validation message given invalid run options', () => {
    //given
    const value = { cwd: '/tmp', filenamePrefix: 'schema', timeoutMs: 0 }

    //when
    const error = validateProgramRunOptions(value)

    //then
    expect(error).toEqual({
      _tag: 'validation',
      operation: 'options',
      message: 'The code mode timeout must be a positive finite number.',
    })
  })

  test('should accept built-in tags and reject unknown tags given failure values', () => {
    //given
    const tags = [
      'validation',
      'transform',
      'compile',
      'invoke',
      'timeout',
      'cancellation',
      'worker',
      'transport',
      'deserialize',
      'serialize',
    ] as const
    const values = tags.map((_tag) => ({ _tag, operation: 'test', message: 'failure' }))
    const decode = Schema.decodeUnknownSync(Schema.Array(CodeModeFailureSchema))

    //when
    const decoded = decode(values)

    //then
    expect(decoded.map((value) => value._tag)).toEqual([...tags])
    expect(() => decode([...values, { _tag: 'unknown', operation: 'test', message: 'failure' }])).toThrow()
  })

  test('should accept failure wire data given structured-cloneable values', () => {
    //given
    const value = { _tag: 'custom', operation: 'test', message: 'failure', cause: { retryable: false } }
    const decode = Schema.decodeUnknownSync(CodeModeFailureWireValueSchema)

    //when
    const decoded = decode(value)

    //then
    expect(decoded).toEqual(value)
  })

  test('should return a deserialize failure given malformed failure wire data', () => {
    //given
    const value = {
      kind: 'failure',
      failure: { _tag: 'invoke', operation: 'test', message: 'failure', cause: () => undefined },
    }

    //when
    const decoded = deserializeProgramError(value)

    //then
    expect(decoded).toMatchObject({ _tag: 'deserialize', operation: 'deserialize' })
  })

  test('should accept recursive wire values and reject invalid values given schema decoding', () => {
    //given
    const value = { nested: [1, 'two', null, { enabled: true }], count: 2n }
    const decode = Schema.decodeUnknownSync(CodeModeWireValueSchema)

    //when
    const decoded = decode(value)

    //then
    expect(decoded).toEqual(value)
    expect(() => decode({ value: Symbol('not-wire') })).toThrow()
  })

  test('should validate the host error envelope given valid data', () => {
    //given
    const value = { type: 'code-mode-host-error' as const, value: { code: 'FAILED' } }
    const decode = Schema.decodeUnknownSync(CodeModeHostErrorEnvelopeSchema)

    //when
    const decoded = decode(value)

    //then
    expect(decoded).toEqual(value)
  })

  test('should validate the encoded host error envelope given valid data', () => {
    //given
    const value = { type: 'code-mode-host-error' as const, value: { code: 'FAILED' } }
    const decode = Schema.decodeUnknownSync(CodeModeEncodedHostErrorSchema)

    //when
    const decoded = decode(value)

    //then
    expect(decoded).toEqual(value)
    expect(() => decode({ ...value, value: () => undefined })).toThrow()
  })

  test('should match response data to the status flag given worker messages', () => {
    //given
    const responses = [
      {
        accepts: Schema.is(CodeModeSyncResponseSchema),
        value: { type: 'sync-result', id: 1, ok: true, value: undefined },
      },
      { accepts: Schema.is(CodeModeSyncResponseSchema), value: { type: 'sync-result', id: 1, ok: true } },
      {
        accepts: Schema.is(CodeModeSyncResponseSchema),
        value: {
          type: 'sync-result',
          id: 1,
          ok: false,
          error: { kind: 'exception', name: 'Error', message: 'failed' },
        },
      },
      { accepts: Schema.is(CodeModeSyncResponseSchema), value: { type: 'sync-result', id: 1, ok: false } },
      {
        accepts: Schema.is(CodeModeAsyncResponseSchema),
        value: { type: 'async-result', id: 1, ok: true, value: undefined },
      },
      { accepts: Schema.is(CodeModeAsyncResponseSchema), value: { type: 'async-result', id: 1, ok: true } },
      {
        accepts: Schema.is(CodeModeAsyncResponseSchema),
        value: {
          type: 'async-result',
          id: 1,
          ok: false,
          error: { kind: 'exception', name: 'Error', message: 'failed' },
        },
      },
      { accepts: Schema.is(CodeModeAsyncResponseSchema), value: { type: 'async-result', id: 1, ok: false } },
    ]

    //when
    const accepted = responses.map(({ accepts, value }) => accepts(value))

    //then
    expect(accepted).toEqual([true, false, true, false, true, false, true, false])
  })

  test('should return a deserialize failure given a worker failure without error data', () => {
    //given
    const decode = Schema.decodeUnknownSync(CodeModeWorkerFailureMessageSchema)

    //when
    const decoded = decode({ type: 'error' })

    //then
    expect(deserializeProgramError(decoded.error)).toMatchObject({ _tag: 'deserialize' })
  })

  test('should validate worker messages given serializable data', () => {
    //given
    const value = { type: 'async-call' as const, id: 1, method: 'read', args: ['value'] }
    const decode = Schema.decodeUnknownSync(CodeModeWorkerMessageSchema)

    //when
    const decoded = decode(value)

    //then
    expect(decoded).toEqual(value)
    expect(() => decode({ ...value, id: 0 })).toThrow()
  })
})
