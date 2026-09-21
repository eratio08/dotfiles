import { Option, Schema } from 'effect'
import { createOpensrcFailure, type OpensrcFailure, type OpensrcFailureTag } from '../core/model.ts'

const OpensrcFailureSchema = Schema.Struct({
  _tag: Schema.Literals([
    'validation',
    'source-not-found',
    'cli',
    'filesystem',
    'parser',
    'cancellation',
    'timeout',
    'code-evaluation',
    'runtime',
  ]),
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
})

function decodeOpensrcFailure(value: unknown): OpensrcFailure | undefined {
  const decoded = Schema.decodeUnknownOption(OpensrcFailureSchema)(value)
  return Option.isSome(decoded) ? createOpensrcFailure(decoded.value) : undefined
}

function failureFromUnknown(
  cause: unknown,
  _tag: OpensrcFailureTag,
  operation: string,
  fallbackMessage: string,
): OpensrcFailure {
  const failure = decodeOpensrcFailure(cause)
  if (failure !== undefined) return failure
  return createOpensrcFailure({
    _tag,
    operation,
    message: cause instanceof Error ? cause.message : fallbackMessage,
    cause,
  })
}

export { decodeOpensrcFailure, failureFromUnknown }
