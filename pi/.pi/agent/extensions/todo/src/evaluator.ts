import { resolve } from 'node:path'
import { type Context, createContext, Script } from 'node:vm'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from '@earendil-works/pi-coding-agent'
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
  readonly ids?: readonly TodoId[];
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

async function waitForTodoCodeResult(
  value: unknown,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<unknown> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let abortHandler: (() => void) | undefined
  try {
    return await Promise.race([
      Promise.resolve(value),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`todo execution timed out after ${timeoutMs}ms`)), timeoutMs)
        abortHandler = () => reject(new Error('todo execution was aborted'))
        signal?.addEventListener('abort', abortHandler, { once: true })
        if (signal?.aborted) abortHandler()
      }),
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    if (abortHandler) signal?.removeEventListener('abort', abortHandler)
  }
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

async function evaluateTodoCode(
  code: string,
  api: TodoApi,
  cwd: string,
  signal?: AbortSignal,
  timeoutMs = TODO_CODE_TIMEOUT_MS,
): Promise<unknown> {
  todoCodeEvaluationNumber += 1
  const filename = resolve(cwd, `.pi/todo-${todoCodeEvaluationNumber}.ts`)
  const transformedCode = todoCodeJiti.transform({
    source: createTodoCodeSource(code),
    filename,
    ts: true,
    async: true,
  })
  const module = { exports: {} as TodoCodeModule }
  const context = createTodoCodeContext(api, module)
  new Script(transformedCode, { filename }).runInContext(context, { timeout: timeoutMs })

  if (typeof module.exports.default !== 'function') {
    throw new Error('code must export a default function')
  }

  const value = new Script('module.exports.default(api)', { filename: `${filename}:invoke` }).runInContext(context, {
    timeout: timeoutMs,
  })
  return waitForTodoCodeResult(value, signal, timeoutMs)
}

export { evaluateTodoCode, formatTodoCodeOutput, TODO_CODE_EXAMPLE, TODO_CODE_TYPES, type TodoCodeDetails }
