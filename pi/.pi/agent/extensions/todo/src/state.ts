import { randomUUIDv7 } from 'node:crypto'
import { Result, Schema } from 'effect'

const TODO_STATE_ENTRY = 'todo'
const TODO_STATUSES = ['pending', 'in_progress', 'blocked', 'completed', 'omitted'] as const
const TODO_OPERATIONS = ['replace', 'start_task', 'complete_task', 'omit_task', 'block_task', 'unblock_task'] as const

const TodoStatusSchema = Schema.Literals(TODO_STATUSES)
const TodoInputDataSchema = Schema.Struct({
  content: Schema.String,
  dependsOn: Schema.Array(Schema.String),
  description: Schema.optionalKey(Schema.String),
})
const TodoDataSchema = Schema.Struct({
  id: Schema.String,
  content: Schema.String,
  status: TodoStatusSchema,
  dependsOn: Schema.Array(Schema.String),
  description: Schema.optionalKey(Schema.String),
})
const TodoInputListSchema = Schema.Array(TodoInputDataSchema)
const TodoListSchema = Schema.Array(TodoDataSchema)

type DecodedTodo = (typeof TodoDataSchema)['Type']
type TodoInput = (typeof TodoInputDataSchema)['Type']

type TodoStatus = (typeof TodoStatusSchema)['Type']
type TodoOperation = (typeof TODO_OPERATIONS)[number]
type TodoTaskOperation = Exclude<TodoOperation, 'replace'>
type TodoIdGenerator = () => string

interface Todo {
  id: string
  content: string
  status: TodoStatus
  dependsOn: string[]
  description?: string
}

interface TodoCounts {
  total: number
  pending: number
  inProgress: number
  blocked: number
  completed: number
  omitted: number
  open: number
  closed: number
}

interface TodoNextState {
  status: 'ready' | 'none'
  todo?: Todo
  waiting: Todo[]
  blocked: Todo[]
}

interface TodoTransitionResult {
  todos: Todo[]
  changed: boolean
  error?: string
}

const TodoDetailsSchema = Schema.Struct({
  todos: TodoListSchema,
})

const TodoSessionEntrySchema = Schema.Struct({
  type: Schema.Literal('custom'),
  customType: Schema.Literal(TODO_STATE_ENTRY),
  data: TodoDetailsSchema,
})

function formatTodoState(todos: readonly Todo[]): string {
  if (todos.length === 0) {
    return 'The accepted todo list is empty.'
  }

  return `Accepted todo state: ${todos.map((todo) => `${todo.status}:${JSON.stringify(todo.content)}`).join(', ')}.`
}

function cloneTodos(todos: readonly Todo[]): Todo[] {
  return todos.map((todo) => ({ ...todo, dependsOn: [...todo.dependsOn] }))
}

function createUniqueTodoId(createId: TodoIdGenerator, usedIds: Set<string>): string | undefined {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = createId().trim()
    if (id && !usedIds.has(id)) {
      usedIds.add(id)
      return id
    }
  }
  return undefined
}

function restoreTodo(value: DecodedTodo): Todo | undefined {
  const content = value.content.trim()
  const id = value.id.trim()
  if (!content || !id) {
    return undefined
  }

  const dependsOn = value.dependsOn.map((dependency) => dependency.trim())
  if (dependsOn.some((dependency) => dependency.length === 0)) {
    return undefined
  }

  const description = value.description?.trim() ?? ''
  if (description) {
    return { id, content, status: value.status, dependsOn, description }
  }
  return { id, content, status: value.status, dependsOn }
}

function buildTodoDefinition(
  value: TodoInput,
  previousByContent: ReadonlyMap<string, Todo>,
  createId: TodoIdGenerator,
  usedIds: Set<string>,
): { todo: Todo; dependencyNames: string[] } | undefined {
  const content = value.content.trim()
  if (!content) {
    return undefined
  }

  const previous = previousByContent.get(content)
  const id = previous?.id ?? createUniqueTodoId(createId, usedIds)
  if (!id) {
    return undefined
  }

  const dependencyNames = value.dependsOn.map((dependency) => dependency.trim())
  if (dependencyNames.some((dependency) => dependency.length === 0)) {
    return undefined
  }

  const description = value.description === undefined ? previous?.description : value.description.trim()
  const todo = {
    id,
    content,
    status: previous?.status ?? ('pending' as const),
    dependsOn: [],
    ...(description ? { description } : {}),
  }
  usedIds.add(id)
  return { todo, dependencyNames }
}

function buildTodoList(
  value: readonly TodoInput[],
  previous: readonly Todo[],
  createId: TodoIdGenerator,
): Todo[] | undefined {
  const previousByContent = new Map(previous.map((todo) => [todo.content, todo]))
  const usedIds = new Set(previous.map((todo) => todo.id))
  const definitions: Array<{ todo: Todo; dependencyNames: string[] }> = []
  const contents = new Set<string>()
  for (const item of value) {
    const definition = buildTodoDefinition(item, previousByContent, createId, usedIds)
    if (!definition || contents.has(definition.todo.content)) {
      return undefined
    }
    contents.add(definition.todo.content)
    definitions.push(definition)
  }

  const idsByContent = new Map(definitions.map(({ todo }) => [todo.content, todo.id]))
  const todos: Todo[] = []
  for (const { todo, dependencyNames } of definitions) {
    const dependsOn = dependencyNames.map((dependency) => idsByContent.get(dependency))
    if (dependsOn.some((dependency) => dependency === undefined)) {
      return undefined
    }
    todos.push({ ...todo, dependsOn: dependsOn as string[] })
  }
  return todos
}

function restoreDecodedTodos(value: readonly DecodedTodo[]): Todo[] | undefined {
  const todos = value.map(restoreTodo)
  return todos.every((todo): todo is Todo => todo !== undefined) ? todos : undefined
}

function decodeStoredTodos(value: unknown): Todo[] | undefined {
  const result = Schema.decodeUnknownResult(TodoListSchema)(value)
  return Result.isSuccess(result) ? restoreDecodedTodos(result.success) : undefined
}

function decodeTodoList(value: unknown): Todo[] | undefined {
  const result = Schema.decodeUnknownResult(TodoInputListSchema)(value)
  if (Result.isFailure(result)) {
    return undefined
  }
  return buildTodoList(result.success, [], randomUUIDv7)
}

function buildTodoUpdate(
  value: readonly TodoInput[],
  previous: readonly Todo[],
  createId: TodoIdGenerator = randomUUIDv7,
): Todo[] | undefined {
  return buildTodoList(value, previous, createId)
}

function todoDescriptionLines(todo: Todo): string[] {
  if (!todo.description) {
    return []
  }
  return todo.description
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function isOpenTodo(todo: Todo): boolean {
  return todo.status === 'pending' || todo.status === 'in_progress' || todo.status === 'blocked'
}

function dependenciesSatisfied(todo: Todo, todos: readonly Todo[]): boolean {
  const terminalIds = new Set(
    todos
      .filter((candidate) => candidate.status === 'completed' || candidate.status === 'omitted')
      .map((candidate) => candidate.id),
  )
  return todo.dependsOn.every((dependency) => terminalIds.has(dependency))
}

function getWaitingTodos(todos: readonly Todo[]): Todo[] {
  return todos
    .filter((todo) => todo.status === 'pending' && !dependenciesSatisfied(todo, todos))
    .map((todo) => ({ ...todo, dependsOn: [...todo.dependsOn] }))
}

function uuidV7Timestamp(id: string): string | undefined {
  const compact = id.replaceAll('-', '').toLowerCase()
  if (!/^[0-9a-f]{12}7[0-9a-f]{3}[89ab][0-9a-f]{15}$/.test(compact)) {
    return undefined
  }
  return compact.slice(0, 12)
}

function compareTodoOrder(left: { todo: Todo; index: number }, right: { todo: Todo; index: number }): number {
  const leftTimestamp = uuidV7Timestamp(left.todo.id)
  const rightTimestamp = uuidV7Timestamp(right.todo.id)
  if (leftTimestamp && rightTimestamp) {
    const timestampOrder = leftTimestamp.localeCompare(rightTimestamp)
    if (timestampOrder !== 0) {
      return timestampOrder
    }
    return left.index - right.index
  }

  const idOrder = left.todo.id.localeCompare(right.todo.id)
  return idOrder !== 0 ? idOrder : left.index - right.index
}

function getNextReadyTodo(todos: readonly Todo[]): Todo | undefined {
  const active = todos.find((todo) => todo.status === 'in_progress')
  if (active) {
    return active
  }

  return todos
    .map((todo, index) => ({ todo, index }))
    .filter(({ todo }) => todo.status === 'pending' && dependenciesSatisfied(todo, todos))
    .sort(compareTodoOrder)[0]?.todo
}

function getTodoNextState(todos: readonly Todo[]): TodoNextState {
  const next = getNextReadyTodo(todos)
  const waiting = getWaitingTodos(todos)
  const blocked = todos
    .filter((todo) => todo.status === 'blocked')
    .map((todo) => ({ ...todo, dependsOn: [...todo.dependsOn] }))
  if (next) {
    return { status: 'ready', todo: { ...next, dependsOn: [...next.dependsOn] }, waiting, blocked }
  }
  return { status: 'none', waiting, blocked }
}

function applyTodoOperation(todos: readonly Todo[], operation: TodoTaskOperation): TodoTransitionResult {
  const active = todos.find((todo) => todo.status === 'in_progress')
  if (operation === 'start_task') {
    const next = getNextReadyTodo(todos)
    if (!next || next.status === 'in_progress') {
      return { todos: cloneTodos(todos), changed: false }
    }
    return {
      todos: todos.map((todo) =>
        todo.id === next.id ? { ...todo, status: 'in_progress' as const } : { ...todo, dependsOn: [...todo.dependsOn] },
      ),
      changed: true,
    }
  }

  if (operation === 'unblock_task') {
    const blocked = todos.find((todo) => todo.status === 'blocked')
    if (!blocked) {
      return { todos: cloneTodos(todos), changed: false, error: 'No blocked task is available to unblock.' }
    }
    return {
      todos: todos.map((todo) =>
        todo.id === blocked.id ? { ...todo, status: 'pending' as const } : { ...todo, dependsOn: [...todo.dependsOn] },
      ),
      changed: true,
    }
  }

  if (!active) {
    return { todos: cloneTodos(todos), changed: false, error: 'No active task is available for this operation.' }
  }

  let status: TodoStatus
  switch (operation) {
    case 'complete_task':
      status = 'completed'
      break
    case 'omit_task':
      status = 'omitted'
      break
    case 'block_task':
      status = 'blocked'
      break
    default:
      return { todos: cloneTodos(todos), changed: false, error: `Unsupported todo operation: ${operation}` }
  }
  return {
    todos: todos.map((todo) =>
      todo.id === active.id ? { ...todo, status } : { ...todo, dependsOn: [...todo.dependsOn] },
    ),
    changed: true,
  }
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
  const openTodos = todos.filter(isOpenTodo)
  const first = openTodos[0]
  if (!first) {
    return 'TODO STATUS: all tracked todos are completed or omitted.'
  }

  const remaining = openTodos.length - 1
  const snapshot = `- content=${JSON.stringify(first.content)} status=${first.status}${first.description ? ` description=${JSON.stringify(first.description)}` : ''}`
  const continuation =
    remaining === 0
      ? 'No open tasks remain after this one.'
      : `${remaining} more open task${remaining === 1 ? '' : 's'} remain after this one. After completing this task, use the todonext tool to start the next task.`
  return ['TODO STATUS: authoritative accepted snapshot.', snapshot, continuation].join('\n')
}

function formatTodoReminder(todos: readonly Todo[]): string {
  const next = getNextReadyTodo(todos)
  if (next) {
    return [
      'TODO STATUS: work remains.',
      `Current item: ${next.content}${next.description ? ` — ${next.description}` : ''}`,
      'Continue working on the current item now.',
      'When it is actually complete and verified, call todowrite with operation complete_task; use todonext to start the next ready task.',
      'Do not mark future or merely planned work completed.',
    ].join(' ')
  }

  const waiting = getWaitingTodos(todos)
  const blocked = todos.filter((todo) => todo.status === 'blocked')
  if (waiting.length > 0 || blocked.length > 0) {
    const waitingText = waiting.length > 0 ? ` Waiting: ${waiting.map((todo) => todo.content).join(', ')}.` : ''
    const blockedText = blocked.length > 0 ? ` Blocked: ${blocked.map((todo) => todo.content).join(', ')}.` : ''
    return `TODO STATUS: no task is ready.${waitingText}${blockedText} Use todowrite to apply a task operation when the next task is ready.`
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
  if (counts.total === 0) {
    return 'Cleared todo list.'
  }

  const parts: string[] = []
  if (counts.pending > 0) parts.push(`${counts.pending} pending`)
  if (counts.inProgress > 0) parts.push(`${counts.inProgress} in progress`)
  if (counts.blocked > 0) parts.push(`${counts.blocked} blocked`)
  if (counts.completed > 0) parts.push(`${counts.completed} completed`)
  if (counts.omitted > 0) parts.push(`${counts.omitted} omitted`)

  return `Updated ${counts.total} todo${counts.total === 1 ? '' : 's'}: ${parts.join(', ')}.`
}

function validateTodoStructure(todos: readonly Todo[]): string | undefined {
  const ids = new Set<string>()
  for (const todo of todos) {
    if (!todo.id.trim()) {
      return 'Every todo must have a non-empty id.'
    }
    if (ids.has(todo.id)) {
      return `Todo ids must be unique; duplicate id: ${todo.id}.`
    }
    ids.add(todo.id)
  }

  for (const todo of todos) {
    const dependencies = new Set<string>()
    for (const dependency of todo.dependsOn) {
      if (!ids.has(dependency)) {
        return `Todo "${todo.content}" depends on unknown id ${dependency}.`
      }
      if (dependency === todo.id) {
        return `Todo "${todo.content}" cannot depend on itself.`
      }
      if (dependencies.has(dependency)) {
        return `Todo "${todo.content}" lists dependency ${dependency} more than once.`
      }
      dependencies.add(dependency)
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const byId = new Map(todos.map((todo) => [todo.id, todo]))
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
    return 'Todo dependencies cannot contain a cycle.'
  }

  return undefined
}

function validateTodoUpdate(previous: readonly Todo[], next: readonly Todo[]): string | undefined {
  const reject = (message: string) =>
    `${message} Update rejected; no changes were applied. ${formatTodoState(previous)}`

  const structureError = validateTodoStructure(next)
  if (structureError) {
    return reject(structureError)
  }

  if (next.length === 0 && previous.some(isOpenTodo)) {
    return reject('Cannot clear the todo list while work remains; complete or omit each open todo first.')
  }

  if (next.filter((todo) => todo.status === 'in_progress').length > 1) {
    return reject('Cannot have multiple in_progress todos; keep at most one active todo.')
  }

  const previousById = new Map(previous.map((todo) => [todo.id, todo]))
  for (const previousTodo of previous) {
    if (isOpenTodo(previousTodo) && !next.some((todo) => todo.id === previousTodo.id)) {
      return reject(`Cannot remove open todo "${previousTodo.content}".`)
    }
  }

  for (const todo of next) {
    const previousTodo = previousById.get(todo.id)
    if (!previousTodo && todo.status !== 'pending') {
      return reject(`New todo "${todo.content}" must start in pending state.`)
    }
    if (previousTodo && previousTodo.status !== todo.status) {
      return reject(`Use a todo operation to change the state of "${todo.content}".`)
    }
  }

  return undefined
}

function restoreTodoSnapshot(value: readonly DecodedTodo[]): Todo[] | undefined {
  const todos = restoreDecodedTodos(value)
  return todos && !validateTodoStructure(todos) ? todos : undefined
}

function extractTodoSnapshot(entry: unknown): Todo[] | undefined {
  const sessionEntry = Schema.decodeUnknownResult(TodoSessionEntrySchema)(entry)
  return Result.isSuccess(sessionEntry) ? restoreTodoSnapshot(sessionEntry.success.data.todos) : undefined
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
}) {}

export {
  applyTodoOperation,
  buildTodoUpdate,
  cloneTodos,
  decodeStoredTodos,
  decodeTodoList,
  extractLatestTodoSnapshot,
  formatTodoContext,
  formatTodoReminder,
  getNextReadyTodo,
  getTodoCounts,
  getTodoHandoffSnapshot,
  getTodoNextState,
  getWaitingTodos,
  isOpenTodo,
  summarizeTodos,
  TODO_OPERATIONS,
  TODO_STATE_ENTRY,
  TODO_STATUSES,
  type Todo,
  type TodoCounts,
  TodoDataSchema,
  type TodoIdGenerator,
  type TodoInput,
  TodoInputListSchema,
  TodoListSchema,
  type TodoNextState,
  type TodoOperation,
  type TodoStatus,
  TodoStatusSchema,
  type TodoTaskOperation,
  type TodoTransitionResult,
  TodoUpdateError,
  todoDescriptionLines,
  validateTodoUpdate,
}
