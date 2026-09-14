import { randomUUID } from 'node:crypto'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, Result, Schema } from 'effect'
import {
  cloneTodos,
  formatTodoContext,
  formatTodoReminder,
  normalizeDecodedTodos,
  summarizeTodos,
  type Todo,
  TodoListSchema,
  TodoStore,
} from './state.ts'

const TODO_TOOL_NAME = 'todowrite'
const PLANNOTATOR_REQUEST_CHANNEL = 'plannotator:request'
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
type PlannotatorStatusRequest = {
  requestId: string
  action: 'plan-mode'
  payload: { mode: 'status' }
  respond: (response: unknown) => void
}

type TodoCompactionEvent = {
  readonly willRetry: boolean
}

export class TodoContext extends Context.Service<TodoContext, ExtensionContext>()('todo/TodoContext') {}

export class TodoPi extends Context.Service<TodoPi, ExtensionAPI>()('todo/Pi') {}

export class TodoStatusRequestVersion extends Context.Service<TodoStatusRequestVersion, { value: number }>()(
  'todo/StatusRequestVersion',
) {}

export class TodoUiError extends Schema.TaggedError<TodoUiError>()('TodoUiError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

export class TodoUi extends Context.Service<
  TodoUi,
  {
    readonly update: (todos: readonly Todo[], suspended?: boolean) => Effect.Effect<void, TodoUiError>
    readonly show: (todos: readonly Todo[]) => Effect.Effect<void, TodoUiError>
  }
>()('todo/TodoUi') {}

export type TodoToolDetails = {
  todos: Todo[]
  error?: string
}

export type TodoToolResult = {
  content: Array<{ type: 'text'; text: string }>
  details: TodoToolDetails
}

export type TodoEffectsRequirements = TodoContext | TodoPi | TodoStatusRequestVersion | TodoStore | TodoUi

const suspendTracking = Effect.fnUntraced(function* (): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const pi = yield* TodoPi
  const store = yield* TodoStore
  const ui = yield* TodoUi
  const activeTools = yield* Effect.sync(() => pi.getActiveTools())
  const changed = yield* store.suspend(activeTools.includes(TODO_TOOL_NAME))
  if (changed && activeTools.includes(TODO_TOOL_NAME)) {
    yield* Effect.sync(() => pi.setActiveTools(activeTools.filter((toolName) => toolName !== TODO_TOOL_NAME)))
  }
  yield* ui.update([], true)
})

const resumeTracking = Effect.fnUntraced(function* (): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const pi = yield* TodoPi
  const store = yield* TodoStore
  const ui = yield* TodoUi
  const result = yield* store.resume
  if (!result.resumed) {
    return
  }

  if (result.wasActiveBeforeSuspend) {
    const activeTools = yield* Effect.sync(() => pi.getActiveTools())
    if (!activeTools.includes(TODO_TOOL_NAME)) {
      yield* Effect.sync(() => pi.setActiveTools([...activeTools, TODO_TOOL_NAME]))
    }
  }
  yield* ui.update(result.todos)
})

const reconcilePhase = Effect.fnUntraced(function* (
  phase: PlannotatorPhase,
): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  if (phase === 'executing') {
    yield* suspendTracking()
    return
  }
  yield* resumeTracking()
})

const handleResponse = Effect.fnUntraced(function* (
  response: unknown,
): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const result = Schema.decodeUnknownResult(PlannotatorStatusResponseSchema)(response)
  if (Result.isFailure(result) || result.success.status !== 'handled') {
    return
  }
  yield* reconcilePhase(result.success.result.phase)
})

const requestPlannotatorPhase = Effect.fnUntraced(function* (): Effect.fn.Return<
  void,
  TodoUiError,
  TodoEffectsRequirements
> {
  const pi = yield* TodoPi
  const statusRequestVersion = yield* TodoStatusRequestVersion
  return yield* Effect.callback<void, TodoUiError, TodoEffectsRequirements>((resume, signal) => {
    const version = ++statusRequestVersion.value
    let settled = false
    const abort = () => {
      settled = true
      signal.removeEventListener('abort', abort)
    }
    signal.addEventListener('abort', abort, { once: true })

    const finish = (effect: Effect.Effect<void, TodoUiError, TodoEffectsRequirements> = Effect.void): void => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', abort)
      resume(effect)
    }

    const request: PlannotatorStatusRequest = {
      requestId: randomUUID(),
      action: 'plan-mode',
      payload: { mode: 'status' },
      respond: (response) => {
        if (settled || version !== statusRequestVersion.value) {
          finish()
          return
        }
        finish(handleResponse(response))
      },
    }
    if (!signal.aborted) {
      pi.events.emit(PLANNOTATOR_REQUEST_CHANNEL, request)
      queueMicrotask(() => finish())
    }

    return Effect.sync(() => {
      settled = true
      signal.removeEventListener('abort', abort)
    })
  })
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

const syncFromSession = Effect.fnUntraced(function* (): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const ctx = yield* TodoContext
  const store = yield* TodoStore
  const ui = yield* TodoUi
  const entries = yield* Effect.sync(() => ctx.sessionManager.getBranch())
  const todos = yield* store.restore(entries)
  const suspended = yield* store.isSuspended
  yield* ui.update(todos, suspended)
  yield* scheduleSessionPhaseSync()
})

const executeTodo = Effect.fnUntraced(function* (params: {
  todos: unknown[]
}): Effect.fn.Return<TodoToolResult, TodoUiError, TodoEffectsRequirements> {
  const store = yield* TodoStore
  const ui = yield* TodoUi
  const current = yield* store.snapshot
  if (yield* store.isSuspended) {
    return {
      content: [{ type: 'text' as const, text: SUSPENDED_TODO_ERROR }],
      details: { todos: cloneTodos(current), error: SUSPENDED_TODO_ERROR },
    }
  }

  const next = yield* Schema.decodeUnknownEffect(TodoListSchema)(params.todos).pipe(
    Effect.map(normalizeDecodedTodos),
    Effect.catch(() => Effect.succeed(undefined)),
  )
  if (!next) {
    const error = 'invalid todo list'
    return {
      content: [{ type: 'text' as const, text: `Error: ${error}\n${formatTodoReminder(current)}` }],
      details: { todos: cloneTodos(current), error },
    }
  }

  const result = yield* Effect.match(store.replace(next), {
    onFailure: (error) => ({ error: error.message }),
    onSuccess: (accepted) => ({ accepted }),
  })
  if ('error' in result) {
    return {
      content: [{ type: 'text' as const, text: `Error: ${result.error}\n${formatTodoReminder(current)}` }],
      details: { todos: cloneTodos(current), error: result.error },
    }
  }

  yield* ui.update(result.accepted)
  return {
    content: [
      {
        type: 'text' as const,
        text: `${summarizeTodos(result.accepted)}\n${formatTodoReminder(result.accepted)}`,
      },
    ],
    details: { todos: cloneTodos(result.accepted) },
  }
})

const handleAgentEnd = Effect.fnUntraced(function* (): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const store = yield* TodoStore
  if (!(yield* store.isSuspended)) {
    return
  }
  yield* Effect.sleep(0)
  yield* requestPlannotatorPhase()
})

const handleCompaction = Effect.fnUntraced(function* (
  event: TodoCompactionEvent,
): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const ctx = yield* TodoContext
  const pi = yield* TodoPi
  const store = yield* TodoStore
  if (yield* store.isSuspended) {
    yield* requestPlannotatorPhase()
    if (yield* store.isSuspended) {
      return
    }
  }

  const todos = yield* store.snapshot
  if (todos.length === 0) {
    return
  }

  const message = {
    customType: 'todo',
    content: formatTodoContext(todos),
    display: false,
    details: { todos },
  }
  yield* Effect.sync(() => {
    if (event.willRetry) {
      pi.sendMessage(message, { deliverAs: 'steer' })
    } else if (ctx.isIdle()) {
      pi.sendMessage(message, { triggerTurn: false })
    } else {
      pi.sendMessage(message, { deliverAs: 'nextTurn' })
    }
  })
})

const showTodos = Effect.fnUntraced(function* (): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const ctx = yield* TodoContext
  const store = yield* TodoStore
  const ui = yield* TodoUi
  yield* requestPlannotatorPhase()
  if (yield* store.isSuspended) {
    yield* Effect.sync(() => ctx.ui.notify(SUSPENDED_TODO_ERROR, 'info'))
    return
  }

  const todos = yield* store.snapshot
  yield* ui.show(todos)
})

const clearTodoWidget = Effect.fnUntraced(function* (): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const ui = yield* TodoUi
  yield* ui.update([], true)
})

export class TodoEffects extends Context.Service<
  TodoEffects,
  {
    readonly syncFromSession: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    readonly requestPlannotatorPhase: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    readonly executeTodo: (params: {
      todos: unknown[]
    }) => Effect.Effect<TodoToolResult, TodoUiError, TodoEffectsRequirements>
    readonly handleAgentEnd: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    readonly handleCompaction: (event: TodoCompactionEvent) => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    readonly showTodos: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    readonly clearTodoWidget: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
  }
>()('todo/TodoEffects') {}

export const TodoEffectsLayer: Layer.Layer<TodoEffects, never, never> = Layer.succeed(
  TodoEffects,
  TodoEffects.of({
    syncFromSession,
    requestPlannotatorPhase,
    executeTodo,
    handleAgentEnd,
    handleCompaction,
    showTodos,
    clearTodoWidget,
  }),
)
