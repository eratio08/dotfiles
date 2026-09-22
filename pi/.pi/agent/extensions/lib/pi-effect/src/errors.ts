import { Schema } from 'effect'

class PiHostError extends Schema.TaggedError<PiHostError>()('PiHostError', {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

class PiUiUnavailableError extends Schema.TaggedError<PiUiUnavailableError>()('PiUiUnavailableError', {
  operation: Schema.String,
  mode: Schema.String,
  message: Schema.String,
}) {}

class PiRuntimeDisposedError extends Schema.TaggedError<PiRuntimeDisposedError>()('PiRuntimeDisposedError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

class PiRegistrationError extends Schema.TaggedError<PiRegistrationError>()('PiRegistrationError', {
  registration: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

class PiToolError extends Schema.TaggedError<PiToolError>()('PiToolError', {
  tool: Schema.String,
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

type PiExtensionError = PiHostError | PiUiUnavailableError | PiRuntimeDisposedError | PiRegistrationError | PiToolError

function piCauseMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export {
  type PiExtensionError,
  PiHostError,
  PiRegistrationError,
  PiRuntimeDisposedError,
  PiToolError,
  PiUiUnavailableError,
  piCauseMessage,
}
