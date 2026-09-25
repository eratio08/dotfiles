import { Context, type Effect, Schema } from 'effect'
import { createProgramFailure, type ProgramFailure } from './failure.ts'
import { CodeModeDefinitionSchema, CodeModeRunOptionsSchema, getCodeModeSchemaFailureMessage } from './schema.ts'

interface ProgramMethod {
  readonly name: string
  readonly kind: 'sync' | 'async'
}

type ProgramWireValue =
  | undefined
  | null
  | boolean
  | number
  | bigint
  | string
  | readonly ProgramWireValue[]
  | { readonly [key: string]: ProgramWireValue }

interface ProgramHostErrorCodec<E> {
  readonly encode: (error: E) => ProgramWireValue
  readonly decode: (value: ProgramWireValue) => E
}

interface ProgramDefinition {
  readonly apiName: string
  readonly programName: string
  readonly declarations: string
  readonly methods: readonly ProgramMethod[]
  readonly examples: readonly string[]
}

declare const programHostTag: unique symbol

interface ProgramHostRequirement<R, E> {
  readonly [programHostTag]: readonly [R, E]
}

interface ProgramHost<R, E> {
  readonly invoke: (method: string, args: readonly unknown[], signal: AbortSignal) => Effect.Effect<unknown, E, R>
  readonly invokeSync?: (method: string, args: readonly unknown[]) => unknown
  readonly errorCodec?: ProgramHostErrorCodec<E>
}

const ProgramHost = <R, E>(): Context.Service<ProgramHostRequirement<R, E>, ProgramHost<R, E>> =>
  Context.Service<ProgramHostRequirement<R, E>, ProgramHost<R, E>>('@eratio/pi-codemode-core/CodeModeEffectHost')

interface ProgramRunOptions {
  readonly cwd: string
  readonly filenamePrefix: string
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  readonly execution?: 'worker' | 'in-process'
}

interface ProgramRunner<R, E> {
  readonly evaluate: (
    definition: ProgramDefinition,
    code: string,
    options: ProgramRunOptions,
  ) => Effect.Effect<unknown, ProgramFailure | E, R | ProgramHostRequirement<R, E>>
}

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
