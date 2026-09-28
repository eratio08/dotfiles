import { Effect, Schema } from 'effect'

/**
 * Error returned when a Pi host operation fails.
 * `operation` names the failed host call, and `cause` stores the original failure when available.
 */
class PiHostError extends Schema.TaggedError<PiHostError>()('PiHostError', {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error returned when an operation requires UI that the current Pi mode does not provide.
 * It records the attempted operation and the current mode.
 */
class PiUiUnavailableError extends Schema.TaggedError<PiUiUnavailableError>()('PiUiUnavailableError', {
  operation: Schema.String,
  mode: Schema.String,
  message: Schema.String,
}) {}

/**
 * Error returned when code tries to run after the managed runtime starts shutting down.
 * It records the attempted operation and a readable failure message.
 */
class PiRuntimeDisposedError extends Schema.TaggedError<PiRuntimeDisposedError>()('PiRuntimeDisposedError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

/**
 * Error returned when Pi rejects a command, event, tool, flag, shortcut, or renderer registration.
 * It records the registration name and may include the original cause.
 */
class PiRegistrationError extends Schema.TaggedError<PiRegistrationError>()('PiRegistrationError', {
  registration: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error returned when an Effect tool fails during execution.
 * It records the tool name, operation, failure message, and optional original cause.
 */
class PiToolError extends Schema.TaggedError<PiToolError>()('PiToolError', {
  tool: Schema.String,
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/** Union of errors that the Pi Effect adapter can return to extension code. */
type PiExtensionError = PiHostError | PiUiUnavailableError | PiRuntimeDisposedError | PiRegistrationError | PiToolError

/**
 * Converts an unknown failure cause to a readable message.
 * Uses `Error.message` for Error values and `String(cause)` for other values.
 * @param cause Failure value to convert.
 * @returns Readable error message.
 */
function piCauseMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

const hostTry = Effect.fnUntraced(function* <A>(
  operation: string,
  evaluate: () => A,
): Effect.fn.Return<A, PiHostError> {
  return yield* Effect.try({
    try: evaluate,
    catch: (cause: unknown) => new PiHostError({ operation, message: piCauseMessage(cause), cause }),
  })
})

const hostTryPromise = Effect.fnUntraced(function* <A>(
  operation: string,
  evaluate: (signal: AbortSignal) => Promise<A>,
): Effect.fn.Return<A, PiHostError> {
  return yield* Effect.tryPromise({
    try: (signal: AbortSignal) => evaluate(signal),
    catch: (cause: unknown) => new PiHostError({ operation, message: piCauseMessage(cause), cause }),
  })
})

export {
  hostTry,
  hostTryPromise,
  type PiExtensionError,
  PiHostError,
  PiRegistrationError,
  PiRuntimeDisposedError,
  PiToolError,
  PiUiUnavailableError,
  piCauseMessage,
}
