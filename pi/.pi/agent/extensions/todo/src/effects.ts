import { randomUUID } from 'node:crypto'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, Result, Schema, Semaphore } from 'effect'
import { createTodoApi } from './api.ts'
import { evaluateTodoCode, formatTodoCodeOutput, type TodoCodeDetails } from './evaluator.ts'
import { cloneTodos, formatTodoContext, TODO_STATE_ENTRY, type Todo, TodoUpdateError } from './state.ts'
import { TodoStore } from './store.ts'

const TODO_TOOL_NAME = 'todo'
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

type TodoProgramParams = {
  code: string
}

type TodoOperationSummary = {
  readonly added: number
  readonly updated: number
  readonly started: number
  readonly completed: number
  readonly omitted: number
  readonly restored: number
  readonly cleared: number
}

type TodoToolDetails = TodoCodeDetails & {
  readonly summary?: TodoOperationSummary
  readonly code?: string
  readonly codeTruncated?: boolean
  todos: Todo[]
}

type TodoOperationSummaryCollector = {
  readonly record: (operation: keyof TodoOperationSummary, count?: number) => void
  readonly snapshot: () => TodoOperationSummary
}

function createTodoOperationSummary(): TodoOperationSummaryCollector {
  const summary = {
    added: 0,
    updated: 0,
    started: 0,
    completed: 0,
    omitted: 0,
    restored: 0,
    cleared: 0,
  }
  const record = (operation: keyof TodoOperationSummary, count = 1): void => {
    summary[operation] += count
  }
  return { record, snapshot: () => ({ ...summary }) }
}

type TodoToolResult = {
  content: Array<{ type: 'text'; text: string }>
  details: TodoToolDetails
}

type TodoEffectsRequirements = TodoContext | TodoPi | TodoStatusRequestVersion | TodoStore | TodoUi

class TodoContext extends Context.Service<TodoContext, ExtensionContext>()('todo/TodoContext') {}

class TodoPi extends Context.Service<TodoPi, ExtensionAPI>()('todo/Pi') {}

class TodoStatusRequestVersion extends Context.Service<
  TodoStatusRequestVersion,
  { value: number; phaseLock: Semaphore.Semaphore }
>()('todo/StatusRequestVersion') {}

class TodoUiError extends Schema.TaggedError<TodoUiError>()('TodoUiError', {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

function todoHostError(operation: string, cause: unknown): TodoUiError {
  const message =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'object' && cause !== null && 'message' in cause && typeof cause.message === 'string'
        ? cause.message
        : String(cause)
  return new TodoUiError({ operation, message, cause })
}

function tryTodoHost<A>(operation: string, run: () => A): Effect.Effect<A, TodoUiError> {
  return Effect.try({
    try: run,
    catch: (cause) => todoHostError(operation, cause),
  })
}

class TodoUi extends Context.Service<
  TodoUi,
  {
    readonly update: (todos: readonly Todo[], suspended?: boolean) => Effect.Effect<void, TodoUiError>
    readonly show: (todos: readonly Todo[]) => Effect.Effect<void, TodoUiError>
  }
>()('todo/TodoUi') {}

const suspendTracking = Effect.fnUntraced(function* (): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const pi = yield* TodoPi
  const store = yield* TodoStore
  const ui = yield* TodoUi
  const activeTools = yield* tryTodoHost('get-active-tools', () => pi.getActiveTools())
  const wasActiveBeforeSuspend = activeTools.includes(TODO_TOOL_NAME)
  const changed = yield* store.suspend(wasActiveBeforeSuspend)
  if (changed && wasActiveBeforeSuspend) {
    const updated = yield* Effect.match(
      tryTodoHost('set-active-tools', () =>
        pi.setActiveTools(activeTools.filter((toolName) => toolName !== TODO_TOOL_NAME)),
      ),
      {
        onFailure: (error) => ({ error }),
        onSuccess: () => ({ success: true as const }),
      },
    )
    if ('error' in updated) {
      yield* store.resume
      return yield* Effect.fail(updated.error)
    }
  }
  yield* ui.update([], true)
})

const resumeTracking = Effect.fnUntraced(function* (): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const pi = yield* TodoPi
  const store = yield* TodoStore
  const ui = yield* TodoUi
  const result = yield* store.resume
  if (!result.resumed) return

  if (result.wasActiveBeforeSuspend) {
    const activeTools = yield* tryTodoHost('get-active-tools', () => pi.getActiveTools())
    if (!activeTools.includes(TODO_TOOL_NAME)) {
      const updated = yield* Effect.match(
        tryTodoHost('set-active-tools', () => pi.setActiveTools([...activeTools, TODO_TOOL_NAME])),
        {
          onFailure: (error) => ({ error }),
          onSuccess: () => ({ success: true as const }),
        },
      )
      if ('error' in updated) {
        yield* store.suspend(result.wasActiveBeforeSuspend)
        return yield* Effect.fail(updated.error)
      }
    }
  }
  yield* ui.update(result.todos)
})

const reconcilePhase = Effect.fnUntraced(function* (
  phase: PlannotatorPhase,
  version: number,
): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const statusRequestVersion = yield* TodoStatusRequestVersion
  yield* Semaphore.withPermit(statusRequestVersion.phaseLock)(
    Effect.gen(function* () {
      if (version !== statusRequestVersion.value) return
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
    let timeout: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => {
      if (timeout !== undefined) clearTimeout(timeout)
      signal.removeEventListener('abort', abort)
    }
    const abort = (): void => {
      settled = true
      cleanup()
    }
    const finish = (effect: Effect.Effect<void, TodoUiError, TodoEffectsRequirements> = Effect.void): void => {
      if (settled) return
      settled = true
      cleanup()
      resume(effect)
    }
    signal.addEventListener('abort', abort, { once: true })

    const request: PlannotatorStatusRequest = {
      requestId: randomUUID(),
      action: 'plan-mode',
      payload: { mode: 'status' },
      respond: (response) => {
        if (settled || version !== statusRequestVersion.value) {
          finish()
          return
        }
        finish(handleResponse(response, version))
      },
    }
    if (!signal.aborted) {
      timeout = setTimeout(() => finish(), PLANNOTATOR_REQUEST_TIMEOUT_MS)
      try {
        pi.events.emit(PLANNOTATOR_REQUEST_CHANNEL, request)
      } catch (cause) {
        finish(Effect.fail(todoHostError('emit-plannotator-request', cause)))
      }
    }

    return Effect.sync(() => {
      settled = true
      cleanup()
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

const syncFromSession = Effect.fnUntraced(function* (
  preserveOpenTasks = false,
): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const ctx = yield* TodoContext
  const pi = yield* TodoPi
  const store = yield* TodoStore
  const ui = yield* TodoUi
  const previous = preserveOpenTasks ? yield* store.snapshot : []
  const entries = yield* tryTodoHost('get-session-branch', () => ctx.sessionManager.getBranch())
  const restored = yield* store.restore(entries)
  const hasSnapshot = entries.some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as { customType?: unknown }).customType === TODO_STATE_ENTRY,
  )
  const restoredPlanIsSubset =
    !hasSnapshot ||
    (restored.length > 0 && restored.every((todo) => previous.some((candidate) => candidate.id === todo.id)))
  const carried = preserveOpenTasks && previous.length > 0 && restoredPlanIsSubset ? previous : []
  let todos = restored
  if (carried.length > 0) {
    const replacement = yield* Effect.match(store.replace(carried), {
      onFailure: (error) => ({ error }),
      onSuccess: (value) => ({ value }),
    })
    if ('error' in replacement) {
      return yield* Effect.fail(
        new TodoUiError({ operation: 'restore', message: replacement.error.message, cause: replacement.error }),
      )
    }
    todos = replacement.value
  }
  if (carried.length > 0) {
    const message = {
      customType: 'todo',
      content: formatTodoContext(carried),
      display: false,
      details: { todos: cloneTodos(carried) },
    }
    const persisted = yield* Effect.match(
      tryTodoHost('append-entry', () => pi.appendEntry(TODO_STATE_ENTRY, { todos: cloneTodos(carried) })),
      {
        onFailure: (error) => ({ error }),
        onSuccess: () => ({ success: true as const }),
      },
    )
    if ('error' in persisted) {
      const rollback = yield* Effect.match(store.replace(restored), {
        onFailure: (error) => ({ error }),
        onSuccess: () => ({ success: true as const }),
      })
      if ('error' in rollback) {
        return yield* Effect.fail(
          new TodoUiError({ operation: 'restore-rollback', message: rollback.error.message, cause: rollback.error }),
        )
      }
      return yield* Effect.fail(persisted.error)
    }
    yield* tryTodoHost('send-message', () => pi.sendMessage(message, { triggerTurn: false }))
  }
  const suspended = yield* store.isSuspended
  yield* ui.update(todos, suspended)
  yield* scheduleSessionPhaseSync()
})

const executeTodo = Effect.fnUntraced(function* (
  params: TodoProgramParams,
): Effect.fn.Return<TodoToolResult, TodoUiError, TodoEffectsRequirements> {
  const ctx = yield* TodoContext
  const pi = yield* TodoPi
  const store = yield* TodoStore
  const ui = yield* TodoUi
  if (yield* store.isSuspended) {
    return yield* Effect.fail(new TodoUiError({ operation: 'execute', message: SUSPENDED_TODO_ERROR }))
  }

  const before = yield* store.snapshot
  const collector = createTodoOperationSummary()
  const outcome = yield* Effect.match(
    store.transact((draft, signal) => {
      const api = createTodoApi({ draft, signal, onMutation: collector.record })
      return evaluateTodoCode(params.code, api, ctx.cwd, signal).pipe(
        Effect.map(formatTodoCodeOutput),
        Effect.mapError((error) => new TodoUpdateError({ message: error.message, cause: error })),
      )
    }),
    {
      onFailure: (error) => ({ error }),
      onSuccess: (result) => ({ result }),
    },
  )
  if ('error' in outcome) {
    return yield* Effect.fail(
      new TodoUiError({
        operation: 'execute',
        message: outcome.error.message,
        cause: outcome.error.cause ?? outcome.error,
      }),
    )
  }

  const submittedCode = formatTodoCodeOutput(params.code, 'Code')
  if (outcome.result.changed) {
    const persisted = yield* Effect.match(
      tryTodoHost('append-entry', () => pi.appendEntry(TODO_STATE_ENTRY, { todos: cloneTodos(outcome.result.todos) })),
      {
        onFailure: (error) => ({ error }),
        onSuccess: () => ({ success: true as const }),
      },
    )
    if ('error' in persisted) {
      const rollback = yield* Effect.match(store.replace(before), {
        onFailure: (error) => ({ error }),
        onSuccess: () => ({ success: true as const }),
      })
      if ('error' in rollback) {
        return yield* Effect.fail(
          new TodoUiError({ operation: 'execute-rollback', message: rollback.error.message, cause: rollback.error }),
        )
      }
      return yield* Effect.fail(persisted.error)
    }
    yield* ui.update(outcome.result.todos)
  }
  return {
    content: [{ type: 'text', text: outcome.result.value.output }],
    details: {
      output: outcome.result.value.output,
      truncated: outcome.result.value.truncated,
      summary: collector.snapshot(),
      code: submittedCode.output,
      codeTruncated: submittedCode.truncated,
      todos: cloneTodos(outcome.result.todos),
    },
  }
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
  const ctx = yield* TodoContext
  const pi = yield* TodoPi
  const store = yield* TodoStore
  if (yield* store.isSuspended) {
    yield* requestPlannotatorPhase()
    if (yield* store.isSuspended) return
  }

  const todos = yield* store.snapshot
  if (todos.length === 0) return

  yield* tryTodoHost('append-entry', () => pi.appendEntry(TODO_STATE_ENTRY, { todos: cloneTodos(todos) }))
  const message = {
    customType: 'todo',
    content: formatTodoContext(todos),
    display: false,
    details: { todos: cloneTodos(todos) },
  }
  if (event.willRetry) {
    yield* tryTodoHost('send-message', () => pi.sendMessage(message, { deliverAs: 'steer' }))
  } else if (yield* tryTodoHost('is-idle', () => ctx.isIdle())) {
    yield* tryTodoHost('send-message', () => pi.sendMessage(message, { triggerTurn: false }))
  } else {
    yield* tryTodoHost('send-message', () => pi.sendMessage(message, { deliverAs: 'nextTurn' }))
  }
})

const showTodos = Effect.fnUntraced(function* (): Effect.fn.Return<void, TodoUiError, TodoEffectsRequirements> {
  const ctx = yield* TodoContext
  const store = yield* TodoStore
  const ui = yield* TodoUi
  yield* requestPlannotatorPhase()
  if (yield* store.isSuspended) {
    yield* tryTodoHost('notify', () => ctx.ui.notify(SUSPENDED_TODO_ERROR, 'info'))
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
    readonly syncFromSession: (preserveOpenTasks?: boolean) => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    readonly requestPlannotatorPhase: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    readonly executeTodo: (
      params: TodoProgramParams,
    ) => Effect.Effect<TodoToolResult, TodoUiError, TodoEffectsRequirements>
    readonly handleAgentEnd: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    readonly handleCompaction: (event: TodoCompactionEvent) => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    readonly showTodos: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
    readonly clearTodoWidget: () => Effect.Effect<void, TodoUiError, TodoEffectsRequirements>
  }
>()('todo/TodoEffects') {}

const TodoEffectsLayer: Layer.Layer<TodoEffects, never, never> = Layer.succeed(
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

export {
  TodoContext,
  TodoEffects,
  TodoEffectsLayer,
  type TodoEffectsRequirements,
  TodoPi,
  type TodoProgramParams,
  TodoStatusRequestVersion,
  type TodoToolDetails,
  type TodoToolResult,
  TodoUi,
  TodoUiError,
}
