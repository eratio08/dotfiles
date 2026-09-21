import { TODO_ID_PATTERN, type Todo, type TodoId } from './model.ts'

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

export {
  cloneTodo,
  cloneTodos,
  dependenciesCompleted,
  getActiveTodo,
  getNextTodo,
  isOpenTodo,
  isTodoId,
  reevaluateTodoStates,
  validateTodoContent,
  validateTodoGraph,
}
