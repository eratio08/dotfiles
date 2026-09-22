import { resolve } from 'node:path'
import { type Context, createContext, Script } from 'node:vm'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from '@earendil-works/pi-coding-agent'
import { Effect, Schema } from 'effect'
import { createJiti } from 'jiti'
import type { TodoApi } from './api.ts'

const TODO_CODE_TYPES = `
type TodoId = string;

type TodoStatus = "pending" | "in_progress" | "completed" | "omitted" | "blocked";

interface Todo {
  readonly id: TodoId;
  readonly content: string;
  readonly details?: string;
  readonly status: TodoStatus;
  readonly dependsOn: readonly TodoId[];
}

interface TodoInput {
  readonly content: string;
  readonly details?: string;
  readonly dependsOn?: readonly TodoId[];
}

interface TodoPatch {
  readonly content?: string;
  readonly details?: string | null;
  readonly dependsOn?: readonly TodoId[];
}

interface TodoShowOptions {
  readonly ids?: readonly TodoId[] | null;
  readonly status?: TodoStatus;
  readonly limit?: number;
  readonly includeDetails?: boolean;
}

interface TodoApi {
  add(input: TodoInput): Promise<Todo>;
  update(id: TodoId, patch: TodoPatch): Promise<Todo>;
  show(options?: TodoShowOptions): Promise<readonly Todo[]>;
  next(): Promise<Todo>;
  complete(): Promise<Todo>;
  omit(id: TodoId): Promise<Todo>;
  restore(id: TodoId): Promise<Todo>;
  clear(): Promise<{ readonly cleared: number }>;
}

type TodoProgram = (todo: TodoApi) => unknown | Promise<unknown>;
`

const TODO_CODE_EXAMPLE = `
export default async (todo: TodoApi) => {
  const task = await todo.add({ content: 'Design the API' });
  return task;
}
`

const TODO_CODE_TIMEOUT_MS = 30_000
const todoCodeJiti = createJiti(import.meta.url, { moduleCache: false })
let todoCodeEvaluationNumber = 0

type TodoCodeModule = { default?: unknown }

interface TodoCodeDetails {
  output: string
  truncated: boolean
}

class TodoEvaluationError extends Schema.TaggedError<TodoEvaluationError>()('TodoEvaluationError', {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

function evaluationError(operation: string, cause: unknown): TodoEvaluationError {
  const message =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'object' && cause !== null && 'message' in cause && typeof cause.message === 'string'
        ? cause.message
        : String(cause)
  return new TodoEvaluationError({ operation, message, cause })
}

function evaluationFailure(operation: string, message: string, cause?: unknown): TodoEvaluationError {
  return new TodoEvaluationError({ operation, message, cause })
}

function tryEvaluation<A>(operation: string, run: () => A): Effect.Effect<A, TodoEvaluationError> {
  return Effect.try({
    try: run,
    catch: (cause) => evaluationError(operation, cause),
  })
}

function checkEvaluationAbort(signal: AbortSignal | undefined): Effect.Effect<void, TodoEvaluationError> {
  return signal?.aborted
    ? Effect.fail(evaluationFailure('abort', 'todo execution was aborted', signal.reason))
    : Effect.void
}

function createTodoCodeSource(code: string): string {
  return `${TODO_CODE_TYPES}\n${code}`
}

function createTodoCodeContext(api: TodoApi, module: { exports: TodoCodeModule }): Context {
  return createContext(
    {
      api: Object.freeze(api),
      console: Object.freeze({ log: () => {}, warn: () => {}, error: () => {} }),
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
    },
    { codeGeneration: { strings: false, wasm: false } },
  )
}

function waitForTodoCodeResult(
  value: unknown,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Effect.Effect<unknown, TodoEvaluationError> {
  return Effect.tryPromise({
    try: (effectSignal) =>
      new Promise<unknown>((resolveValue, reject) => {
        let settled = false
        let timeoutId: ReturnType<typeof setTimeout> | undefined
        const signals: AbortSignal[] = []
        for (const candidate of [signal, effectSignal]) {
          if (candidate && !signals.includes(candidate)) signals.push(candidate)
        }
        const cleanup = (): void => {
          if (timeoutId !== undefined) clearTimeout(timeoutId)
          for (const candidate of signals) candidate.removeEventListener('abort', abort)
        }
        const finish = (complete: () => void): void => {
          if (settled) return
          settled = true
          cleanup()
          complete()
        }
        const abort = (): void => {
          const cause = signal?.reason ?? effectSignal.reason
          finish(() => reject(evaluationFailure('abort', 'todo execution was aborted', cause)))
        }
        timeoutId = setTimeout(
          () => finish(() => reject(evaluationFailure('timeout', `todo execution timed out after ${timeoutMs}ms`))),
          timeoutMs,
        )
        for (const candidate of signals) candidate.addEventListener('abort', abort, { once: true })
        if (signals.some((candidate) => candidate.aborted)) {
          abort()
          return
        }
        Promise.resolve(value).then(
          (result) => finish(() => resolveValue(result)),
          (cause) => finish(() => reject(cause)),
        )
      }),
    catch: (cause) => (cause instanceof TodoEvaluationError ? cause : evaluationError('execute', cause)),
  })
}

function stringifyTodoCodeValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'

  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function truncateTodoText(content: string, label: string): { content: string; truncated: boolean } {
  const truncation = truncateHead(content, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  })
  if (!truncation.truncated) return { content, truncated: false }

  return {
    content: `${truncation.content}\n\n[${label} truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`,
    truncated: true,
  }
}

function formatTodoCodeOutput(value: unknown, label = 'Output'): TodoCodeDetails {
  const result = truncateTodoText(stringifyTodoCodeValue(value), label)
  return { output: result.content, truncated: result.truncated }
}

const evaluateTodoCode = Effect.fnUntraced(function* (
  code: string,
  api: TodoApi,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = TODO_CODE_TIMEOUT_MS,
): Effect.fn.Return<unknown, TodoEvaluationError> {
  yield* checkEvaluationAbort(signal)

  const filename = yield* tryEvaluation('resolve', () => resolve(cwd, `.pi/todo-${++todoCodeEvaluationNumber}.ts`))
  const transformedCode = yield* tryEvaluation('transform', () =>
    todoCodeJiti.transform({
      source: createTodoCodeSource(code),
      filename,
      ts: true,
      async: true,
    }),
  )
  const module = { exports: {} as TodoCodeModule }
  const context = yield* tryEvaluation('context', () => createTodoCodeContext(api, module))
  yield* tryEvaluation('compile', () =>
    new Script(transformedCode, { filename }).runInContext(context, { timeout: timeoutMs }),
  )

  if (typeof module.exports.default !== 'function') {
    return yield* Effect.fail(evaluationFailure('validate', 'code must export a default function'))
  }

  const value = yield* tryEvaluation('invoke', () =>
    new Script('module.exports.default(api)', { filename: `${filename}:invoke` }).runInContext(context, {
      timeout: timeoutMs,
    }),
  )
  return yield* waitForTodoCodeResult(value, signal, timeoutMs)
})

export {
  evaluateTodoCode,
  formatTodoCodeOutput,
  TODO_CODE_EXAMPLE,
  TODO_CODE_TYPES,
  type TodoCodeDetails,
  TodoEvaluationError,
}
