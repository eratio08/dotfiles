import { Context, type Effect, Schema } from 'effect'
import { type CodeModeFailure, createCodeModeFailure } from './failure.ts'
import { CodeModeDefinitionSchema, CodeModeRunOptionsSchema, getCodeModeSchemaFailureMessage } from './schema.ts'

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

declare const codeModeEffectHostTag: unique symbol

interface CodeModeEffectHostRequirement<R, E> {
  readonly [codeModeEffectHostTag]: readonly [R, E]
}

interface CodeModeEffectHost<R, E> {
  readonly invoke: (method: string, args: readonly unknown[], signal: AbortSignal) => Effect.Effect<unknown, E, R>
  readonly invokeSync?: (method: string, args: readonly unknown[]) => unknown
  readonly errorCodec?: CodeModeHostErrorCodec<E>
}

const CodeModeEffectHost = <R, E>(): Context.Service<CodeModeEffectHostRequirement<R, E>, CodeModeEffectHost<R, E>> =>
  Context.Service<CodeModeEffectHostRequirement<R, E>, CodeModeEffectHost<R, E>>(
    '@eratio/pi-codemode-core/CodeModeEffectHost',
  )

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
    code: string,
    options: CodeModeRunOptions,
  ) => Effect.Effect<unknown, CodeModeFailure | E, R | CodeModeEffectHostRequirement<R, E>>
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
  CodeModeEffectHost,
  type CodeModeEffectHostRequirement,
  type CodeModeHostErrorCodec,
  type CodeModeMethod,
  type CodeModeRunOptions,
  type CodeModeWireValue,
  findCodeModeMethod,
  validateCodeModeDefinition,
  validateCodeModeRunOptions,
}
