import { randomUUID } from 'node:crypto'
import { Result, Schema } from 'effect'
import { TODO_API_HELP } from './code-mode.ts'
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
import { cloneTodos, TodoUpdateError } from './state.ts'
import { getNextTodo, reevaluateTodoStates, validateTodoContent, validateTodoGraph } from './state-engine.ts'
import type { TodoTransactionDraft } from './store.ts'

interface TodoApi {
  help(): string
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
type TodoResult<A> = Result.Result<A, TodoUpdateError>

interface TodoApiOptions {
  readonly draft: TodoTransactionDraft
  readonly signal?: AbortSignal
  readonly onMutation?: (operation: TodoMutation, count?: number) => void
  readonly onShow?: () => void
}

function todoUpdateError(message: string, cause?: unknown): TodoUpdateError {
  return new TodoUpdateError({ message, cause })
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function tryTodoApi<A>(run: () => A): TodoResult<A> {
  try {
    return Result.succeed(run())
  } catch (cause) {
    return Result.fail(todoUpdateError(errorMessage(cause), cause))
  }
}

function promiseResult<A>(result: Result.Failure<A, TodoUpdateError>): Promise<never>
function promiseResult<A>(result: TodoResult<A>): Promise<A>
function promiseResult<A>(result: TodoResult<A>): Promise<A> {
  return Result.isFailure(result) ? Promise.reject(result.failure) : Promise.resolve(result.success)
}

function decodeTodoValue<A>(decode: () => Result.Result<A, unknown>, invalidMessage: string): TodoResult<A> {
  const decoded = tryTodoApi(decode)
  if (Result.isFailure(decoded)) return Result.fail(decoded.failure)
  return Result.isFailure(decoded.success)
    ? Result.fail(todoUpdateError(invalidMessage, decoded.success.failure))
    : Result.succeed(decoded.success.success)
}

function decodeInput(input: unknown): TodoResult<TodoInput> {
  return decodeTodoValue(() => Schema.decodeUnknownResult(TodoInputSchema)(input), 'Invalid todo input.')
}

function decodePatch(patch: unknown): TodoResult<TodoPatch> {
  return decodeTodoValue(() => Schema.decodeUnknownResult(TodoPatchSchema)(patch), 'Invalid todo patch.')
}

function decodeShowOptions(options: unknown): TodoResult<TodoShowOptions> {
  return decodeTodoValue(
    () => Schema.decodeUnknownResult(TodoShowOptionsSchema)(options ?? {}),
    'Invalid todo show options: provide task IDs, an array of statuses, and a positive integer limit.',
  )
}

function assertTodoId(id: unknown): TodoResult<TodoId> {
  return decodeTodoValue(() => Schema.decodeUnknownResult(TodoIdSchema)(id), `Invalid todo ID: ${String(id)}.`)
}

function assertNotAborted(signal: AbortSignal | undefined): TodoResult<void> {
  return signal?.aborted ? Result.fail(todoUpdateError('Todo transaction was aborted.')) : Result.succeed(undefined)
}

function withDetails(todo: Todo, details: string | undefined): Todo {
  const { details: _details, ...withoutDetails } = todo
  return details === undefined
    ? { ...withoutDetails, dependsOn: [...todo.dependsOn] }
    : { ...withoutDetails, dependsOn: [...todo.dependsOn], details }
}

function commitDraft(draft: TodoTransactionDraft, todos: readonly Todo[]): TodoResult<Todo[]> {
  const validation = tryTodoApi(() => validateTodoGraph(todos))
  if (Result.isFailure(validation)) return Result.fail(validation.failure)
  if (validation.success) return Result.fail(todoUpdateError(validation.success))

  return tryTodoApi(() => {
    const next = reevaluateTodoStates(todos)
    draft.replace(next)
    return cloneTodos(next)
  })
}

function findTodo(todos: readonly Todo[], id: TodoId): TodoResult<Todo> {
  const todo = todos.find((candidate) => candidate.id === id)
  return todo ? Result.succeed(todo) : Result.fail(todoUpdateError(`Unknown todo ID: ${id}.`))
}

function generateTodoId(existingIds: ReadonlySet<string>): TodoResult<TodoId> {
  let idResult = tryTodoApi(randomUUID)
  if (Result.isFailure(idResult)) return idResult
  let id = idResult.success
  for (let attempt = 0; attempt < 100 && existingIds.has(id); attempt += 1) {
    idResult = tryTodoApi(randomUUID)
    if (Result.isFailure(idResult)) return idResult
    id = idResult.success
  }
  return existingIds.has(id)
    ? Result.fail(todoUpdateError('Cannot add todo: failed to generate a unique UUID.'))
    : Result.succeed(id)
}

function recordMutation(
  onMutation: TodoApiOptions['onMutation'],
  operation: TodoMutation,
  count?: number,
): TodoResult<void> {
  return onMutation ? tryTodoApi(() => onMutation(operation, count)) : Result.succeed(undefined)
}

function createTodoApi({ draft, signal, onMutation, onShow }: TodoApiOptions): TodoApi {
  const add = (input: unknown): Promise<Todo> => {
    const aborted = assertNotAborted(signal)
    if (Result.isFailure(aborted)) return promiseResult(aborted)
    const valueResult = decodeInput(input)
    if (Result.isFailure(valueResult)) return promiseResult(valueResult)
    const value = valueResult.success
    const content = value.content.trim()
    const contentError = validateTodoContent(content)
    if (contentError) return promiseResult(Result.fail(todoUpdateError(contentError)))

    const currentResult = tryTodoApi(() => draft.snapshot())
    if (Result.isFailure(currentResult)) return promiseResult(currentResult)
    const current = currentResult.success
    const dependencies = [...(value.dependsOn ?? [])]
    const existingIds = new Set(current.map((todo) => todo.id))
    for (const dependency of dependencies) {
      if (!existingIds.has(dependency)) {
        return promiseResult(Result.fail(todoUpdateError(`Cannot add todo: unknown dependency ID ${dependency}.`)))
      }
    }

    const idResult = generateTodoId(existingIds)
    if (Result.isFailure(idResult)) return promiseResult(idResult)
    const todo: Todo = {
      id: idResult.success,
      content,
      status: 'pending',
      dependsOn: dependencies,
      ...(value.details === undefined ? {} : { details: value.details }),
    }
    const nextResult = commitDraft(draft, [...current, todo])
    if (Result.isFailure(nextResult)) return promiseResult(nextResult)
    const mutation = recordMutation(onMutation, 'added')
    if (Result.isFailure(mutation)) return promiseResult(mutation)
    const created = findTodo(nextResult.success, idResult.success)
    if (Result.isFailure(created)) return promiseResult(created)
    return promiseResult(tryTodoApi(() => cloneTodos([created.success])[0] as Todo))
  }

  const update = (id: unknown, patch: unknown): Promise<Todo> => {
    const aborted = assertNotAborted(signal)
    if (Result.isFailure(aborted)) return promiseResult(aborted)
    const todoIdResult = assertTodoId(id)
    if (Result.isFailure(todoIdResult)) return promiseResult(todoIdResult)
    const valueResult = decodePatch(patch)
    if (Result.isFailure(valueResult)) return promiseResult(valueResult)
    const currentResult = tryTodoApi(() => draft.snapshot())
    if (Result.isFailure(currentResult)) return promiseResult(currentResult)
    const current = currentResult.success
    const existingResult = findTodo(current, todoIdResult.success)
    if (Result.isFailure(existingResult)) return promiseResult(existingResult)
    const existing = existingResult.success
    const value = valueResult.success
    if (existing.status === 'completed' && Object.hasOwn(value, 'dependsOn')) {
      return promiseResult(
        Result.fail(todoUpdateError(`Cannot change dependencies for completed todo ${todoIdResult.success}.`)),
      )
    }

    let content = existing.content
    let details = existing.details
    let dependsOn = [...existing.dependsOn]
    if (Object.hasOwn(value, 'content')) {
      content = value.content?.trim() ?? ''
      const contentError = validateTodoContent(content)
      if (contentError) {
        return promiseResult(
          Result.fail(todoUpdateError(`Cannot update todo ${todoIdResult.success}: ${contentError}`)),
        )
      }
    }
    if (Object.hasOwn(value, 'details')) details = value.details === null ? undefined : value.details
    if (Object.hasOwn(value, 'dependsOn')) dependsOn = [...(value.dependsOn ?? [])]

    const nextTodo = withDetails({ ...existing, content, dependsOn }, details)
    const nextResult = commitDraft(
      draft,
      current.map((todo) => (todo.id === todoIdResult.success ? nextTodo : todo)),
    )
    if (Result.isFailure(nextResult)) return promiseResult(nextResult)
    const mutation = recordMutation(onMutation, 'updated')
    if (Result.isFailure(mutation)) return promiseResult(mutation)
    const updated = findTodo(nextResult.success, todoIdResult.success)
    if (Result.isFailure(updated)) return promiseResult(updated)
    return promiseResult(tryTodoApi(() => cloneTodos([updated.success])[0] as Todo))
  }

  const show = (options: unknown): Promise<readonly Todo[]> => {
    const aborted = assertNotAborted(signal)
    if (Result.isFailure(aborted)) return promiseResult(aborted)
    const valueResult = decodeShowOptions(options)
    if (Result.isFailure(valueResult)) return promiseResult(valueResult)
    const currentResult = tryTodoApi(() => draft.snapshot())
    if (Result.isFailure(currentResult)) return promiseResult(currentResult)
    const current = currentResult.success
    const value = valueResult.success
    const ids = value.ids
    if (value.status !== undefined && ids && ids.length > 0) {
      return promiseResult(
        Result.fail(todoUpdateError('Invalid todo show options: choose either ids or status, not both.')),
      )
    }

    let selected: Todo[]
    if (ids && ids.length > 0) {
      const selectedTodos: Todo[] = []
      for (const id of ids) {
        const selectedTodo = findTodo(current, id)
        if (Result.isFailure(selectedTodo)) return promiseResult(selectedTodo)
        selectedTodos.push(selectedTodo.success)
      }
      selected = selectedTodos.sort((left, right) => left.id.localeCompare(right.id))
    } else {
      const statuses: readonly Todo['status'][] = value.status ?? ['in_progress', 'pending']
      selected = current
        .filter((todo) => statuses.includes(todo.status))
        .sort((left, right) => left.id.localeCompare(right.id))
      selected.length = Math.min(selected.length, value.limit ?? 5)
    }

    return promiseResult(
      tryTodoApi(() => {
        const result = value.includeDetails
          ? cloneTodos(selected)
          : selected.map((todo) => withDetails(todo, undefined))
        onShow?.()
        return result
      }),
    )
  }

  const next = (): Promise<Todo> => {
    const aborted = assertNotAborted(signal)
    if (Result.isFailure(aborted)) return promiseResult(aborted)
    const currentResult = tryTodoApi(() => draft.snapshot())
    if (Result.isFailure(currentResult)) return promiseResult(currentResult)
    const current = currentResult.success
    const active = current.find((todo) => todo.status === 'in_progress')
    if (active) {
      return promiseResult(
        Result.fail(todoUpdateError(`Cannot start next todo: "${active.content}" (${active.id}) is already active.`)),
      )
    }
    const ready = getNextTodo(current)
    if (!ready) return promiseResult(Result.fail(todoUpdateError('No todo is ready.')))
    const nextResult = commitDraft(
      draft,
      current.map((todo) => (todo.id === ready.id ? { ...todo, status: 'in_progress' as const } : todo)),
    )
    if (Result.isFailure(nextResult)) return promiseResult(nextResult)
    const mutation = recordMutation(onMutation, 'started')
    if (Result.isFailure(mutation)) return promiseResult(mutation)
    const started = findTodo(nextResult.success, ready.id)
    if (Result.isFailure(started)) return promiseResult(started)
    return promiseResult(tryTodoApi(() => cloneTodos([started.success])[0] as Todo))
  }

  const complete = (): Promise<Todo> => {
    const aborted = assertNotAborted(signal)
    if (Result.isFailure(aborted)) return promiseResult(aborted)
    const currentResult = tryTodoApi(() => draft.snapshot())
    if (Result.isFailure(currentResult)) return promiseResult(currentResult)
    const current = currentResult.success
    const active = current.find((todo) => todo.status === 'in_progress')
    if (!active) return promiseResult(Result.fail(todoUpdateError('No active todo is available to complete.')))
    const nextResult = commitDraft(
      draft,
      current.map((todo) => (todo.id === active.id ? { ...todo, status: 'completed' as const } : todo)),
    )
    if (Result.isFailure(nextResult)) return promiseResult(nextResult)
    const mutation = recordMutation(onMutation, 'completed')
    if (Result.isFailure(mutation)) return promiseResult(mutation)
    const completed = findTodo(nextResult.success, active.id)
    if (Result.isFailure(completed)) return promiseResult(completed)
    return promiseResult(tryTodoApi(() => cloneTodos([completed.success])[0] as Todo))
  }

  const omit = (id: unknown): Promise<Todo> => {
    const aborted = assertNotAborted(signal)
    if (Result.isFailure(aborted)) return promiseResult(aborted)
    const todoIdResult = assertTodoId(id)
    if (Result.isFailure(todoIdResult)) return promiseResult(todoIdResult)
    const currentResult = tryTodoApi(() => draft.snapshot())
    if (Result.isFailure(currentResult)) return promiseResult(currentResult)
    const current = currentResult.success
    const existingResult = findTodo(current, todoIdResult.success)
    if (Result.isFailure(existingResult)) return promiseResult(existingResult)
    const existing = existingResult.success
    if (existing.status === 'completed' || existing.status === 'omitted') {
      return promiseResult(
        Result.fail(todoUpdateError(`Cannot omit todo ${todoIdResult.success} with status ${existing.status}.`)),
      )
    }
    const nextResult = commitDraft(
      draft,
      current.map((todo) => (todo.id === todoIdResult.success ? { ...todo, status: 'omitted' as const } : todo)),
    )
    if (Result.isFailure(nextResult)) return promiseResult(nextResult)
    const mutation = recordMutation(onMutation, 'omitted')
    if (Result.isFailure(mutation)) return promiseResult(mutation)
    const omitted = findTodo(nextResult.success, todoIdResult.success)
    if (Result.isFailure(omitted)) return promiseResult(omitted)
    return promiseResult(tryTodoApi(() => cloneTodos([omitted.success])[0] as Todo))
  }

  const restore = (id: unknown): Promise<Todo> => {
    const aborted = assertNotAborted(signal)
    if (Result.isFailure(aborted)) return promiseResult(aborted)
    const todoIdResult = assertTodoId(id)
    if (Result.isFailure(todoIdResult)) return promiseResult(todoIdResult)
    const currentResult = tryTodoApi(() => draft.snapshot())
    if (Result.isFailure(currentResult)) return promiseResult(currentResult)
    const current = currentResult.success
    const existingResult = findTodo(current, todoIdResult.success)
    if (Result.isFailure(existingResult)) return promiseResult(existingResult)
    const existing = existingResult.success
    if (existing.status !== 'omitted') {
      return promiseResult(
        Result.fail(todoUpdateError(`Cannot restore todo ${todoIdResult.success} with status ${existing.status}.`)),
      )
    }
    const nextResult = commitDraft(
      draft,
      current.map((todo) => (todo.id === todoIdResult.success ? { ...todo, status: 'pending' as const } : todo)),
    )
    if (Result.isFailure(nextResult)) return promiseResult(nextResult)
    const mutation = recordMutation(onMutation, 'restored')
    if (Result.isFailure(mutation)) return promiseResult(mutation)
    const restored = findTodo(nextResult.success, todoIdResult.success)
    if (Result.isFailure(restored)) return promiseResult(restored)
    return promiseResult(tryTodoApi(() => cloneTodos([restored.success])[0] as Todo))
  }

  const clear = (): Promise<{ readonly cleared: number }> => {
    const aborted = assertNotAborted(signal)
    if (Result.isFailure(aborted)) return promiseResult(aborted)
    const currentResult = tryTodoApi(() => draft.snapshot())
    if (Result.isFailure(currentResult)) return promiseResult(currentResult)
    const cleared = currentResult.success.length
    const replaced = tryTodoApi(() => draft.replace([]))
    if (Result.isFailure(replaced)) return promiseResult(replaced)
    const mutation = recordMutation(onMutation, 'cleared', cleared)
    if (Result.isFailure(mutation)) return promiseResult(mutation)
    return Promise.resolve({ cleared })
  }

  return { help: () => TODO_API_HELP, add, update, show, next, complete, omit, restore, clear }
}

export { createTodoApi, type TodoApi }
