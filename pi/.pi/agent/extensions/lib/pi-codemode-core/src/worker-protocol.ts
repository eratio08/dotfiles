import type { MessagePort } from 'node:worker_threads'
import { Schema } from 'effect'
import {
  type CodeModeEncodedHostError,
  type CodeModeHostError,
  CodeModeMethodSchema,
  CodeModeWireValueSchema,
  createCodeModeEncodedHostError,
  createCodeModeHostError,
  createCodeModePositiveFiniteNumberSchema,
  createProgramFailure,
  isCodeModeEncodedHostError,
  isCodeModeHostError,
  isCodeModeWireValue,
  isProgramFailure,
  type ProgramFailure,
  type ProgramHostErrorCodec,
  type ProgramMethod,
  type ProgramWireValue,
} from './program.ts'

/**
 * Defines the serializable fields used to send a program failure across the worker boundary.
 */
type ProgramFailureWireValue = {
  readonly _tag: string
  readonly operation: string
  readonly message: string
  readonly cause?: ProgramWireValue
  readonly name?: string
  readonly stack?: string
}

type WorkerFailureValue = {
  readonly kind: 'failure'
  readonly failure: ProgramFailureWireValue
}

type WorkerExceptionValue = {
  readonly kind: 'exception'
  readonly name: string
  readonly message: string
  readonly stack?: string
}

type WorkerHostErrorValue = {
  readonly kind: 'host'
  readonly value: ProgramWireValue
}

type WorkerError = WorkerFailureValue | WorkerExceptionValue | WorkerHostErrorValue

type CodeModeWorkerStart = {
  readonly type: 'start'
  readonly code: string
  readonly filename: string
  readonly timeoutMs: number
  readonly remainingTimeoutMs: number
  readonly methods: readonly ProgramMethod[]
  readonly syncState: SharedArrayBuffer
  readonly syncPort: MessagePort
}

type CodeModeSyncRequest = {
  readonly type: 'sync-call'
  readonly id: number
  readonly method: string
  readonly args: readonly unknown[]
}

type CodeModeAsyncRequest = {
  readonly type: 'async-call'
  readonly id: number
  readonly method: string
  readonly args: readonly unknown[]
}

type CodeModeSyncSuccessResponse = {
  readonly type: 'sync-result'
  readonly id: number
  readonly ok: true
  readonly value: unknown
}

type CodeModeSyncFailureResponse = {
  readonly type: 'sync-result'
  readonly id: number
  readonly ok: false
  readonly error: WorkerError
}

type CodeModeSyncResponse = CodeModeSyncSuccessResponse | CodeModeSyncFailureResponse

type CodeModeAsyncSuccessResponse = {
  readonly type: 'async-result'
  readonly id: number
  readonly ok: true
  readonly value: unknown
}

type CodeModeAsyncFailureResponse = {
  readonly type: 'async-result'
  readonly id: number
  readonly ok: false
  readonly error: WorkerError
}

type CodeModeAsyncResponse = CodeModeAsyncSuccessResponse | CodeModeAsyncFailureResponse

type CodeModeWorkerResult = {
  readonly type: 'result'
  readonly value: unknown
}

type CodeModeWorkerFailure = {
  readonly type: 'error'
  readonly error: WorkerError
}

type CodeModeWorkerMessage = CodeModeSyncRequest | CodeModeAsyncRequest | CodeModeWorkerResult | CodeModeWorkerFailure

type CodeModeParentMessage = CodeModeWorkerStart | CodeModeSyncResponse | CodeModeAsyncResponse

const CodeModeFailureWireValueSchema = Schema.Struct({
  _tag: Schema.String,
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(CodeModeWireValueSchema),
  name: Schema.optional(Schema.String),
  stack: Schema.optional(Schema.String),
})

const CodeModeWorkerHostErrorValueSchema = Schema.Struct({
  kind: Schema.Literal('host'),
  value: CodeModeWireValueSchema,
})

const CodeModeWorkerHostErrorShapeSchema = Schema.Struct({
  kind: Schema.Literal('host'),
  value: Schema.Unknown,
})

const CodeModeWorkerFailureValueSchema = Schema.Struct({
  kind: Schema.Literal('failure'),
  failure: CodeModeFailureWireValueSchema,
})

const CodeModeWorkerExceptionValueSchema = Schema.Struct({
  kind: Schema.Literal('exception'),
  name: Schema.String,
  message: Schema.String,
  stack: Schema.optional(Schema.String),
})

const CodeModeWorkerErrorSchema = Schema.Union([
  CodeModeWorkerFailureValueSchema,
  CodeModeWorkerExceptionValueSchema,
  CodeModeWorkerHostErrorValueSchema,
])

const CodeModeWorkerErrorKindSchema = Schema.Struct({ kind: Schema.String })

const codeModeRequestIdMessage = 'The code mode request id must be a positive integer.'

const CodeModeRequestIdSchema = Schema.Finite.annotate({ message: codeModeRequestIdMessage }).pipe(
  Schema.check(
    Schema.isInt({ message: codeModeRequestIdMessage }),
    Schema.isGreaterThan(0, { message: codeModeRequestIdMessage }),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER, { message: codeModeRequestIdMessage }),
  ),
)

const CodeModeWorkerStartSchema = Schema.Struct({
  type: Schema.Literal('start'),
  code: Schema.String,
  filename: Schema.String,
  timeoutMs: createCodeModePositiveFiniteNumberSchema('The code mode worker timeout must be a positive finite number.'),
  remainingTimeoutMs: createCodeModePositiveFiniteNumberSchema(
    'The code mode worker remaining timeout must be a positive finite number.',
  ),
  methods: Schema.Array(CodeModeMethodSchema),
  syncState: Schema.Unknown,
  syncPort: Schema.Unknown,
})

const CodeModeSyncRequestSchema = Schema.Struct({
  type: Schema.Literal('sync-call'),
  id: CodeModeRequestIdSchema,
  method: Schema.String,
  args: Schema.Array(Schema.Unknown),
})

const CodeModeAsyncRequestSchema = Schema.Struct({
  type: Schema.Literal('async-call'),
  id: CodeModeRequestIdSchema,
  method: Schema.String,
  args: Schema.Array(Schema.Unknown),
})

const CodeModeSyncSuccessResponseSchema = Schema.Struct({
  type: Schema.Literal('sync-result'),
  id: CodeModeRequestIdSchema,
  ok: Schema.Literal(true),
  value: Schema.Unknown,
})

const CodeModeSyncFailureResponseSchema = Schema.Struct({
  type: Schema.Literal('sync-result'),
  id: CodeModeRequestIdSchema,
  ok: Schema.Literal(false),
  error: CodeModeWorkerErrorSchema,
})

const CodeModeSyncResponseSchema = Schema.Union([CodeModeSyncSuccessResponseSchema, CodeModeSyncFailureResponseSchema])

const CodeModeAsyncSuccessResponseSchema = Schema.Struct({
  type: Schema.Literal('async-result'),
  id: CodeModeRequestIdSchema,
  ok: Schema.Literal(true),
  value: Schema.Unknown,
})

const CodeModeAsyncFailureResponseSchema = Schema.Struct({
  type: Schema.Literal('async-result'),
  id: CodeModeRequestIdSchema,
  ok: Schema.Literal(false),
  error: CodeModeWorkerErrorSchema,
})

const CodeModeAsyncResponseSchema = Schema.Union([
  CodeModeAsyncSuccessResponseSchema,
  CodeModeAsyncFailureResponseSchema,
])

const CodeModeWorkerResultSchema = Schema.Struct({
  type: Schema.Literal('result'),
  value: Schema.Unknown,
})

const CodeModeWorkerFailureSchema = Schema.Struct({
  type: Schema.Literal('error'),
  error: CodeModeWorkerErrorSchema,
})

const CodeModeWorkerFailureMessageSchema = Schema.Struct({
  type: Schema.Literal('error'),
  error: Schema.optional(Schema.Unknown),
})

const CodeModeWorkerMessageSchema = Schema.Union([
  CodeModeSyncRequestSchema,
  CodeModeAsyncRequestSchema,
  CodeModeWorkerResultSchema,
  CodeModeWorkerFailureSchema,
])

const CodeModeParentMessageSchema = Schema.Union([
  CodeModeWorkerStartSchema,
  CodeModeSyncResponseSchema,
  CodeModeAsyncResponseSchema,
])

/**
 * Encodes program and host errors into the worker protocol, using a codec for typed host errors.
 */
function serializeProgramError<E>(cause: unknown, codec?: ProgramHostErrorCodec<E>): WorkerError {
  if (isCodeModeEncodedHostError(cause)) return { kind: 'host', value: cause.value }
  if (isCodeModeHostError<E>(cause)) {
    if (codec === undefined)
      return serializeProgramError(
        createProgramFailure({
          _tag: 'serialize',
          operation: 'host-error',
          message: 'The code mode host error codec is required for worker execution.',
        }),
      )
    try {
      const value = codec.encode(cause.value)
      if (!isCodeModeWireValue(value)) throw new TypeError('The host error codec returned a non-wire value.')
      return { kind: 'host', value }
    } catch (codecCause) {
      return serializeProgramError(
        createProgramFailure({
          _tag: 'serialize',
          operation: 'host-error',
          message: 'The code mode host error codec could not encode the host failure.',
          cause: codecCause,
        }),
      )
    }
  }
  if (isProgramFailure(cause)) {
    const failure = Schema.decodeUnknownSync(CodeModeFailureWireValueSchema)({
      _tag: cause._tag,
      operation: cause.operation,
      message: cause.message,
      cause: cloneCodeModeCause(cause.cause),
      name: cause.name,
      stack: cause.stack,
    })
    return { kind: 'failure', failure }
  }
  if (cause instanceof Error) {
    return { kind: 'exception', name: cause.name, message: cause.message, stack: cause.stack }
  }
  return { kind: 'exception', name: 'Error', message: String(cause) }
}

function deserializeCodeModeHostError<E>(
  error: unknown,
  codec: ProgramHostErrorCodec<E> | undefined,
): ProgramFailure<string> | CodeModeHostError<E> {
  let shape: { readonly kind: 'host'; readonly value: unknown }
  try {
    shape = Schema.decodeUnknownSync(CodeModeWorkerHostErrorShapeSchema)(error)
  } catch {
    return createProgramFailure({
      _tag: 'deserialize',
      operation: 'host-error',
      message: 'The code mode worker returned an invalid host error.',
      cause: error,
    })
  }

  let decoded: { readonly kind: 'host'; readonly value: ProgramWireValue }
  try {
    decoded = Schema.decodeUnknownSync(CodeModeWorkerHostErrorValueSchema)(shape)
  } catch {
    return createProgramFailure({
      _tag: 'deserialize',
      operation: 'host-error',
      message: 'The code mode worker returned a non-wire host error.',
      cause: error,
    })
  }
  if (codec === undefined)
    return createProgramFailure({
      _tag: 'deserialize',
      operation: 'host-error',
      message: 'The code mode host error codec is required to decode a worker failure.',
    })
  try {
    return createCodeModeHostError(codec.decode(decoded.value))
  } catch (cause) {
    return createProgramFailure({
      _tag: 'deserialize',
      operation: 'host-error',
      message: 'The code mode host error codec could not decode the host failure.',
      cause,
    })
  }
}

function deserializeCodeModeWorkerError(error: unknown): ProgramFailure<string> | CodeModeEncodedHostError {
  try {
    const decoded = Schema.decodeUnknownSync(CodeModeWorkerHostErrorValueSchema)(error)
    return createCodeModeEncodedHostError(decoded.value)
  } catch {
    let shape: { readonly kind: 'host'; readonly value: unknown }
    try {
      shape = Schema.decodeUnknownSync(CodeModeWorkerHostErrorShapeSchema)(error)
    } catch {
      return deserializeProgramError(error)
    }
    return createProgramFailure({
      _tag: 'deserialize',
      operation: 'host-error',
      message: 'The code mode worker returned a non-wire host error.',
      cause: shape,
    })
  }
}

/**
 * Decodes a worker error payload as a program failure or, with a codec, a typed host error.
 */
function deserializeProgramError(error: unknown): ProgramFailure<string>
function deserializeProgramError<E>(
  error: unknown,
  codec: ProgramHostErrorCodec<E> | undefined,
): ProgramFailure<string> | E
function deserializeProgramError<E>(error: unknown, codec: ProgramHostErrorCodec<E>): ProgramFailure<string> | E
function deserializeProgramError<E>(error: unknown, codec?: ProgramHostErrorCodec<E>): ProgramFailure<string> | E {
  let decoded: WorkerError
  try {
    decoded = Schema.decodeUnknownSync(CodeModeWorkerErrorSchema)(error)
  } catch {
    let kind: { readonly kind: string }
    try {
      kind = Schema.decodeUnknownSync(CodeModeWorkerErrorKindSchema)(error)
    } catch {
      return createProgramFailure({
        _tag: 'deserialize',
        operation: 'deserialize',
        message: 'The code mode worker returned an unknown error.',
      })
    }
    if (kind.kind === 'host') return deserializeCodeModeHostError(error, codec) as ProgramFailure<string> | E
    if (kind.kind === 'failure')
      return createProgramFailure({
        _tag: 'deserialize',
        operation: 'deserialize',
        message: 'The code mode worker returned an invalid failure.',
        cause: error,
      })
    return createProgramFailure({
      _tag: 'deserialize',
      operation: 'deserialize',
      message: 'The code mode worker returned invalid error data.',
      cause: error,
    })
  }

  if (decoded.kind === 'host') {
    const hostError = deserializeCodeModeHostError(decoded, codec)
    return isCodeModeHostError<E>(hostError) ? hostError.value : hostError
  }
  if (decoded.kind === 'failure')
    return createProgramFailure({
      _tag: decoded.failure._tag,
      operation: decoded.failure.operation,
      message: decoded.failure.message,
      cause: decoded.failure.cause,
      name: decoded.failure.name,
      stack: decoded.failure.stack,
    })
  return createProgramFailure({
    _tag: 'invoke',
    operation: 'evaluate',
    message: decoded.message,
    name: decoded.name,
    stack: decoded.stack,
    cause: { name: decoded.name, stack: decoded.stack },
  })
}

function cloneCodeModeCause(value: unknown): ProgramWireValue {
  if (value === undefined) return undefined
  try {
    const cloned = structuredClone(value)
    if (isCodeModeWireValue(cloned)) return cloned
  } catch {
    return String(value)
  }
  return String(value)
}

export {
  type CodeModeAsyncRequest,
  CodeModeAsyncRequestSchema,
  type CodeModeAsyncResponse,
  CodeModeAsyncResponseSchema,
  CodeModeFailureWireValueSchema,
  type CodeModeParentMessage,
  CodeModeParentMessageSchema,
  CodeModeRequestIdSchema,
  type CodeModeSyncRequest,
  CodeModeSyncRequestSchema,
  type CodeModeSyncResponse,
  CodeModeSyncResponseSchema,
  CodeModeWorkerErrorKindSchema,
  CodeModeWorkerErrorSchema,
  CodeModeWorkerExceptionValueSchema,
  type CodeModeWorkerFailure,
  CodeModeWorkerFailureMessageSchema,
  CodeModeWorkerFailureSchema,
  CodeModeWorkerFailureValueSchema,
  CodeModeWorkerHostErrorShapeSchema,
  CodeModeWorkerHostErrorValueSchema,
  type CodeModeWorkerMessage,
  CodeModeWorkerMessageSchema,
  type CodeModeWorkerResult,
  CodeModeWorkerResultSchema,
  type CodeModeWorkerStart,
  CodeModeWorkerStartSchema,
  deserializeCodeModeHostError,
  deserializeCodeModeWorkerError,
  deserializeProgramError,
  type ProgramFailureWireValue,
  serializeProgramError,
  type WorkerError,
  type WorkerExceptionValue,
  type WorkerFailureValue,
  type WorkerHostErrorValue,
}
