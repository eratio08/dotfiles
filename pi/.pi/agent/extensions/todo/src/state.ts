import { Context, Effect, Layer, Ref, Result, Schema } from 'effect'

export const TODO_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const
export const TODO_PRIORITIES = ['high', 'medium', 'low'] as const

export const TodoStatusSchema = Schema.Literals(TODO_STATUSES)
export const TodoPrioritySchema = Schema.Literals(TODO_PRIORITIES)
export const TodoDataSchema = Schema.Struct({
  content: Schema.String,
  status: TodoStatusSchema,
  priority: TodoPrioritySchema,
  description: Schema.optionalKey(Schema.Unknown),
})
export const TodoListSchema = Schema.Array(TodoDataSchema)

type DecodedTodo = (typeof TodoDataSchema)['Type']

export type TodoStatus = (typeof TodoStatusSchema)['Type']
export type TodoPriority = (typeof TodoPrioritySchema)['Type']

export interface Todo {
  content: string
  status: TodoStatus
  priority: TodoPriority
  description?: string
}

export interface TodoCounts {
  total: number
  pending: number
  inProgress: number
  completed: number
  cancelled: number
  open: number
  closed: number
}

const TodoDetailsSchema = Schema.Struct({
  todos: Schema.Unknown,
})

const TodoHandoffEntrySchema = Schema.Struct({
  type: Schema.Literal('custom_message'),
  customType: Schema.Literal('todo'),
  details: TodoDetailsSchema,
})

const TodoToolResultEntrySchema = Schema.Struct({
  type: Schema.Literal('message'),
  message: Schema.Struct({
    role: Schema.Literal('toolResult'),
    toolName: Schema.Literal('todowrite'),
    details: TodoDetailsSchema,
  }),
})

export function validateTodoUpdate(previous: readonly Todo[], next: readonly Todo[]): string | undefined {
  const reject = (message: string) =>
    `${message} Update rejected; no changes were applied. ${formatTodoState(previous)}`

  if (next.length === 0 && previous.some(isOpenTodo)) {
    return reject('Cannot clear the todo list while work remains; complete or cancel each open todo first.')
  }

  if (next.filter((todo) => todo.status === 'in_progress').length > 1) {
    return reject('Cannot have multiple in_progress todos; keep exactly one active todo.')
  }

  if (previous.length > 0 && next.some(isOpenTodo) && !next.some((todo) => todo.status === 'in_progress')) {
    return reject('Open todos remain, but none is in_progress; activate one pending todo before continuing.')
  }

  const newlyCompleted = next.filter((todo) => {
    if (todo.status !== 'completed') return false
    const old = previous.find((candidate) => candidate.content === todo.content)
    return old?.status !== 'completed'
  })
  if (newlyCompleted.length > 1) {
    const items = newlyCompleted.map((todo) => `"${todo.content}"`).join(', ')
    return reject(`Cannot complete multiple todos in one update: ${items}. Complete only the accepted active todo.`)
  }

  for (const todo of newlyCompleted) {
    const old = previous.find((candidate) => candidate.content === todo.content)
    if (!old) {
      return reject(
        `Cannot complete "${todo.content}": it is not in the accepted todo list. Copy its content exactly and activate it in a separate update first.`,
      )
    }
    if (old.status !== 'in_progress') {
      return reject(
        `Cannot complete "${todo.content}": its accepted status is ${old.status}. First change it to in_progress in one update, then complete it in a later update.`,
      )
    }
  }

  return undefined
}

function formatTodoState(todos: readonly Todo[]): string {
  if (todos.length === 0) {
    return 'The accepted todo list is empty.'
  }

  return `Accepted todo state: ${todos.map((todo) => `"${todo.content}"=${todo.status}`).join(', ')}.`
}

export function cloneTodos(todos: readonly Todo[]): Todo[] {
  return todos.map((todo) => ({ ...todo }))
}

function normalizeDecodedTodo(value: DecodedTodo): Todo | undefined {
  const content = value.content.trim()
  if (!content) {
    return undefined
  }

  const description = typeof value.description === 'string' ? value.description.trim() : ''
  if (description) {
    return { content, status: value.status, priority: value.priority, description }
  }
  return { content, status: value.status, priority: value.priority }
}

export function normalizeTodo(value: unknown): Todo | undefined {
  const result = Schema.decodeUnknownResult(TodoDataSchema)(value)
  if (Result.isFailure(result)) {
    return undefined
  }
  return normalizeDecodedTodo(result.success)
}

export function normalizeDecodedTodos(value: readonly DecodedTodo[]): Todo[] | undefined {
  const todos: Todo[] = []
  for (const item of value) {
    const todo = normalizeDecodedTodo(item)
    if (!todo) {
      return undefined
    }
    todos.push(todo)
  }
  return todos
}

export function normalizeTodos(value: unknown): Todo[] | undefined {
  const result = Schema.decodeUnknownResult(TodoListSchema)(value)
  if (Result.isFailure(result)) {
    return undefined
  }
  return normalizeDecodedTodos(result.success)
}

export function todoDescriptionLines(todo: Todo): string[] {
  if (!todo.description) {
    return []
  }
  return todo.description
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export function isOpenTodo(todo: Todo): boolean {
  return todo.status === 'pending' || todo.status === 'in_progress'
}

export function getNextTodo(todos: readonly Todo[]): Todo | undefined {
  return todos.find((todo) => todo.status === 'in_progress') ?? todos.find((todo) => todo.status === 'pending')
}

export function getTodoHandoffSnapshot(todos: readonly Todo[]): Todo[] {
  const openTodos = todos.filter(isOpenTodo).map((todo) => ({ ...todo }))
  if (openTodos.length === 0 || openTodos.some((todo) => todo.status === 'in_progress')) {
    return openTodos
  }

  return openTodos.map((todo, index) => (index === 0 ? { ...todo, status: 'in_progress' as const } : todo))
}

export function formatTodoContext(todos: readonly Todo[]): string {
  const snapshot = todos
    .map(
      (todo) =>
        `- content=${JSON.stringify(todo.content)} status=${todo.status} priority=${todo.priority}${todo.description ? ` description=${JSON.stringify(todo.description)}` : ''}`,
    )
    .join('\n')
  return ['TODO STATUS: authoritative accepted snapshot.', snapshot, formatTodoReminder(todos)].join('\n')
}

export function formatTodoReminder(todos: readonly Todo[]): string {
  const next = getNextTodo(todos)
  if (!next) {
    return 'TODO STATUS: all tracked todos are complete or cancelled.'
  }

  return [
    'TODO STATUS: work remains.',
    `Current item: ${next.content}${next.description ? ` — ${next.description}` : ''}`,
    'Continue working on the current item now.',
    'When it is actually complete and verified, call todowrite immediately: mark only that item completed and activate one pending next item if work remains; otherwise leave all tasks closed.',
    'Do not mark future or merely planned work completed.',
  ].join(' ')
}

export function getTodoCounts(todos: readonly Todo[]): TodoCounts {
  const counts: TodoCounts = {
    total: todos.length,
    pending: 0,
    inProgress: 0,
    completed: 0,
    cancelled: 0,
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
      case 'completed':
        counts.completed += 1
        counts.closed += 1
        break
      case 'cancelled':
        counts.cancelled += 1
        counts.closed += 1
        break
    }
  }

  return counts
}

export function summarizeTodos(todos: readonly Todo[]): string {
  const counts = getTodoCounts(todos)
  if (counts.total === 0) {
    return 'Cleared todo list.'
  }

  const parts: string[] = []
  if (counts.pending > 0) parts.push(`${counts.pending} pending`)
  if (counts.inProgress > 0) parts.push(`${counts.inProgress} in progress`)
  if (counts.completed > 0) parts.push(`${counts.completed} completed`)
  if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`)

  return `Updated ${counts.total} todo${counts.total === 1 ? '' : 's'}: ${parts.join(', ')}.`
}

export function extractLatestTodoSnapshot(entries: readonly unknown[]): Todo[] {
  let latest: Todo[] = []

  for (const entry of entries) {
    const handoff = Schema.decodeUnknownResult(TodoHandoffEntrySchema)(entry)
    if (Result.isSuccess(handoff)) {
      const todos = normalizeTodos(handoff.success.details.todos)
      if (todos) {
        latest = todos
      }
      continue
    }

    const toolResult = Schema.decodeUnknownResult(TodoToolResultEntrySchema)(entry)
    if (Result.isSuccess(toolResult)) {
      const todos = normalizeTodos(toolResult.success.message.details.todos)
      if (todos) {
        latest = todos
      }
    }
  }

  return latest
}

export class TodoUpdateError extends Schema.TaggedError<TodoUpdateError>()('TodoUpdateError', {
  message: Schema.String,
}) {}

interface TodoStoreState {
  readonly todos: readonly Todo[]
  readonly suspended: boolean
  readonly wasActiveBeforeSuspend: boolean
}

export interface TodoResumeResult {
  resumed: boolean
  wasActiveBeforeSuspend: boolean
  todos: readonly Todo[]
}

export class TodoStore extends Context.Service<
  TodoStore,
  {
    readonly snapshot: Effect.Effect<readonly Todo[]>
    readonly restore: (entries: readonly unknown[]) => Effect.Effect<readonly Todo[]>
    readonly replace: (next: readonly Todo[]) => Effect.Effect<readonly Todo[], TodoUpdateError>
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

      const snapshot = Ref.get(state).pipe(Effect.map((value) => cloneTodos(value.todos)))

      const restore = Effect.fnUntraced(function* (entries: readonly unknown[]) {
        const todos = extractLatestTodoSnapshot(entries)
        yield* Ref.update(state, (value) => ({ ...value, todos: cloneTodos(todos) }))
        return cloneTodos(todos)
      })

      const replace = Effect.fnUntraced(function* (next: readonly Todo[]) {
        const result = yield* Ref.modify(
          state,
          (value): readonly [Result.Result<readonly Todo[], TodoUpdateError>, TodoStoreState] => {
            const error = validateTodoUpdate(value.todos, next)
            if (error) {
              return [
                Result.fail(new TodoUpdateError({ message: error })) as Result.Result<readonly Todo[], TodoUpdateError>,
                value,
              ]
            }

            const todos = cloneTodos(next)
            return [Result.succeed(todos) as Result.Result<readonly Todo[], TodoUpdateError>, { ...value, todos }]
          },
        )

        if (Result.isFailure(result)) {
          return yield* Effect.fail(result.failure)
        }
        return cloneTodos(result.success)
      })

      const isSuspended = Ref.get(state).pipe(Effect.map((value) => value.suspended))

      const suspend = Effect.fnUntraced(function* (wasActiveBeforeSuspend: boolean) {
        return yield* Ref.modify(state, (value) =>
          value.suspended ? [false, value] : [true, { ...value, suspended: true, wasActiveBeforeSuspend }],
        )
      })

      const resume: Effect.Effect<TodoResumeResult> = Ref.modify(
        state,
        (value): readonly [TodoResumeResult, TodoStoreState] => {
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
        },
      )

      return TodoStore.of({ snapshot, restore, replace, isSuspended, suspend, resume })
    }),
  )
}
