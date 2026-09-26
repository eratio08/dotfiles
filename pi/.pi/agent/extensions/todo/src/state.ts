import { Result, Schema } from 'effect'
import { TODO_STATE_ENTRY, TODO_STATUSES, type Todo, type TodoStatus, TodoStatusSchema } from './model.ts'
import { cloneTodos, getNextTodo, isOpenTodo, reevaluateTodoStates, validateTodoGraph } from './state-engine.ts'

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

export {
  cloneTodos,
  extractLatestTodoSnapshot,
  formatTodoContext,
  formatTodoReminder,
  getTodoCounts,
  getTodoHandoffSnapshot,
  isOpenTodo,
  summarizeTodos,
  TODO_STATE_ENTRY,
  TODO_STATUSES,
  type Todo,
  type TodoCounts,
  type TodoStatus,
  TodoUpdateError,
  todoDescriptionLines,
}
