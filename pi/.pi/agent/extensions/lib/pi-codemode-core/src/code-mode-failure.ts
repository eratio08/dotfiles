import { Schema } from 'effect'
import type { CodeModeHostErrorCodec, CodeModeWireValue } from './code-mode-contract.ts'
import type { CodeModeWorkerError } from './code-mode-protocol.ts'
import type { CodeModeFailureWireValue } from './code-mode-schema.ts'
import {
  CodeModeEncodedHostErrorSchema,
  CodeModeFailureAnySchema,
  CodeModeFailureSchema,
  CodeModeFailureWireValueSchema,
  CodeModeHostErrorEnvelopeSchema,
  CodeModeWireValueSchema,
  CodeModeWorkerErrorKindSchema,
  CodeModeWorkerErrorSchema,
  CodeModeWorkerHostErrorShapeSchema,
  CodeModeWorkerHostErrorValueSchema,
} from './code-mode-schema.ts'

type CodeModeFailureTag =
  | 'validation'
  | 'transform'
  | 'compile'
  | 'invoke'
  | 'timeout'
  | 'cancellation'
  | 'worker'
  | 'transport'
  | 'deserialize'
  | 'serialize'

type CodeModeFailureData<Tag extends string> = {
  readonly _tag: Tag
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
  readonly name?: string
  readonly stack?: string
}

type CodeModeFailure<Tag extends string = CodeModeFailureTag> = Tag extends unknown ? CodeModeFailureData<Tag> : never

type CodeModeFailureFields<Tag extends string = string> = CodeModeFailureData<Tag>

const codeModeEncodedHostErrorMarker = Symbol('CodeModeEncodedHostError')
const codeModeHostErrorMarker = Symbol('CodeModeHostError')

interface CodeModeHostError<E> {
  readonly type: 'code-mode-host-error'
  readonly value: E
  readonly [codeModeHostErrorMarker]: true
}

interface CodeModeEncodedHostError {
  readonly type: 'code-mode-host-error'
  readonly value: CodeModeWireValue
  readonly [codeModeEncodedHostErrorMarker]: true
}

function createCodeModeFailure<const Tag extends string>(fields: CodeModeFailureFields<Tag>): CodeModeFailure<Tag> {
  return { ...fields } as CodeModeFailure<Tag>
}

function isCodeModeFailure(value: unknown): value is CodeModeFailure {
  try {
    Schema.decodeUnknownSync(CodeModeFailureSchema)(value)
    return true
  } catch {
    try {
      Schema.decodeUnknownSync(CodeModeFailureAnySchema)(value)
      return true
    } catch {
      return false
    }
  }
}

function createCodeModeHostError<E>(value: E): CodeModeHostError<E> {
  return { type: 'code-mode-host-error', value, [codeModeHostErrorMarker]: true }
}

function createCodeModeEncodedHostError(value: CodeModeWireValue): CodeModeEncodedHostError {
  return { type: 'code-mode-host-error', value, [codeModeEncodedHostErrorMarker]: true }
}

function isCodeModeHostError<E>(value: unknown): value is CodeModeHostError<E> {
  try {
    Schema.decodeUnknownSync(CodeModeHostErrorEnvelopeSchema)(value)
  } catch {
    return false
  }
  return (value as CodeModeHostError<E>)[codeModeHostErrorMarker] === true
}

function isCodeModeEncodedHostError(value: unknown): value is CodeModeEncodedHostError {
  try {
    Schema.decodeUnknownSync(CodeModeEncodedHostErrorSchema)(value)
  } catch {
    return false
  }
  return (value as CodeModeEncodedHostError)[codeModeEncodedHostErrorMarker] === true
}

function serializeCodeModeError<E>(cause: unknown, codec?: CodeModeHostErrorCodec<E>): CodeModeWorkerError {
  if (isCodeModeEncodedHostError(cause)) return { kind: 'host', value: cause.value }
  if (isCodeModeHostError<E>(cause)) {
    if (codec === undefined)
      return serializeCodeModeError(
        createCodeModeFailure({
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
      return serializeCodeModeError(
        createCodeModeFailure({
          _tag: 'serialize',
          operation: 'host-error',
          message: 'The code mode host error codec could not encode the host failure.',
          cause: codecCause,
        }),
      )
    }
  }
  if (isCodeModeFailure(cause)) {
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
  codec: CodeModeHostErrorCodec<E> | undefined,
): CodeModeFailure<string> | CodeModeHostError<E> {
  let shape: { readonly kind: 'host'; readonly value: unknown }
  try {
    shape = Schema.decodeUnknownSync(CodeModeWorkerHostErrorShapeSchema)(error)
  } catch {
    return createCodeModeFailure({
      _tag: 'deserialize',
      operation: 'host-error',
      message: 'The code mode worker returned an invalid host error.',
      cause: error,
    })
  }

  let decoded: { readonly kind: 'host'; readonly value: CodeModeWireValue }
  try {
    decoded = Schema.decodeUnknownSync(CodeModeWorkerHostErrorValueSchema)(shape)
  } catch {
    return createCodeModeFailure({
      _tag: 'deserialize',
      operation: 'host-error',
      message: 'The code mode worker returned a non-wire host error.',
      cause: error,
    })
  }
  if (codec === undefined)
    return createCodeModeFailure({
      _tag: 'deserialize',
      operation: 'host-error',
      message: 'The code mode host error codec is required to decode a worker failure.',
    })
  try {
    return createCodeModeHostError(codec.decode(decoded.value))
  } catch (cause) {
    return createCodeModeFailure({
      _tag: 'deserialize',
      operation: 'host-error',
      message: 'The code mode host error codec could not decode the host failure.',
      cause,
    })
  }
}

function deserializeCodeModeWorkerError(error: unknown): CodeModeFailure<string> | CodeModeEncodedHostError {
  try {
    const decoded = Schema.decodeUnknownSync(CodeModeWorkerHostErrorValueSchema)(error)
    return createCodeModeEncodedHostError(decoded.value)
  } catch {
    let shape: { readonly kind: 'host'; readonly value: unknown }
    try {
      shape = Schema.decodeUnknownSync(CodeModeWorkerHostErrorShapeSchema)(error)
    } catch {
      return deserializeCodeModeError(error)
    }
    return createCodeModeFailure({
      _tag: 'deserialize',
      operation: 'host-error',
      message: 'The code mode worker returned a non-wire host error.',
      cause: shape,
    })
  }
}

function deserializeCodeModeError(error: unknown): CodeModeFailure<string>
function deserializeCodeModeError<E>(
  error: unknown,
  codec: CodeModeHostErrorCodec<E> | undefined,
): CodeModeFailure<string> | E
function deserializeCodeModeError<E>(error: unknown, codec: CodeModeHostErrorCodec<E>): CodeModeFailure<string> | E
function deserializeCodeModeError<E>(error: unknown, codec?: CodeModeHostErrorCodec<E>): CodeModeFailure<string> | E {
  let decoded: CodeModeWorkerError
  try {
    decoded = Schema.decodeUnknownSync(CodeModeWorkerErrorSchema)(error)
  } catch {
    let kind: { readonly kind: string }
    try {
      kind = Schema.decodeUnknownSync(CodeModeWorkerErrorKindSchema)(error)
    } catch {
      return createCodeModeFailure({
        _tag: 'deserialize',
        operation: 'deserialize',
        message: 'The code mode worker returned an unknown error.',
      })
    }
    if (kind.kind === 'host') return deserializeCodeModeHostError(error, codec) as CodeModeFailure<string> | E
    if (kind.kind === 'failure')
      return createCodeModeFailure({
        _tag: 'deserialize',
        operation: 'deserialize',
        message: 'The code mode worker returned an invalid failure.',
        cause: error,
      })
    return createCodeModeFailure({
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
    return createCodeModeFailure({
      _tag: decoded.failure._tag,
      operation: decoded.failure.operation,
      message: decoded.failure.message,
      cause: decoded.failure.cause,
      name: decoded.failure.name,
      stack: decoded.failure.stack,
    })
  return createCodeModeFailure({
    _tag: 'invoke',
    operation: 'evaluate',
    message: decoded.message,
    name: decoded.name,
    stack: decoded.stack,
    cause: { name: decoded.name, stack: decoded.stack },
  })
}

function cloneCodeModeCause(value: unknown): CodeModeWireValue {
  if (value === undefined) return undefined
  try {
    const cloned = structuredClone(value)
    if (isCodeModeWireValue(cloned)) return cloned
  } catch {
    return String(value)
  }
  return String(value)
}

function isCodeModeWireValue(value: unknown): value is CodeModeWireValue {
  try {
    Schema.decodeUnknownSync(CodeModeWireValueSchema)(value)
    return true
  } catch {
    return false
  }
}

export {
  type CodeModeEncodedHostError,
  type CodeModeFailure,
  type CodeModeFailureFields,
  type CodeModeFailureTag,
  type CodeModeFailureWireValue,
  type CodeModeHostError,
  createCodeModeEncodedHostError,
  createCodeModeFailure,
  createCodeModeHostError,
  deserializeCodeModeError,
  deserializeCodeModeHostError,
  deserializeCodeModeWorkerError,
  isCodeModeEncodedHostError,
  isCodeModeFailure,
  isCodeModeHostError,
  isCodeModeWireValue,
  serializeCodeModeError,
}
