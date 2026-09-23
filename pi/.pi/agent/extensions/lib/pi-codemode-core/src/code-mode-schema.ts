import { Schema } from 'effect'
import type { CodeModeDefinition, CodeModeMethod, CodeModeRunOptions, CodeModeWireValue } from './code-mode-contract.ts'

type CodeModeFailureWireValue = {
  readonly _tag: string
  readonly operation: string
  readonly message: string
  readonly cause?: CodeModeWireValue
  readonly name?: string
  readonly stack?: string
}

type CodeModeHostErrorEnvelope = {
  readonly type: 'code-mode-host-error'
  readonly value: unknown
}

type CodeModeExceptionData = {
  readonly message: string
  readonly name?: string
  readonly stack?: string
}

const codeModeDefinitionObjectMessage = 'The code mode definition must be an object.'
const codeModeDefinitionApiNameMessage = 'The code mode API name must not be empty.'
const codeModeDefinitionProgramNameMessage = 'The code mode program name must not be empty.'
const codeModeDefinitionDeclarationsMessage = 'The code mode declarations must be a string.'
const codeModeDefinitionMethodsMessage = 'The code mode must declare at least one method.'
const codeModeDefinitionExamplesMessage = 'The code mode examples must be strings.'
const codeModeMethodNameMessage = 'Code mode method names must not be empty.'
const codeModeOptionsObjectMessage = 'The code mode run options must be an object.'
const codeModeOptionsCwdMessage = 'The code mode cwd must not be empty.'
const codeModeOptionsFilenameMessage = 'The code mode filename prefix must not be empty.'
const codeModeOptionsTimeoutMessage = 'The code mode timeout must be a positive finite number.'
const codeModeOptionsExecutionMessage = 'The code mode execution must be worker or in-process.'
const codeModeSourceMessage = 'The code mode source must be a non-empty string.'

const createCodeModeNonEmptyStringSchema = (message: string) =>
  Schema.String.annotate({ message }).pipe(
    Schema.check(Schema.makeFilter((value) => value.trim().length > 0 || message, undefined, true)),
  )

const createCodeModePositiveFiniteNumberSchema = (message: string) =>
  Schema.Finite.annotate({ message }).pipe(Schema.check(Schema.isGreaterThan(0, { message })))

const CodeModeMethodSchema = Schema.Struct({
  name: Schema.optionalKey(createCodeModeNonEmptyStringSchema(codeModeMethodNameMessage)),
  kind: Schema.optionalKey(Schema.Unknown),
})
  .annotate({ message: codeModeMethodNameMessage })
  .pipe(
    Schema.check(Schema.makeFilter((value) => value.name !== undefined || codeModeMethodNameMessage, undefined, true)),
    Schema.check(
      Schema.makeFilter(
        (value) =>
          value.kind === 'sync' || value.kind === 'async'
            ? true
            : `The code mode method ${value.name ?? ''} has an invalid kind.`,
        undefined,
        true,
      ),
    ),
    Schema.refine(
      (value): value is CodeModeMethod => value.name !== undefined && (value.kind === 'sync' || value.kind === 'async'),
      { message: codeModeMethodNameMessage },
    ),
  )

const CodeModeDefinitionMethodsSchema = Schema.Array(CodeModeMethodSchema)
  .annotate({ message: codeModeDefinitionMethodsMessage })
  .pipe(Schema.check(Schema.isMinLength(1, { message: codeModeDefinitionMethodsMessage })))

const CodeModeDefinitionExamplesSchema = Schema.Array(
  Schema.String.annotate({ message: codeModeDefinitionExamplesMessage }),
).annotate({ message: codeModeDefinitionExamplesMessage })

const CodeModeDefinitionSchema = Schema.Struct({
  apiName: Schema.optionalKey(createCodeModeNonEmptyStringSchema(codeModeDefinitionApiNameMessage)),
  programName: Schema.optionalKey(createCodeModeNonEmptyStringSchema(codeModeDefinitionProgramNameMessage)),
  declarations: Schema.optionalKey(Schema.String.annotate({ message: codeModeDefinitionDeclarationsMessage })),
  methods: Schema.optionalKey(CodeModeDefinitionMethodsSchema),
  examples: Schema.optionalKey(CodeModeDefinitionExamplesSchema),
})
  .annotate({ message: codeModeDefinitionObjectMessage })
  .pipe(
    Schema.check(
      Schema.makeFilter((value) => value.apiName !== undefined || codeModeDefinitionApiNameMessage, undefined, true),
    ),
    Schema.check(
      Schema.makeFilter(
        (value) => value.programName !== undefined || codeModeDefinitionProgramNameMessage,
        undefined,
        true,
      ),
    ),
    Schema.check(
      Schema.makeFilter(
        (value) => value.declarations !== undefined || codeModeDefinitionDeclarationsMessage,
        undefined,
        true,
      ),
    ),
    Schema.check(
      Schema.makeFilter((value) => value.methods !== undefined || codeModeDefinitionMethodsMessage, undefined, true),
    ),
    Schema.check(
      Schema.makeFilter((value) => value.examples !== undefined || codeModeDefinitionExamplesMessage, undefined, true),
    ),
    Schema.check(
      Schema.makeFilter(
        (value) => {
          if (value.methods === undefined) return true
          const names = new Set<string>()
          for (const method of value.methods) {
            if (names.has(method.name)) return `The code mode method ${method.name} is declared more than once.`
            names.add(method.name)
          }
          return true
        },
        undefined,
        true,
      ),
    ),
    Schema.refine(
      (value): value is CodeModeDefinition =>
        value.apiName !== undefined &&
        value.programName !== undefined &&
        value.declarations !== undefined &&
        value.methods !== undefined &&
        value.examples !== undefined,
      { message: codeModeDefinitionObjectMessage },
    ),
  )

const CodeModeRunOptionsSchema = Schema.Struct({
  cwd: Schema.optionalKey(createCodeModeNonEmptyStringSchema(codeModeOptionsCwdMessage)),
  filenamePrefix: Schema.optionalKey(createCodeModeNonEmptyStringSchema(codeModeOptionsFilenameMessage)),
  timeoutMs: Schema.optionalKey(createCodeModePositiveFiniteNumberSchema(codeModeOptionsTimeoutMessage)),
  signal: Schema.optionalKey(Schema.Unknown),
  execution: Schema.optionalKey(
    Schema.Union([Schema.Literal('worker'), Schema.Literal('in-process')]).annotate({
      message: codeModeOptionsExecutionMessage,
    }),
  ),
})
  .annotate({ message: codeModeOptionsObjectMessage })
  .pipe(
    Schema.check(Schema.makeFilter((value) => value.cwd !== undefined || codeModeOptionsCwdMessage, undefined, true)),
    Schema.check(
      Schema.makeFilter(
        (value) => value.filenamePrefix !== undefined || codeModeOptionsFilenameMessage,
        undefined,
        true,
      ),
    ),
    Schema.check(
      Schema.makeFilter((value) => value.timeoutMs !== undefined || codeModeOptionsTimeoutMessage, undefined, true),
    ),
    Schema.refine(
      (value): value is CodeModeRunOptions =>
        value.cwd !== undefined && value.filenamePrefix !== undefined && value.timeoutMs !== undefined,
      { message: codeModeOptionsObjectMessage },
    ),
  )

const CodeModeSourceSchema = createCodeModeNonEmptyStringSchema(codeModeSourceMessage)

const CodeModeWireValueSchema: Schema.ConstraintDecoder<CodeModeWireValue> = Schema.suspend(() =>
  Schema.Union([
    Schema.Undefined,
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.BigInt,
    Schema.String,
    Schema.Array(CodeModeWireValueSchema),
    Schema.Record(Schema.String, CodeModeWireValueSchema),
  ]),
)

const codeModeFailureFields = {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
  name: Schema.optional(Schema.String),
  stack: Schema.optional(Schema.String),
} as const

const CodeModeFailureSchema = Schema.Union([
  Schema.TaggedStruct('validation', codeModeFailureFields),
  Schema.TaggedStruct('transform', codeModeFailureFields),
  Schema.TaggedStruct('compile', codeModeFailureFields),
  Schema.TaggedStruct('invoke', codeModeFailureFields),
  Schema.TaggedStruct('timeout', codeModeFailureFields),
  Schema.TaggedStruct('cancellation', codeModeFailureFields),
  Schema.TaggedStruct('worker', codeModeFailureFields),
  Schema.TaggedStruct('transport', codeModeFailureFields),
  Schema.TaggedStruct('deserialize', codeModeFailureFields),
  Schema.TaggedStruct('serialize', codeModeFailureFields),
])

const CodeModeFailureAnySchema = Schema.Struct({
  _tag: Schema.String,
  ...codeModeFailureFields,
})

const CodeModeFailureWireValueSchema = Schema.Struct({
  _tag: Schema.String,
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(CodeModeWireValueSchema),
  name: Schema.optional(Schema.String),
  stack: Schema.optional(Schema.String),
})

const CodeModeHostErrorEnvelopeSchema = Schema.Struct({
  type: Schema.Literal('code-mode-host-error'),
  value: Schema.Unknown,
})

const CodeModeEncodedHostErrorSchema = Schema.Struct({
  type: Schema.Literal('code-mode-host-error'),
  value: CodeModeWireValueSchema,
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

const CodeModeExceptionSchema = Schema.Struct({
  message: Schema.String,
  name: Schema.optional(Schema.String),
  stack: Schema.optional(Schema.String),
})

const CodeModeExceptionMessageSchema = Schema.Struct({
  message: Schema.String,
})

function getCodeModeSchemaFailureMessage(cause: unknown, fallbackMessage: string): string {
  if (!Schema.isSchemaError(cause)) return fallbackMessage
  return cause.message.split('\n', 1)[0] ?? fallbackMessage
}

export {
  CodeModeAsyncRequestSchema,
  CodeModeAsyncResponseSchema,
  CodeModeDefinitionSchema,
  CodeModeEncodedHostErrorSchema,
  type CodeModeExceptionData,
  CodeModeExceptionMessageSchema,
  CodeModeExceptionSchema,
  CodeModeFailureAnySchema,
  CodeModeFailureSchema,
  type CodeModeFailureWireValue,
  CodeModeFailureWireValueSchema,
  type CodeModeHostErrorEnvelope,
  CodeModeHostErrorEnvelopeSchema,
  CodeModeMethodSchema,
  CodeModeParentMessageSchema,
  CodeModeRunOptionsSchema,
  CodeModeSourceSchema,
  CodeModeSyncRequestSchema,
  CodeModeSyncResponseSchema,
  CodeModeWireValueSchema,
  CodeModeWorkerErrorKindSchema,
  CodeModeWorkerErrorSchema,
  CodeModeWorkerFailureMessageSchema,
  CodeModeWorkerFailureSchema,
  CodeModeWorkerFailureValueSchema,
  CodeModeWorkerHostErrorShapeSchema,
  CodeModeWorkerHostErrorValueSchema,
  CodeModeWorkerMessageSchema,
  CodeModeWorkerResultSchema,
  CodeModeWorkerStartSchema,
  getCodeModeSchemaFailureMessage,
}
