import { Context, type Effect, Schema } from 'effect'

const createCodeModeNonEmptyStringSchema = (message: string): Schema.Codec<string> =>
  Schema.String.annotate({ message }).pipe(
    Schema.check(Schema.makeFilter((value) => value.trim().length > 0 || message, undefined, true)),
  )

const createCodeModePositiveFiniteNumberSchema = (message: string): Schema.Codec<number> =>
  Schema.Finite.annotate({ message }).pipe(Schema.check(Schema.isGreaterThan(0, { message })))

function getCodeModeSchemaFailureMessage(cause: unknown, fallbackMessage: string): string {
  if (!Schema.isSchemaError(cause)) return fallbackMessage
  return cause.message.split('\n', 1)[0] ?? fallbackMessage
}

/**
 * Describes a host method and whether a code-mode program invokes it synchronously or asynchronously.
 */
type ProgramMethod = {
  readonly name: string
  readonly kind: 'sync' | 'async'
}

/**
 * Declares the API type, host methods, and examples available to a code-mode program.
 */
type ProgramDefinition = {
  readonly apiName: string
  readonly programName: string
  readonly declarations: string
  readonly methods: readonly ProgramMethod[]
  readonly examples: readonly string[]
}

declare const programHostTag: unique symbol

type ProgramHostRequirement<R, E> = {
  readonly [programHostTag]: readonly [R, E]
}

/**
 * Defines the host operations and optional error codec available to a program runner.
 */
type ProgramHost<R, E> = {
  readonly invoke: (method: string, args: readonly unknown[], signal: AbortSignal) => Effect.Effect<unknown, E, R>
  readonly invokeSync?: (method: string, args: readonly unknown[]) => unknown
  readonly errorCodec?: ProgramHostErrorCodec<E>
}

/**
 * Returns the Effect service key used to provide a program host.
 */
const ProgramHost = <R, E>(): Context.Service<ProgramHostRequirement<R, E>, ProgramHost<R, E>> =>
  Context.Service<ProgramHostRequirement<R, E>, ProgramHost<R, E>>('@eratio/pi-codemode-core/CodeModeEffectHost')

/**
 * Configures paths, timeout, cancellation, and execution mode for one evaluation.
 */
type ProgramRunOptions = {
  readonly cwd: string
  readonly filenamePrefix: string
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  readonly execution?: 'worker' | 'in-process'
}

/**
 * Exposes the Effect operation that evaluates a program against a definition and options.
 */
type ProgramRunner<R, E> = {
  readonly evaluate: (
    definition: ProgramDefinition,
    code: string,
    options: ProgramRunOptions,
  ) => Effect.Effect<unknown, ProgramFailure | E, R | ProgramHostRequirement<R, E>>
}

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

/**
 * Defines the values that can cross the worker boundary, including nested arrays and records.
 */
type ProgramWireValue =
  | undefined
  | null
  | boolean
  | number
  | bigint
  | string
  | readonly ProgramWireValue[]
  | { readonly [key: string]: ProgramWireValue }

/**
 * Encodes and decodes typed host errors as values that can cross the worker boundary.
 */
type ProgramHostErrorCodec<E> = {
  readonly encode: (error: E) => ProgramWireValue
  readonly decode: (value: ProgramWireValue) => E
}

type CodeModeHostErrorEnvelope = {
  readonly type: 'code-mode-host-error'
  readonly value: unknown
}

const codeModeEncodedHostErrorMarker = Symbol('CodeModeEncodedHostError')
const codeModeHostErrorMarker = Symbol('CodeModeHostError')
const codeModeFailureMarker = Symbol('CodeModeFailure')

type CodeModeHostError<E> = CodeModeHostErrorEnvelope & {
  readonly value: E
  readonly [codeModeHostErrorMarker]: true
}

type CodeModeEncodedHostError = CodeModeHostErrorEnvelope & {
  readonly value: ProgramWireValue
  readonly [codeModeEncodedHostErrorMarker]: true
}

const CodeModeWireValueSchema: Schema.ConstraintDecoder<ProgramWireValue> = Schema.suspend(() =>
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

const CodeModeHostErrorEnvelopeSchema = Schema.Struct({
  type: Schema.Literal('code-mode-host-error'),
  value: Schema.Unknown,
})

const CodeModeEncodedHostErrorSchema = Schema.Struct({
  type: Schema.Literal('code-mode-host-error'),
  value: CodeModeWireValueSchema,
})

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

function createCodeModeHostError<E>(value: E): CodeModeHostError<E> {
  return { type: 'code-mode-host-error', value, [codeModeHostErrorMarker]: true }
}

function createCodeModeEncodedHostError(value: ProgramWireValue): CodeModeEncodedHostError {
  return { type: 'code-mode-host-error', value, [codeModeEncodedHostErrorMarker]: true }
}

function isCodeModeHostError<E>(value: unknown): value is CodeModeHostError<E> {
  let envelope: CodeModeHostErrorEnvelope
  try {
    envelope = Schema.decodeUnknownSync(CodeModeHostErrorEnvelopeSchema)(value)
  } catch {
    return false
  }
  return envelope.type === 'code-mode-host-error' && (value as CodeModeHostError<E>)[codeModeHostErrorMarker] === true
}

function isCodeModeEncodedHostError(value: unknown): value is CodeModeEncodedHostError {
  try {
    Schema.decodeUnknownSync(CodeModeEncodedHostErrorSchema)(value)
  } catch {
    return false
  }
  return (value as CodeModeEncodedHostError)[codeModeEncodedHostErrorMarker] === true
}

function isCodeModeWireValue(value: unknown): value is ProgramWireValue {
  try {
    Schema.decodeUnknownSync(CodeModeWireValueSchema)(value)
    return true
  } catch {
    return false
  }
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
      (value): value is ProgramMethod => value.name !== undefined && (value.kind === 'sync' || value.kind === 'async'),
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
      (value): value is ProgramDefinition =>
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
      (value): value is ProgramRunOptions =>
        value.cwd !== undefined && value.filenamePrefix !== undefined && value.timeoutMs !== undefined,
      { message: codeModeOptionsObjectMessage },
    ),
  )

const CodeModeSourceSchema = createCodeModeNonEmptyStringSchema(codeModeSourceMessage)

/**
 * Validates an unknown value against the code-mode program-definition schema.
 */
function validateProgramDefinition(value: unknown): ProgramFailure | undefined {
  try {
    Schema.decodeUnknownSync(CodeModeDefinitionSchema)(value)
    return undefined
  } catch (cause) {
    return createProgramFailure({
      _tag: 'validation',
      operation: 'definition',
      message: getCodeModeSchemaFailureMessage(cause, 'The code mode definition is invalid.'),
    })
  }
}

/**
 * Validates an unknown value against the code-mode run-options schema.
 */
function validateProgramRunOptions(value: unknown): ProgramFailure | undefined {
  try {
    Schema.decodeUnknownSync(CodeModeRunOptionsSchema)(value)
    return undefined
  } catch (cause) {
    return createProgramFailure({
      _tag: 'validation',
      operation: 'options',
      message: getCodeModeSchemaFailureMessage(cause, 'The code mode run options are invalid.'),
    })
  }
}

/**
 * Finds a method in a program definition by its name.
 */
function findProgramMethod(definition: ProgramDefinition, method: string): ProgramMethod | undefined {
  return definition.methods.find((candidate) => candidate.name === method)
}

export {
  CodeModeDefinitionSchema,
  type CodeModeEncodedHostError,
  CodeModeEncodedHostErrorSchema,
  CodeModeFailureAnySchema,
  CodeModeFailureSchema,
  type CodeModeHostError,
  type CodeModeHostErrorEnvelope,
  CodeModeHostErrorEnvelopeSchema,
  CodeModeMethodSchema,
  CodeModeRunOptionsSchema,
  CodeModeSourceSchema,
  CodeModeWireValueSchema,
  createCodeModeEncodedHostError,
  createCodeModeHostError,
  createCodeModeNonEmptyStringSchema,
  createCodeModePositiveFiniteNumberSchema,
  createProgramFailure,
  findProgramMethod,
  getCodeModeSchemaFailureMessage,
  isCodeModeEncodedHostError,
  isCodeModeHostError,
  isCodeModeWireValue,
  isProgramFailure,
  type ProgramDefinition,
  type ProgramFailure,
  type ProgramFailureFields,
  type ProgramFailureTag,
  ProgramHost,
  type ProgramHostErrorCodec,
  type ProgramHostRequirement,
  type ProgramMethod,
  type ProgramRunner,
  type ProgramRunOptions,
  type ProgramWireValue,
  validateProgramDefinition,
  validateProgramRunOptions,
}
