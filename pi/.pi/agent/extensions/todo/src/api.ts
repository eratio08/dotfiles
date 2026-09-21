import { randomUUIDv7 } from 'node:crypto'
import { Result, Schema } from 'effect'
import {
  type Todo,
  type TodoId,
  TodoIdSchema,
  type TodoInput,
  TodoInputSchema,
  type TodoPatch,
  TodoPatchSchema,
  type TodoShowOptions,
  TodoShowOptionsSchema,
} from './model.ts'
import {
  cloneTodos,
  getNextTodo,
  reevaluateTodoStates,
  validateTodoContent,
  validateTodoGraph,
} from './state-engine.ts'
import type { TodoTransactionDraft } from './store.ts'

interface TodoApi {
  add(input: TodoInput): Promise<Todo>
  update(id: TodoId, patch: TodoPatch): Promise<Todo>
  show(options?: TodoShowOptions): Promise<readonly Todo[]>
  next(): Promise<Todo>
  complete(): Promise<Todo>
  omit(id: TodoId): Promise<Todo>
  restore(id: TodoId): Promise<Todo>
  clear(): Promise<{ readonly cleared: number }>
}

type TodoMutation = 'added' | 'updated' | 'started' | 'completed' | 'omitted' | 'restored' | 'cleared'

interface TodoApiOptions {
  readonly draft: TodoTransactionDraft
  readonly signal?: AbortSignal
  readonly onMutation?: (operation: TodoMutation, count?: number) => void
}

function invalidInput(name: string): Error {
  return new Error(`Invalid ${name}.`)
}

function decodeInput(input: unknown): TodoInput {
  const result = Schema.decodeUnknownResult(TodoInputSchema)(input)
  if (Result.isFailure(result)) throw invalidInput('todo input')
  return result.success
}

function decodePatch(patch: unknown): TodoPatch {
  const result = Schema.decodeUnknownResult(TodoPatchSchema)(patch)
  if (Result.isFailure(result)) throw invalidInput('todo patch')
  return result.success
}

function decodeShowOptions(options: unknown): TodoShowOptions {
  const result = Schema.decodeUnknownResult(TodoShowOptionsSchema)(options ?? {})
  if (Result.isFailure(result)) throw invalidInput('todo show options')
  return result.success
}

function assertTodoId(id: unknown): asserts id is TodoId {
  const result = Schema.decodeUnknownResult(TodoIdSchema)(id)
  if (Result.isFailure(result)) throw new Error(`Invalid todo ID: ${String(id)}.`)
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('Todo transaction was aborted.')
}

function withDetails(todo: Todo, details: string | undefined): Todo {
  const { details: _details, ...withoutDetails } = todo
  return details === undefined
    ? { ...withoutDetails, dependsOn: [...todo.dependsOn] }
    : { ...withoutDetails, dependsOn: [...todo.dependsOn], details }
}

function commitDraft(draft: TodoTransactionDraft, todos: readonly Todo[]): Todo[] {
  const error = validateTodoGraph(todos)
  if (error) throw new Error(error)
  const next = reevaluateTodoStates(todos)
  draft.replace(next)
  return cloneTodos(next)
}

function findTodo(todos: readonly Todo[], id: TodoId): Todo {
  const todo = todos.find((candidate) => candidate.id === id)
  if (!todo) throw new Error(`Unknown todo ID: ${id}.`)
  return todo
}

function createTodoApi({ draft, signal, onMutation }: TodoApiOptions): TodoApi {
  const add = async (input: TodoInput): Promise<Todo> => {
    assertNotAborted(signal)
    const value = decodeInput(input)
    const content = value.content.trim()
    const contentError = validateTodoContent(content)
    if (contentError) throw new Error(contentError)

    const current = draft.snapshot()
    const dependencies = [...(value.dependsOn ?? [])]
    const existingIds = new Set(current.map((todo) => todo.id))
    for (const dependency of dependencies) {
      if (!existingIds.has(dependency)) {
        throw new Error(`Cannot add todo: unknown dependency ID ${dependency}.`)
      }
    }

    let id = randomUUIDv7()
    for (let attempt = 0; attempt < 100 && existingIds.has(id); attempt += 1) {
      id = randomUUIDv7()
    }
    if (existingIds.has(id)) throw new Error('Cannot add todo: failed to generate a unique UUID.')

    const todo: Todo = {
      id,
      content,
      status: 'pending',
      dependsOn: dependencies,
      ...(value.details === undefined ? {} : { details: value.details }),
    }
    const next = commitDraft(draft, [...current, todo])
    onMutation?.('added')
    return cloneTodos([findTodo(next, id)])[0] as Todo
  }

  const update = async (id: TodoId, patch: TodoPatch): Promise<Todo> => {
    assertNotAborted(signal)
    assertTodoId(id)
    const value = decodePatch(patch)
    const current = draft.snapshot()
    const existing = findTodo(current, id)
    if (existing.status === 'completed' && Object.hasOwn(value, 'dependsOn')) {
      throw new Error(`Cannot change dependencies for completed todo ${id}.`)
    }

    let content = existing.content
    let details = existing.details
    let dependsOn = [...existing.dependsOn]
    if (Object.hasOwn(value, 'content')) {
      content = value.content?.trim() ?? ''
      const contentError = validateTodoContent(content)
      if (contentError) throw new Error(`Cannot update todo ${id}: ${contentError}`)
    }
    if (Object.hasOwn(value, 'details')) {
      details = value.details === null ? undefined : value.details
    }
    if (Object.hasOwn(value, 'dependsOn')) {
      dependsOn = [...(value.dependsOn ?? [])]
    }

    const nextTodo = withDetails({ ...existing, content, dependsOn }, details)
    const next = commitDraft(
      draft,
      current.map((todo) => (todo.id === id ? nextTodo : todo)),
    )
    onMutation?.('updated')
    return cloneTodos([findTodo(next, id)])[0] as Todo
  }

  const show = async (options?: TodoShowOptions): Promise<readonly Todo[]> => {
    assertNotAborted(signal)
    const value = decodeShowOptions(options)
    const current = draft.snapshot()
    if (!value.ids || value.ids.length === 0) {
      return cloneTodos(current).map((todo) => (value.includeDetails ? todo : withDetails(todo, undefined)))
    }

    const selected = value.ids.map((id) => findTodo(current, id))
    return cloneTodos(selected).map((todo) => (value.includeDetails ? todo : withDetails(todo, undefined)))
  }

  const next = async (): Promise<Todo> => {
    assertNotAborted(signal)
    const current = draft.snapshot()
    const active = current.find((todo) => todo.status === 'in_progress')
    if (active) throw new Error(`Cannot start next todo: "${active.content}" (${active.id}) is already active.`)

    const ready = getNextTodo(current)
    if (!ready) throw new Error('No todo is ready.')

    const next = commitDraft(
      draft,
      current.map((todo) => (todo.id === ready.id ? { ...todo, status: 'in_progress' as const } : todo)),
    )
    onMutation?.('started')
    return cloneTodos([findTodo(next, ready.id)])[0] as Todo
  }

  const complete = async (): Promise<Todo> => {
    assertNotAborted(signal)
    const current = draft.snapshot()
    const active = current.find((todo) => todo.status === 'in_progress')
    if (!active) throw new Error('No active todo is available to complete.')

    const next = commitDraft(
      draft,
      current.map((todo) => (todo.id === active.id ? { ...todo, status: 'completed' as const } : todo)),
    )
    onMutation?.('completed')
    return cloneTodos([findTodo(next, active.id)])[0] as Todo
  }

  const omit = async (id: TodoId): Promise<Todo> => {
    assertNotAborted(signal)
    assertTodoId(id)
    const current = draft.snapshot()
    const existing = findTodo(current, id)
    if (existing.status === 'completed' || existing.status === 'omitted') {
      throw new Error(`Cannot omit todo ${id} with status ${existing.status}.`)
    }

    const next = commitDraft(
      draft,
      current.map((todo) => (todo.id === id ? { ...todo, status: 'omitted' as const } : todo)),
    )
    onMutation?.('omitted')
    return cloneTodos([findTodo(next, id)])[0] as Todo
  }

  const restore = async (id: TodoId): Promise<Todo> => {
    assertNotAborted(signal)
    assertTodoId(id)
    const current = draft.snapshot()
    const existing = findTodo(current, id)
    if (existing.status !== 'omitted') {
      throw new Error(`Cannot restore todo ${id} with status ${existing.status}.`)
    }

    const next = commitDraft(
      draft,
      current.map((todo) => (todo.id === id ? { ...todo, status: 'pending' as const } : todo)),
    )
    onMutation?.('restored')
    return cloneTodos([findTodo(next, id)])[0] as Todo
  }

  const clear = async (): Promise<{ readonly cleared: number }> => {
    assertNotAborted(signal)
    const cleared = draft.snapshot().length
    draft.replace([])
    onMutation?.('cleared', cleared)
    return { cleared }
  }

  return { add, update, show, next, complete, omit, restore, clear }
}

export { createTodoApi, type TodoApi }
