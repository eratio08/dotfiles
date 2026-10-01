import { randomUUID } from 'node:crypto'
import { Pi, PiContext, type PiContextTag, type PiServices, PiSession, PiUi } from '@eratio/pi-effect'
import { Context, Effect, Layer, Ref, Result, Schema, Semaphore } from 'effect'

const TODO_STATE_ENTRY = 'todo'
const TODO_STATUSES = ['pending', 'in_progress', 'completed', 'omitted', 'blocked'] as const
const TODO_ID_PATTERN = /^(?:[0-9a-f]{8}|[0-9a-f]{12})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TodoIdSchema = Schema.String.check(Schema.isPattern(TODO_ID_PATTERN))
const TodoStatusSchema = Schema.Literals(TODO_STATUSES)
const TodoContentSchema: typeof Schema.String = Schema.String
const TodoDataSchema = Schema.Struct({
  id: TodoIdSchema,
  content: TodoContentSchema,
  details: Schema.optionalKey(Schema.String),
  status: TodoStatusSchema,
  dependsOn: Schema.Array(TodoIdSchema),
})
const TodoInputSchema = Schema.Struct({
  content: TodoContentSchema,
  details: Schema.optionalKey(Schema.String),
  dependsOn: Schema.optionalKey(Schema.Array(TodoIdSchema)),
})
const TodoPatchSchema = Schema.Struct({
  content: Schema.optionalKey(TodoContentSchema),
  details: Schema.optionalKey(Schema.NullOr(Schema.String)),
  dependsOn: Schema.optionalKey(Schema.Array(TodoIdSchema)),
})
const TodoShowIdsSchema = Schema.NullOr(Schema.Array(TodoIdSchema))
const TodoShowLimitSchema = Schema.Int.check(
  Schema.isGreaterThan(0, { message: 'Todo show limit must be a positive integer.' }),
)
const TodoShowOptionsSchema = Schema.Struct({
  ids: Schema.optionalKey(TodoShowIdsSchema),
  status: Schema.optionalKey(Schema.Array(TodoStatusSchema)),
  limit: Schema.optionalKey(TodoShowLimitSchema),
  includeDetails: Schema.optionalKey(Schema.Boolean),
})
const TodoListSchema = Schema.Array(TodoDataSchema)
const TodoSessionDataSchema = Schema.Struct({ todos: TodoListSchema })
const TodoSessionEntrySchema = Schema.Struct({
  type: Schema.Literal('custom'),
  customType: Schema.Literal(TODO_STATE_ENTRY),
  data: TodoSessionDataSchema,
})

type TodoId = (typeof TodoIdSchema)['Type']
type TodoStatus = (typeof TodoStatusSchema)['Type']
type Todo = (typeof TodoDataSchema)['Type']
type TodoInput = (typeof TodoInputSchema)['Type']
type TodoPatch = (typeof TodoPatchSchema)['Type']
type TodoShowOptions = (typeof TodoShowOptionsSchema)['Type']

function cloneTodo(todo: Todo): Todo {
  return { ...todo, dependsOn: [...todo.dependsOn] }
}

function cloneTodos(todos: readonly Todo[]): Todo[] {
  return todos.map(cloneTodo)
}

function isTodoId(value: string): value is TodoId {
  return TODO_ID_PATTERN.test(value)
}

function validateTodoContent(content: string): string | undefined {
  return content.trim().length > 0 ? undefined : 'Todo content must contain non-whitespace text.'
}

function validateTodoGraph(todos: readonly Todo[]): string | undefined {
  const ids = new Set<string>()
  let activeCount = 0

  for (const todo of todos) {
    if (!isTodoId(todo.id)) {
      return `Todo graph invalid: task ID is not a UUID: ${todo.id}.`
    }
    if (ids.has(todo.id)) {
      return `Todo graph invalid: duplicate task ID: ${todo.id}.`
    }
    ids.add(todo.id)

    const contentError = validateTodoContent(todo.content)
    if (contentError) {
      return `Todo graph invalid: ${contentError}`
    }
    if (todo.status === 'in_progress') {
      activeCount += 1
    }
  }

  if (activeCount > 1) {
    return 'Todo graph invalid: more than one task is in progress.'
  }

  for (const todo of todos) {
    const dependencies = new Set<string>()
    for (const dependency of todo.dependsOn) {
      if (!ids.has(dependency)) {
        return `Todo graph invalid: task ${todo.id} depends on unknown task ${dependency}.`
      }
      if (dependency === todo.id) {
        return `Todo graph invalid: task ${todo.id} cannot depend on itself.`
      }
      if (dependencies.has(dependency)) {
        return `Todo graph invalid: task ${todo.id} lists dependency ${dependency} more than once.`
      }
      dependencies.add(dependency)
    }
  }

  const byId = new Map(todos.map((todo) => [todo.id, todo]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false

    visiting.add(id)
    const todo = byId.get(id)
    if (todo?.dependsOn.some(visit)) return true
    visiting.delete(id)
    visited.add(id)
    return false
  }

  if (todos.some((todo) => visit(todo.id))) {
    return 'Todo graph invalid: dependencies cannot contain a cycle.'
  }

  return undefined
}

function dependenciesCompleted(todo: Todo, todos: readonly Todo[]): boolean {
  const byId = new Map(todos.map((candidate) => [candidate.id, candidate.status]))
  return todo.dependsOn.every((dependency) => byId.get(dependency) === 'completed')
}

function reevaluateTodoStates(todos: readonly Todo[]): Todo[] {
  return todos.map((todo) => {
    if (todo.status === 'completed' || todo.status === 'omitted') {
      return cloneTodo(todo)
    }

    const status = dependenciesCompleted(todo, todos)
      ? todo.status === 'in_progress'
        ? 'in_progress'
        : 'pending'
      : 'blocked'
    return { ...cloneTodo(todo), status }
  })
}

function getActiveTodo(todos: readonly Todo[]): Todo | undefined {
  const active = todos.find((todo) => todo.status === 'in_progress')
  return active ? cloneTodo(active) : undefined
}

function getNextTodo(todos: readonly Todo[]): Todo | undefined {
  const active = getActiveTodo(todos)
  if (active) return active

  const next = todos.find((todo) => todo.status === 'pending' && dependenciesCompleted(todo, todos))
  return next ? cloneTodo(next) : undefined
}

function isOpenTodo(todo: Todo): boolean {
  return todo.status === 'pending' || todo.status === 'in_progress' || todo.status === 'blocked'
}

type TodoCounts = {
  total: number
  pending: number
  inProgress: number
  blocked: number
  completed: number
  omitted: number
  open: number
  closed: number
}

const StoredTodoSchema = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
  details: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  status: TodoStatusSchema,
  dependsOn: Schema.Array(Schema.String),
})
const StoredTodoListSchema = Schema.Array(StoredTodoSchema)
const StoredTodoSessionEntrySchema = Schema.Struct({
  type: Schema.Literal('custom'),
  customType: Schema.Literal(TODO_STATE_ENTRY),
  data: Schema.Struct({ todos: StoredTodoListSchema }),
})

type StoredTodo = (typeof StoredTodoSchema)['Type']

function todoDescriptionLines(todo: Todo): string[] {
  if (!todo.details) return []
  return todo.details
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function getTodoHandoffSnapshot(todos: readonly Todo[]): Todo[] {
  const openTodos = todos.filter(isOpenTodo).map((todo) => ({ ...todo, dependsOn: [...todo.dependsOn] }))
  const openIds = new Set(openTodos.map((todo) => todo.id))
  return openTodos.map((todo) => ({
    ...todo,
    dependsOn: todo.dependsOn.filter((dependency) => openIds.has(dependency)),
  }))
}

function formatTodoContext(todos: readonly Todo[]): string {
  const next = getNextTodo(todos)
  const counts = getTodoCounts(todos)
  const taskLines = next
    ? [`Current task: "${next.content}"`, ...(next.details ? [`Details: "${next.details}"`] : [])]
    : ['Current task: none']
  return [
    'TODO STATUS',
    '',
    ...taskLines,
    `Tasks: ${counts.open} remaining, ${counts.blocked} blocked, ${counts.completed} complete, ${counts.omitted} omitted.`,
  ].join('\n')
}

function formatTodoReminder(todos: readonly Todo[]): string {
  const next = getNextTodo(todos)
  if (next) {
    return [
      'TODO STATUS: work remains.',
      `Current item: ${next.content}${next.details ? ` — ${next.details}` : ''}`,
      'Continue working on the current item now.',
      'When it is actually complete and verified, call todo to complete the active task; call todo to start the next ready task.',
      'Do not mark future or merely planned work completed.',
    ].join(' ')
  }

  const blocked = todos.filter((todo) => todo.status === 'blocked')
  if (blocked.length > 0) {
    const blockedText = ` Blocked: ${blocked.length} task${blocked.length === 1 ? '' : 's'}.`
    return `TODO STATUS: no task is ready.${blockedText} Use todo to update the task graph.`
  }

  return 'TODO STATUS: all tracked todos are completed or omitted.'
}

function getTodoCounts(todos: readonly Todo[]): TodoCounts {
  const counts: TodoCounts = {
    total: todos.length,
    pending: 0,
    inProgress: 0,
    blocked: 0,
    completed: 0,
    omitted: 0,
    open: 0,
    closed: 0,
  }

  for (const todo of todos) {
    switch (todo.status) {
      case 'pending':
        counts.pending += 1
        counts.open += 1
        break
      case 'in_progress':
        counts.inProgress += 1
        counts.open += 1
        break
      case 'blocked':
        counts.blocked += 1
        counts.open += 1
        break
      case 'completed':
        counts.completed += 1
        counts.closed += 1
        break
      case 'omitted':
        counts.omitted += 1
        counts.closed += 1
        break
    }
  }

  return counts
}

function summarizeTodos(todos: readonly Todo[]): string {
  const counts = getTodoCounts(todos)
  if (counts.total === 0) return 'Cleared todo list.'

  const parts: string[] = []
  if (counts.pending > 0) parts.push(`${counts.pending} pending`)
  if (counts.inProgress > 0) parts.push(`${counts.inProgress} in progress`)
  if (counts.blocked > 0) parts.push(`${counts.blocked} blocked`)
  if (counts.completed > 0) parts.push(`${counts.completed} completed`)
  if (counts.omitted > 0) parts.push(`${counts.omitted} omitted`)
  return `Updated ${counts.total} todo${counts.total === 1 ? '' : 's'}: ${parts.join(', ')}.`
}

function migrateStoredTodo(value: StoredTodo): Todo {
  const details = value.details ?? value.description
  return {
    id: value.id,
    content: value.content,
    status: value.status,
    dependsOn: [...value.dependsOn],
    ...(details === undefined ? {} : { details }),
  }
}

function restoreTodoSnapshot(value: readonly Todo[]): Todo[] | undefined {
  const todos = cloneTodos(value)
  return validateTodoGraph(todos) ? undefined : reevaluateTodoStates(todos)
}

function extractTodoSnapshot(entry: unknown): Todo[] | undefined {
  const result = Schema.decodeUnknownResult(StoredTodoSessionEntrySchema)(entry)
  return Result.isSuccess(result) ? restoreTodoSnapshot(result.success.data.todos.map(migrateStoredTodo)) : undefined
}

function extractLatestTodoSnapshot(entries: readonly unknown[]): Todo[] {
  let latest: Todo[] = []
  for (const entry of entries) {
    latest = extractTodoSnapshot(entry) ?? latest
  }
  return latest
}

class TodoUpdateError extends Schema.TaggedError<TodoUpdateError>()('TodoUpdateError', {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

type TodoStoreState = {
  readonly todos: readonly Todo[]
  readonly suspended: boolean
  readonly wasActiveBeforeSuspend: boolean
}

type TodoTransactionDraft = {
  readonly snapshot: () => readonly Todo[]
  readonly replace: (todos: readonly Todo[]) => void
}

type TodoTransactionResult<A> = { readonly value: A; readonly todos: readonly Todo[]; readonly changed: boolean }

type TodoResumeResult = { resumed: boolean; wasActiveBeforeSuspend: boolean; todos: readonly Todo[] }

function snapshotKey(todos: readonly Todo[]): string {
  return JSON.stringify(todos)
}

class TodoStore extends Context.Service<
  TodoStore,
  {
    readonly snapshot: Effect.Effect<readonly Todo[]>
    readonly restore: (entries: readonly unknown[]) => Effect.Effect<readonly Todo[]>
    readonly replace: (next: readonly Todo[]) => Effect.Effect<readonly Todo[], TodoUpdateError>
    readonly transact: <A, R = never>(
      run: (draft: TodoTransactionDraft, signal: AbortSignal) => Effect.Effect<A, TodoUpdateError, R>,
      signal?: AbortSignal,
    ) => Effect.Effect<TodoTransactionResult<A>, TodoUpdateError, R>
    readonly isSuspended: Effect.Effect<boolean>
    readonly suspend: (wasActiveBeforeSuspend: boolean) => Effect.Effect<boolean>
    readonly resume: Effect.Effect<TodoResumeResult>
  }
>()('todo/TodoStore') {
  static readonly layer = Layer.effect(
    TodoStore,
    Effect.gen(function* () {
      const state = yield* Ref.make<TodoStoreState>({
        todos: [],
        suspended: false,
        wasActiveBeforeSuspend: false,
      })
      const lock = yield* Semaphore.make(1)
      const withLock = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
        Semaphore.withPermit(lock)(effect)

      const snapshot = withLock(Ref.get(state).pipe(Effect.map((value) => cloneTodos(value.todos))))

      const restore = Effect.fnUntraced(function* (
        entries: readonly unknown[],
      ): Effect.fn.Return<readonly Todo[], never> {
        return yield* withLock(
          Effect.gen(function* () {
            const todos = extractLatestTodoSnapshot(entries)
            yield* Ref.update(state, (value) => ({ ...value, todos: cloneTodos(todos) }))
            return cloneTodos(todos)
          }),
        )
      })

      const replace = Effect.fnUntraced(function* (
        next: readonly Todo[],
      ): Effect.fn.Return<readonly Todo[], TodoUpdateError> {
        return yield* withLock(
          Effect.gen(function* () {
            const error = validateTodoGraph(next)
            if (error) return yield* Effect.fail(new TodoUpdateError({ message: error }))
            const todos = cloneTodos(next)
            yield* Ref.update(state, (value) => ({ ...value, todos }))
            return cloneTodos(todos)
          }),
        )
      })

      const transact = Effect.fnUntraced(function* <A, R>(
        run: (draft: TodoTransactionDraft, signal: AbortSignal) => Effect.Effect<A, TodoUpdateError, R>,
        signal?: AbortSignal,
      ): Effect.fn.Return<TodoTransactionResult<A>, TodoUpdateError, R> {
        return yield* withLock(
          Effect.gen(function* () {
            if (signal?.aborted) {
              return yield* Effect.fail(new TodoUpdateError({ message: 'Todo transaction was aborted.' }))
            }

            const before = yield* Ref.get(state).pipe(Effect.map((value) => cloneTodos(value.todos)))
            let draftTodos = cloneTodos(before)
            const draft: TodoTransactionDraft = {
              snapshot: () => cloneTodos(draftTodos),
              replace: (todos: readonly Todo[]) => {
                draftTodos = cloneTodos(todos)
              },
            }
            const controller = new AbortController()
            const abort = (cause: unknown): void => {
              if (!controller.signal.aborted) controller.abort(cause)
            }
            const abortFromCaller = (): void => abort(signal?.reason)
            const cleanup = (): void => signal?.removeEventListener('abort', abortFromCaller)
            signal?.addEventListener('abort', abortFromCaller, { once: true })
            if (signal?.aborted) abortFromCaller()
            const transactionSignal = controller.signal
            const transaction = Effect.try({
              try: () => run(draft, transactionSignal),
              catch: (cause: unknown) =>
                new TodoUpdateError({
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause,
                }),
            }).pipe(
              Effect.flatten,
              Effect.onInterrupt(() => Effect.sync(() => abort(undefined))),
              Effect.ensuring(Effect.sync(cleanup)),
            )
            const value = yield* transaction

            if (signal?.aborted || transactionSignal.aborted) {
              return yield* Effect.fail(new TodoUpdateError({ message: 'Todo transaction was aborted.' }))
            }
            const error = validateTodoGraph(draftTodos)
            if (error) return yield* Effect.fail(new TodoUpdateError({ message: error }))

            const changed = snapshotKey(before) !== snapshotKey(draftTodos)
            if (changed) {
              yield* Ref.update(state, (current) => ({ ...current, todos: cloneTodos(draftTodos) }))
            }
            return { value, todos: cloneTodos(draftTodos), changed }
          }),
        )
      })

      const isSuspended = withLock(Ref.get(state).pipe(Effect.map((value) => value.suspended)))

      const suspend = (wasActiveBeforeSuspend: boolean): Effect.Effect<boolean> =>
        withLock(
          Ref.modify(state, (value) =>
            value.suspended ? [false, value] : [true, { ...value, suspended: true, wasActiveBeforeSuspend }],
          ),
        )

      const resume = withLock(
        Ref.modify(state, (value): readonly [TodoResumeResult, TodoStoreState] => {
          if (!value.suspended) {
            return [{ resumed: false, wasActiveBeforeSuspend: false, todos: cloneTodos(value.todos) }, value]
          }

          return [
            {
              resumed: true,
              wasActiveBeforeSuspend: value.wasActiveBeforeSuspend,
              todos: cloneTodos(value.todos),
            },
            { ...value, suspended: false, wasActiveBeforeSuspend: false },
          ]
        }),
      )

      return TodoStore.of({ snapshot, restore, replace, transact, isSuspended, suspend, resume })
    }),
  )
}

type TodoCompleteResult = {
  readonly completed: Todo
  readonly remaining: {
    readonly pending: number
    readonly inProgress: number
    readonly blocked: number
  }
  readonly allDone: boolean
}

type TodoApi = {
  add(input: TodoInput): Promise<Todo>
  update(id: TodoId, patch: TodoPatch): Promise<Todo>
  show(options?: TodoShowOptions): Promise<readonly Todo[]>
  next(): Promise<Todo>
  complete(): Promise<TodoCompleteResult>
  omit(id: TodoId): Promise<Todo>
  restore(id: TodoId): Promise<Todo>
  clear(): Promise<{ readonly cleared: number }>
}

type TodoMutation = 'added' | 'updated' | 'started' | 'completed' | 'omitted' | 'restored' | 'cleared'
type TodoResult<A> = Result.Result<A, TodoUpdateError>

type TodoApiOptions = {
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

  const complete = (): Promise<TodoCompleteResult> => {
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
    const counts = getTodoCounts(nextResult.success)
    return promiseResult(
      tryTodoApi(() => ({
        completed: cloneTodos([completed.success])[0] as Todo,
        remaining: {
          pending: counts.pending,
          inProgress: counts.inProgress,
          blocked: counts.blocked,
        },
        allDone: counts.open === 0,
      })),
    )
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

  return { add, update, show, next, complete, omit, restore, clear }
}

const PLANNOTATOR_REQUEST_CHANNEL = 'plannotator:request'
const PLANNOTATOR_REQUEST_TIMEOUT_MS = 250
const SUSPENDED_TODO_ERROR = 'Todo tracking is disabled while Plannotator executes the approved plan.'

const PlannotatorPhaseSchema = Schema.Literals(['idle', 'planning', 'executing'])
const PlannotatorStatusResponseSchema = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('handled'),
    result: Schema.Struct({ phase: PlannotatorPhaseSchema }),
  }),
  Schema.Struct({
    status: Schema.Literal('unavailable'),
    error: Schema.optionalKey(Schema.Unknown),
  }),
  Schema.Struct({
    status: Schema.Literal('error'),
    error: Schema.String,
  }),
])

type PlannotatorPhase = (typeof PlannotatorPhaseSchema)['Type']
type PlannotatorStatusResponse = (typeof PlannotatorStatusResponseSchema)['Type']
type PlannotatorStatusRequest = {
  requestId: string
  action: 'plan-mode'
  payload: { mode: 'status' }
  respond: (response: PlannotatorStatusResponse) => void
}

type TodoCompactionEvent = {
  readonly willRetry: boolean
}

type TodoEffectsRequirements = PiServices | TodoStatusRequestVersion | TodoStore | TodoUi

class TodoStatusRequestVersion extends Context.Service<
  TodoStatusRequestVersion,
  { value: Ref.Ref<number>; phaseLock: Semaphore.Semaphore }
>()('todo/StatusRequestVersion') {}

class TodoUiError extends Schema.TaggedError<TodoUiError>()('TodoUiError', {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

function todoHostError(operation: string, cause: unknown): TodoUiError {
  const original =
    typeof cause === 'object' &&
    cause !== null &&
    '_tag' in cause &&
    (cause._tag === 'PiHostError' || cause._tag === 'PiOperationsError') &&
    'cause' in cause
      ? cause.cause
      : cause
  const message =
    original instanceof Error
      ? original.message
      : typeof original === 'object' &&
          original !== null &&
          'message' in original &&
          typeof original.message === 'string'
        ? original.message
        : String(original)
  return new TodoUiError({
    operation,
    message: original instanceof Error ? String(original) : message,
    cause: original,
  })
}

function mapTodoEffect<A, E>(operation: string, effect: Effect.Effect<A, E>): Effect.Effect<A, TodoUiError> {
  return effect.pipe(Effect.mapError((cause) => todoHostError(operation, cause)))
}

class TodoUi extends Context.Service<
  TodoUi,
  {
    readonly update: (
      todos: readonly Todo[],
      suspended?: boolean,
    ) => Effect.Effect<void, TodoUiError, PiContextTag | PiUi>
    readonly show: (todos: readonly Todo[]) => Effect.Effect<void, TodoUiError, PiUi>
  }
>()('todo/TodoUi') {}

function transactTodo<A, R>(
  run: (draft: TodoTransactionDraft, signal: AbortSignal) => Effect.Effect<A, TodoUpdateError, R>,
  signal: AbortSignal | undefined,
  operation: string,
): Effect.Effect<TodoTransactionResult<A>, TodoUiError, TodoEffectsRequirements | R> {
  return Effect.gen(function* () {
    const session = yield* PiSession
    const store = yield* TodoStore
    const ui = yield* TodoUi
    if (yield* store.isSuspended) {
      return yield* Effect.fail(new TodoUiError({ operation, message: SUSPENDED_TODO_ERROR }))
    }

    const before = yield* store.snapshot
    const outcome = yield* Effect.match(store.transact(run, signal), {
      onFailure: (error: TodoUpdateError) => ({ error }),
      onSuccess: (result: TodoTransactionResult<A>) => ({ result }),
    })
    if ('error' in outcome) {
      return yield* Effect.fail(
        new TodoUiError({
          operation,
          message: outcome.error.message,
          cause: outcome.error.cause ?? outcome.error,
        }),
      )
    }

    if (outcome.result.changed) {
      const persisted = yield* Effect.match(
        mapTodoEffect(
          'append-entry',
          session.appendEntry(TODO_STATE_ENTRY, { todos: cloneTodos(outcome.result.todos) }),
        ),
        {
          onFailure: (error: TodoUiError) => ({ error }),
          onSuccess: () => ({ success: true as const }),
        },
      )
      if ('error' in persisted) {
        const rollback = yield* Effect.match(store.replace(before), {
          onFailure: (error: TodoUpdateError) => ({ error }),
          onSuccess: () => ({ success: true as const }),
        })
        if ('error' in rollback) {
          return yield* Effect.fail(
            new TodoUiError({
              operation: `${operation}-rollback`,
              message: rollback.error.message,
              cause: rollback.error,
            }),
          )
        }
        return yield* Effect.fail(persisted.error)
      }
      yield* ui.update(outcome.result.todos)
    }

    return outcome.result
  })
}

const suspendTracking = Effect.fnUntraced(function* (): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const store = yield* TodoStore
  const ui = yield* TodoUi
  yield* store.suspend(false)
  yield* ui.update([], true)
})

const resumeTracking = Effect.fnUntraced(function* (): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const store = yield* TodoStore
  const ui = yield* TodoUi
  const result = yield* store.resume
  if (!result.resumed) return
  yield* ui.update(result.todos)
})

const reconcilePhase = Effect.fnUntraced(function* (
  phase: PlannotatorPhase,
  version: number,
): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const statusRequestVersion = yield* TodoStatusRequestVersion
  yield* Semaphore.withPermit(statusRequestVersion.phaseLock)(
    Effect.gen(function* () {
      if (version !== (yield* Ref.get(statusRequestVersion.value))) return
      if (phase === 'executing') {
        yield* suspendTracking()
        return
      }
      yield* resumeTracking()
    }),
  )
})

const handleResponse = Effect.fnUntraced(function* (
  response: unknown,
  version: number,
): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const result = Schema.decodeUnknownResult(PlannotatorStatusResponseSchema)(response)
  if (Result.isFailure(result) || result.success.status !== 'handled') return
  yield* reconcilePhase(result.success.result.phase, version)
})

const requestPlannotatorPhase = Effect.fn('requestPlannotatorPhase')(function* (): Effect.fn.Return<
  void,
  TodoUiError,
  TodoEffectsRequirements
> {
  const pi = yield* Pi
  const statusRequestVersion = yield* TodoStatusRequestVersion
  const version = yield* Ref.updateAndGet(statusRequestVersion.value, (current) => current + 1)
  let active = true
  let earlyResponse: unknown
  let hasEarlyResponse = false
  let responseResolver: ((response: unknown | undefined) => void) | undefined
  const request: PlannotatorStatusRequest = {
    requestId: randomUUID(),
    action: 'plan-mode',
    payload: { mode: 'status' },
    respond: (response: PlannotatorStatusResponse) => {
      if (!active) return
      if (responseResolver === undefined) {
        earlyResponse = response
        hasEarlyResponse = true
        return
      }
      responseResolver(response)
    },
  }
  const responseEffect = Effect.tryPromise<unknown | undefined, TodoUiError>({
    try: (signal: AbortSignal) =>
      new Promise<unknown | undefined>((resolve) => {
        let settled = false
        let timeout: ReturnType<typeof setTimeout> | undefined
        const cleanup = (): void => {
          if (timeout !== undefined) clearTimeout(timeout)
          signal.removeEventListener('abort', abort)
          responseResolver = undefined
        }
        const finish = (response: unknown | undefined): void => {
          if (settled) return
          settled = true
          active = false
          cleanup()
          resolve(response)
        }
        const abort = (): void => finish(undefined)
        responseResolver = finish
        signal.addEventListener('abort', abort, { once: true })
        if (hasEarlyResponse) finish(earlyResponse)
        else timeout = setTimeout(() => finish(undefined), PLANNOTATOR_REQUEST_TIMEOUT_MS)
      }),
    catch: (cause: unknown) => todoHostError('await-plannotator-response', cause),
  })
  const response = yield* pi.events.emit(PLANNOTATOR_REQUEST_CHANNEL, request).pipe(
    Effect.mapError((cause) => todoHostError('emit-plannotator-request', cause)),
    Effect.flatMap(() => responseEffect),
  )
  if (response !== undefined) yield* handleResponse(response, version)
})

const scheduleSessionPhaseSync = Effect.fnUntraced(function* (): Effect.fn.Return<
  void,
  TodoUiError,
  TodoEffectsRequirements
> {
  return yield* Effect.callback<void, TodoUiError, TodoEffectsRequirements>((resume, signal) => {
    const timeout = setTimeout(() => {
      if (signal.aborted) {
        resume(Effect.void)
        return
      }
      resume(requestPlannotatorPhase())
    }, 0)

    return Effect.sync(() => clearTimeout(timeout))
  })
})

const refreshTodoWidget = Effect.fnUntraced(function* (
  todos: readonly Todo[],
): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const store = yield* TodoStore
  const ui = yield* TodoUi
  const suspended = yield* store.isSuspended
  yield* ui.update(todos, suspended)
})

const restoreFromSession = Effect.fn('restoreFromSession')(function* (): Effect.fn.Return<
  void,
  TodoUiError,
  TodoEffectsRequirements
> {
  const session = yield* PiSession
  const store = yield* TodoStore
  const entries = yield* mapTodoEffect('get-session-branch', session.branch())
  const todos = yield* store.restore(entries)
  yield* refreshTodoWidget(todos)
  yield* scheduleSessionPhaseSync()
})

const carryTodosThroughTreeNavigation = Effect.fn('carryTodosThroughTreeNavigation')(function* (): Effect.fn.Return<
  void,
  TodoUiError,
  TodoEffectsRequirements
> {
  const session = yield* PiSession
  const pi = yield* Pi
  const store = yield* TodoStore
  const todos = yield* store.snapshot
  yield* mapTodoEffect('append-entry', session.appendEntry(TODO_STATE_ENTRY, { todos: cloneTodos(todos) }))
  yield* refreshTodoWidget(todos)
  yield* scheduleSessionPhaseSync()
  const message = {
    customType: 'todo',
    content: formatTodoContext(todos),
    display: false,
  }
  yield* mapTodoEffect('send-message', pi.messages.sendMessage(message, { triggerTurn: false }))
})

const prepareAgentStart = Effect.fn('prepareAgentStart')(function* (): Effect.fn.Return<
  void,
  TodoUiError,
  TodoEffectsRequirements
> {
  const store = yield* TodoStore
  const todos = yield* store.snapshot
  yield* refreshTodoWidget(todos)
  yield* scheduleSessionPhaseSync()
})

const withTodoRun = <A, E, R>(
  operation: string,
  run: (api: TodoApi) => Effect.Effect<A, E, R>,
  signal?: AbortSignal,
): Effect.Effect<A, TodoUiError, TodoEffectsRequirements | R> =>
  Effect.gen(function* () {
    const outcome = yield* transactTodo(
      (draft, transactionSignal) => {
        const api = createTodoApi({ draft, signal: transactionSignal })
        return run(api).pipe(
          Effect.mapError((cause) =>
            cause instanceof TodoUpdateError
              ? cause
              : new TodoUpdateError({ message: cause instanceof Error ? cause.message : String(cause), cause }),
          ),
        )
      },
      signal,
      operation,
    )
    return outcome.value
  })

const clearTodos = Effect.fn('clearTodos')(function* (
  signal?: AbortSignal,
): Effect.fn.Return<number, TodoUiError, TodoEffectsRequirements> {
  const result = yield* withTodoRun(
    'execute',
    (api) => Effect.tryPromise({ try: () => api.clear(), catch: (cause: unknown) => cause }),
    signal,
  )
  return result.cleared
})

const handleAgentEnd = Effect.fnUntraced(function* (): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const store = yield* TodoStore
  if (!(yield* store.isSuspended)) return
  yield* Effect.sleep(0)
  yield* requestPlannotatorPhase()
})

const handleCompaction = Effect.fnUntraced(function* (
  event: TodoCompactionEvent,
): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const context = yield* PiContext
  const pi = yield* Pi
  const session = yield* PiSession
  const store = yield* TodoStore
  if (yield* store.isSuspended) {
    yield* requestPlannotatorPhase()
    if (yield* store.isSuspended) return
  }

  const todos = yield* store.snapshot
  if (todos.length === 0) return

  yield* mapTodoEffect('append-entry', session.appendEntry(TODO_STATE_ENTRY, { todos: cloneTodos(todos) }))
  const message = {
    customType: 'todo',
    content: formatTodoContext(todos),
    display: false,
  }
  if (event.willRetry) {
    yield* mapTodoEffect('send-message', pi.messages.sendMessage(message, { deliverAs: 'steer' }))
  } else if (yield* mapTodoEffect('is-idle', Effect.sync(context.isIdle))) {
    yield* mapTodoEffect('send-message', pi.messages.sendMessage(message, { triggerTurn: false }))
  } else {
    yield* mapTodoEffect('send-message', pi.messages.sendMessage(message, { deliverAs: 'nextTurn' }))
  }
})

const showTodos = Effect.fnUntraced(function* (): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const store = yield* TodoStore
  const ui = yield* TodoUi
  const piUi = yield* PiUi
  yield* requestPlannotatorPhase()
  if (yield* store.isSuspended) {
    yield* mapTodoEffect('notify', piUi.notify(SUSPENDED_TODO_ERROR, 'info'))
    return
  }

  const todos = yield* store.snapshot
  yield* ui.show(todos)
})

const clearTodoWidget = Effect.fnUntraced(function* (): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const ui = yield* TodoUi
  yield* ui.update([], true)
})

class TodoEffects extends Context.Service<
  TodoEffects,
  {
    /** Restores the latest valid todo snapshot when a session runtime starts. */
    readonly restoreFromSession: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    /** Saves the full live todo plan after tree navigation without restoring branch history. */
    readonly carryTodosThroughTreeNavigation: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    /** Refreshes the live todo view and phase without restoring branch history. */
    readonly prepareAgentStart: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    readonly requestPlannotatorPhase: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    readonly withRun: <A, E, R>(
      operation: string,
      run: (api: TodoApi) => Effect.Effect<A, E, R>,
      signal?: AbortSignal,
    ) => Effect.Effect<A, TodoUiError, TodoEffectsRequirements | R>
    readonly clearTodos: (signal?: AbortSignal) => Effect.Effect<number, TodoUiError, TodoEffectsRequirements>
    readonly handleAgentEnd: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    readonly handleCompaction: (event: TodoCompactionEvent) => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    readonly showTodos: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    readonly clearTodoWidget: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
  }
>()('todo/TodoEffects') {}

const TodoEffectsLayer: Layer.Layer<TodoEffects, never, never> = Layer.succeed(
  TodoEffects,
  TodoEffects.of({
    restoreFromSession,
    carryTodosThroughTreeNavigation,
    prepareAgentStart,
    requestPlannotatorPhase,
    withRun: withTodoRun,
    clearTodos,
    handleAgentEnd,
    handleCompaction,
    showTodos,
    clearTodoWidget,
  }),
)

export {
  cloneTodo,
  cloneTodos,
  createTodoApi,
  dependenciesCompleted,
  extractLatestTodoSnapshot,
  formatTodoContext,
  formatTodoReminder,
  getActiveTodo,
  getNextTodo,
  getTodoCounts,
  getTodoHandoffSnapshot,
  isOpenTodo,
  isTodoId,
  reevaluateTodoStates,
  summarizeTodos,
  TODO_ID_PATTERN,
  TODO_STATE_ENTRY,
  TODO_STATUSES,
  type Todo,
  type TodoApi,
  type TodoCompleteResult,
  type TodoCounts,
  TodoDataSchema,
  TodoEffects,
  TodoEffectsLayer,
  type TodoEffectsRequirements,
  type TodoId,
  TodoIdSchema,
  type TodoInput,
  TodoInputSchema,
  TodoListSchema,
  type TodoPatch,
  TodoPatchSchema,
  type TodoResumeResult,
  TodoSessionDataSchema,
  TodoSessionEntrySchema,
  type TodoShowOptions,
  TodoShowOptionsSchema,
  type TodoStatus,
  TodoStatusRequestVersion,
  TodoStatusSchema,
  TodoStore,
  type TodoTransactionDraft,
  type TodoTransactionResult,
  TodoUi,
  TodoUiError,
  TodoUpdateError,
  todoDescriptionLines,
  todoHostError,
  validateTodoContent,
  validateTodoGraph,
}
