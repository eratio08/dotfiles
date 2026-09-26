import { Schema } from 'effect'
import type { ProgramHostErrorCodec, ProgramWireValue } from './contract.ts'
import type { WorkerError } from './protocol.ts'
import type { ProgramFailureWireValue } from './schema.ts'
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
} from './schema.ts'

/**
 * Lists the tags used to classify code-mode validation, execution, worker, and serialization failures.
 */
type ProgramFailureTag =
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

type ProgramFailureData<Tag extends string> = {
  readonly _tag: Tag
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
  readonly name?: string
  readonly stack?: string
}

/**
 * Represents a tagged, branded failure produced by code-mode validation or execution.
 */
type ProgramFailure<Tag extends string = ProgramFailureTag> = Tag extends unknown ? ProgramFailureData<Tag> : never

/**
 * Defines the fields accepted by `createProgramFailure` before it adds its marker.
 */
type ProgramFailureFields<Tag extends string = string> = ProgramFailureData<Tag>

const codeModeEncodedHostErrorMarker = Symbol('CodeModeEncodedHostError')
const codeModeHostErrorMarker = Symbol('CodeModeHostError')
const codeModeFailureMarker = Symbol('CodeModeFailure')

/**
 * Represents a branded wrapper for a typed host error raised during program API invocation.
 */
type CodeModeHostError<E> = {
  readonly type: 'code-mode-host-error'
  readonly value: E
  readonly [codeModeHostErrorMarker]: true
}

/**
 * Represents a branded host error encoded for transfer across a worker boundary.
 */
type CodeModeEncodedHostError = {
  readonly type: 'code-mode-host-error'
  readonly value: ProgramWireValue
  readonly [codeModeEncodedHostErrorMarker]: true
}

/**
 * Creates a branded, tagged program failure from its fields.
 */
function createProgramFailure<const Tag extends string>(fields: ProgramFailureFields<Tag>): ProgramFailure<Tag> {
  const failure = { ...fields } as ProgramFailure<Tag>
  Object.defineProperty(failure, codeModeFailureMarker, { value: true })
  return failure
}

/**
 * Narrows a value to a branded `ProgramFailure` after marker and schema checks.
 */
function isProgramFailure(value: unknown): value is ProgramFailure {
  if (value === null || typeof value !== 'object') return false
  try {
    if (Reflect.get(value, codeModeFailureMarker) !== true) return false
  } catch {
    return false
  }
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

/**
 * Wraps a typed host error so the runner can distinguish it from program failures.
 */
function createCodeModeHostError<E>(value: E): CodeModeHostError<E> {
  return { type: 'code-mode-host-error', value, [codeModeHostErrorMarker]: true }
}

/**
 * Wraps a wire-safe host error for transfer from a worker to the host.
 */
function createCodeModeEncodedHostError(value: ProgramWireValue): CodeModeEncodedHostError {
  return { type: 'code-mode-host-error', value, [codeModeEncodedHostErrorMarker]: true }
}

/**
 * Narrows a value to a typed host-error wrapper created by this library.
 */
function isCodeModeHostError<E>(value: unknown): value is CodeModeHostError<E> {
  try {
    Schema.decodeUnknownSync(CodeModeHostErrorEnvelopeSchema)(value)
  } catch {
    return false
  }
  return (value as CodeModeHostError<E>)[codeModeHostErrorMarker] === true
}

/**
 * Narrows a value to a branded host-error wrapper with an encoded wire value.
 */
function isCodeModeEncodedHostError(value: unknown): value is CodeModeEncodedHostError {
  try {
    Schema.decodeUnknownSync(CodeModeEncodedHostErrorSchema)(value)
  } catch {
    return false
  }
  return (value as CodeModeEncodedHostError)[codeModeEncodedHostErrorMarker] === true
}

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

/**
 * Decodes a worker host error with the codec or returns a program failure if decoding fails.
 */
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

/**
 * Decodes a worker host-error payload or converts invalid data to a program failure.
 */
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

/**
 * Narrows a value to `ProgramWireValue` after schema validation.
 */
function isCodeModeWireValue(value: unknown): value is ProgramWireValue {
  try {
    Schema.decodeUnknownSync(CodeModeWireValueSchema)(value)
    return true
  } catch {
    return false
  }
}

export {
  type CodeModeEncodedHostError,
  type CodeModeHostError,
  createCodeModeEncodedHostError,
  createCodeModeHostError,
  createProgramFailure,
  deserializeCodeModeHostError,
  deserializeCodeModeWorkerError,
  deserializeProgramError,
  isCodeModeEncodedHostError,
  isCodeModeHostError,
  isCodeModeWireValue,
  isProgramFailure,
  type ProgramFailure,
  type ProgramFailureFields,
  type ProgramFailureTag,
  type ProgramFailureWireValue,
  serializeProgramError,
}
