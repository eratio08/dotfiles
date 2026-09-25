import { resolve } from 'node:path'
import { createContext, Script } from 'node:vm'
import { Schema } from 'effect'
import { createJiti } from 'jiti'
import type { ProgramDefinition, ProgramMethod } from './contract.ts'
import {
  createProgramFailure,
  isCodeModeEncodedHostError,
  isCodeModeHostError,
  isProgramFailure,
  type ProgramFailure,
} from './failure.ts'
import { CodeModeExceptionMessageSchema, CodeModeExceptionSchema } from './schema.ts'

type CodeModeJiti = ReturnType<typeof createJiti>
type CodeModeApiFunction = (...args: readonly unknown[]) => unknown

type CodeModeSyncInvoker = (method: string, args: readonly unknown[]) => unknown
type CodeModeAsyncInvoker = (method: string, args: readonly unknown[]) => Promise<unknown>

interface CodeModeVmModule {
  exports: {
    default?: unknown
  }
}

function createCodeModeJiti(): CodeModeJiti {
  return createJiti(import.meta.url, { moduleCache: false })
}

function createCodeModeFilename(cwd: string, filenamePrefix: string, evaluationNumber: number): string {
  return resolve(cwd, '.pi', `${filenamePrefix}-${evaluationNumber}.ts`)
}

function validateCodeModeImports(code: string): ProgramFailure | undefined {
  if (/(?:^|[;\n\r])\s*import\s*(?:\(|(?:type\s+)?(?:[\s\S]*?from\s*)?['"])/m.test(code))
    return createProgramFailure({
      _tag: 'validation',
      operation: 'import',
      message: 'External and dynamic imports are not supported in code mode programs.',
    })
  return undefined
}

function transformCodeModeProgram(
  jiti: CodeModeJiti,
  definition: ProgramDefinition,
  code: string,
  filename: string,
): string {
  return jiti.transform({
    source: `${definition.declarations}\n${code}`,
    filename,
    ts: true,
    async: true,
  })
}

function createCodeModeApi(
  methods: readonly ProgramMethod[],
  invokeSync: CodeModeSyncInvoker,
  invokeAsync: CodeModeAsyncInvoker,
): Readonly<Record<string, CodeModeApiFunction>> {
  const api = Object.create(null) as Record<string, CodeModeApiFunction>
  for (const method of methods) {
    const call =
      method.kind === 'sync'
        ? createCodeModeSyncMethod(method.name, invokeSync)
        : createCodeModeAsyncMethod(method.name, invokeAsync)
    Object.defineProperty(api, method.name, {
      configurable: false,
      enumerable: true,
      value: call,
      writable: false,
    })
  }
  return Object.freeze(api)
}

function createCodeModeSyncMethod(method: string, invokeSync: CodeModeSyncInvoker): CodeModeApiFunction {
  return (...args: readonly unknown[]): unknown => {
    const value = invokeSync(method, args)
    if (isCodeModePromiseLike(value))
      throw createProgramFailure({
        _tag: 'transport',
        operation: method,
        message: `The synchronous code mode method ${method} returned a Promise.`,
      })
    return value
  }
}

function createCodeModeAsyncMethod(method: string, invokeAsync: CodeModeAsyncInvoker): CodeModeApiFunction {
  return (...args: readonly unknown[]): Promise<unknown> => Promise.resolve().then(() => invokeAsync(method, args))
}

async function runCodeModeVm(
  code: string,
  api: Readonly<Record<string, CodeModeApiFunction>>,
  filename: string,
  timeoutMs: number,
  startedAt = performance.now(),
  signal?: AbortSignal,
  remainingTimeoutMs: () => number = () => remainingCodeModeTimeout(startedAt, timeoutMs),
): Promise<unknown> {
  const module: CodeModeVmModule = { exports: Object.create(null) as { default?: unknown } }
  const context = createCodeModeContext(api, module)
  const remainingForCompile = remainingTimeoutMs()
  try {
    new Script(code, { filename }).runInContext(context, { timeout: remainingForCompile })
  } catch (cause) {
    throw createCodeModeExceptionFailure(cause, 'compile', 'The TypeScript program could not be compiled.')
  }

  if (typeof module.exports.default !== 'function')
    throw createProgramFailure({
      _tag: 'validation',
      operation: 'default-export',
      message: 'The TypeScript program must export a callable default function.',
    })

  let result: unknown
  try {
    result = new Script('module.exports.default(api)', { filename: `${filename}:invoke` }).runInContext(context, {
      timeout: remainingTimeoutMs(),
    })
  } catch (cause) {
    if (isProgramFailure(cause) || isCodeModeHostError(cause) || isCodeModeEncodedHostError(cause)) throw cause
    throw createCodeModeExceptionFailure(cause, 'invoke', 'The TypeScript program failed during invocation.')
  }

  try {
    return await awaitCodeModeResult(result, remainingTimeoutMs, timeoutMs, signal)
  } catch (cause) {
    if (isProgramFailure(cause) || isCodeModeHostError(cause) || isCodeModeEncodedHostError(cause)) throw cause
    throw createCodeModeExceptionFailure(cause, 'await', 'The TypeScript program failed after invocation.')
  }
}

function createCodeModeContext(api: Readonly<Record<string, CodeModeApiFunction>>, module: CodeModeVmModule): object {
  return createContext(
    {
      api,
      console: Object.freeze({ log: () => undefined, warn: () => undefined, error: () => undefined }),
      exports: module.exports,
      fetch: undefined,
      global: undefined,
      globalThis: undefined,
      module,
      process: undefined,
      require: undefined,
      setImmediate: undefined,
      setInterval: undefined,
      setTimeout: undefined,
      clearImmediate: undefined,
      clearInterval: undefined,
      clearTimeout: undefined,
      Bun: undefined,
      Deno: undefined,
      WebAssembly: undefined,
    },
    { codeGeneration: { strings: false, wasm: false } },
  )
}

async function awaitCodeModeResult(
  result: unknown,
  remainingTimeoutMs: () => number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  if (!isCodeModePromiseLike(result)) return result
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let removeAbortListener = (): void => undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        createProgramFailure({
          _tag: 'timeout',
          operation: 'await',
          message: `The code mode program timed out after ${timeoutMs}ms.`,
        }),
      )
    }, remainingTimeoutMs())
  })
  const cancellation =
    signal === undefined
      ? undefined
      : new Promise<never>((_, reject) => {
          const abort = (): void =>
            reject(
              createProgramFailure({
                _tag: 'cancellation',
                operation: 'await',
                message: 'The code mode program was cancelled.',
              }),
            )
          removeAbortListener = (): void => signal.removeEventListener('abort', abort)
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort, { once: true })
        })
  try {
    const promises: PromiseLike<unknown>[] = [result, timeout]
    if (cancellation !== undefined) promises.push(cancellation)
    return await Promise.race(promises)
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    removeAbortListener()
  }
}

function remainingCodeModeTimeout(startedAt: number, timeoutMs: number): number {
  return Math.max(1, Math.ceil(timeoutMs - (performance.now() - startedAt)))
}

function createCodeModeExceptionFailure(cause: unknown, operation: string, fallbackMessage: string): ProgramFailure {
  let error: { readonly message: string; readonly name?: string; readonly stack?: string } | undefined
  try {
    const decoded = Schema.decodeUnknownSync(CodeModeExceptionSchema)(cause)
    error = {
      message: decoded.message,
      name: decodeCodeModeExceptionProperty(cause, 'name') ?? decoded.name,
      stack: decodeCodeModeExceptionProperty(cause, 'stack') ?? decoded.stack,
    }
  } catch {
    try {
      const decoded = Schema.decodeUnknownSync(CodeModeExceptionMessageSchema)(cause)
      error = {
        message: decoded.message,
        name: decodeCodeModeExceptionProperty(cause, 'name'),
        stack: decodeCodeModeExceptionProperty(cause, 'stack'),
      }
    } catch {
      error = undefined
    }
  }
  return createProgramFailure({
    _tag: operation === 'compile' ? 'compile' : 'invoke',
    operation,
    message: error?.message ?? (typeof cause === 'string' ? cause : fallbackMessage),
    name: error?.name,
    stack: error?.stack,
    cause,
  })
}

function decodeCodeModeExceptionProperty(value: unknown, property: 'name' | 'stack'): string | undefined {
  try {
    return Schema.decodeUnknownSync(Schema.optional(Schema.String))(Reflect.get(value as object, property))
  } catch {
    return undefined
  }
}

function isCodeModePromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function'
}

export {
  type CodeModeApiFunction,
  type CodeModeAsyncInvoker,
  type CodeModeJiti,
  type CodeModeSyncInvoker,
  createCodeModeApi,
  createCodeModeFilename,
  createCodeModeJiti,
  isCodeModePromiseLike,
  runCodeModeVm,
  transformCodeModeProgram,
  validateCodeModeImports,
}
