import { Context, type Effect, Schema } from 'effect'
import { createProgramFailure, type ProgramFailure } from './failure.ts'
import { CodeModeDefinitionSchema, CodeModeRunOptionsSchema, getCodeModeSchemaFailureMessage } from './schema.ts'

/**
 * Describes a host method and whether a code-mode program invokes it synchronously or asynchronously.
 */
type ProgramMethod = {
  readonly name: string
  readonly kind: 'sync' | 'async'
}

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

/**
 * Marks the Effect environment as requiring the typed program-host service.
 */
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
  findProgramMethod,
  type ProgramDefinition,
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
