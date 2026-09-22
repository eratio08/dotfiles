import { type Effect, Schema } from 'effect'
import { type CodeModeFailure, createCodeModeFailure } from './code-mode-failure.ts'
import {
  CodeModeDefinitionSchema,
  CodeModeRunOptionsSchema,
  getCodeModeSchemaFailureMessage,
} from './code-mode-schema.ts'

interface CodeModeMethod {
  readonly name: string
  readonly kind: 'sync' | 'async'
}

type CodeModeWireValue =
  | undefined
  | null
  | boolean
  | number
  | bigint
  | string
  | readonly CodeModeWireValue[]
  | { readonly [key: string]: CodeModeWireValue }

interface CodeModeHostErrorCodec<E> {
  readonly encode: (error: E) => CodeModeWireValue
  readonly decode: (value: CodeModeWireValue) => E
}

interface CodeModeDefinition {
  readonly apiName: string
  readonly programName: string
  readonly declarations: string
  readonly methods: readonly CodeModeMethod[]
  readonly examples: readonly string[]
}

interface CodeModeEffectHost<R, E> {
  readonly invoke: (method: string, args: readonly unknown[], signal: AbortSignal) => Effect.Effect<unknown, E, R>
  readonly invokeSync?: (method: string, args: readonly unknown[]) => unknown
  readonly errorCodec?: CodeModeHostErrorCodec<E>
}

interface CodeModeRunOptions {
  readonly cwd: string
  readonly filenamePrefix: string
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  readonly execution?: 'worker' | 'in-process'
}

interface CodeModeCore<R, E> {
  readonly evaluate: (
    definition: CodeModeDefinition,
    host: CodeModeEffectHost<R, E>,
    code: string,
    options: CodeModeRunOptions,
  ) => Effect.Effect<unknown, CodeModeFailure | E, R>
}

function validateCodeModeDefinition(value: unknown): CodeModeFailure | undefined {
  try {
    Schema.decodeUnknownSync(CodeModeDefinitionSchema)(value)
    return undefined
  } catch (cause) {
    return createCodeModeFailure({
      _tag: 'validation',
      operation: 'definition',
      message: getCodeModeSchemaFailureMessage(cause, 'The code mode definition is invalid.'),
    })
  }
}

function validateCodeModeRunOptions(value: unknown): CodeModeFailure | undefined {
  try {
    Schema.decodeUnknownSync(CodeModeRunOptionsSchema)(value)
    return undefined
  } catch (cause) {
    return createCodeModeFailure({
      _tag: 'validation',
      operation: 'options',
      message: getCodeModeSchemaFailureMessage(cause, 'The code mode run options are invalid.'),
    })
  }
}

function findCodeModeMethod(definition: CodeModeDefinition, method: string): CodeModeMethod | undefined {
  return definition.methods.find((candidate) => candidate.name === method)
}

export {
  type CodeModeCore,
  type CodeModeDefinition,
  type CodeModeEffectHost,
  type CodeModeHostErrorCodec,
  type CodeModeMethod,
  type CodeModeRunOptions,
  type CodeModeWireValue,
  findCodeModeMethod,
  validateCodeModeDefinition,
  validateCodeModeRunOptions,
}
