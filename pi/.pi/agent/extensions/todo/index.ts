import { truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
import {
  createTool,
  defineMethod,
  Pi,
  PiContext,
  PiExtension,
  type PiTheme,
  type PiTui,
  PiUi,
  type ToolDefinition,
} from '@eratio/pi-effect-codemode'
import { Effect, Layer, Ref, Result, Schema, Semaphore } from 'effect'
import { Type } from 'typebox'
import { TODO_CODE_EXAMPLE, TODO_CODE_TYPES, TODO_PROMPT } from './src/code-mode.ts'
import {
  TodoEffects,
  TodoEffectsLayer,
  type TodoRunContext,
  TodoStatusRequestVersion,
  TodoUi,
  TodoUiError,
  todoHostError,
} from './src/effects.ts'
import {
  TODO_ID_PATTERN,
  TODO_STATUSES,
  type TodoId,
  type TodoInput,
  type TodoPatch,
  type TodoShowOptions,
} from './src/model.ts'
import { getTodoCounts, isOpenTodo, type Todo, type TodoStatus, todoDescriptionLines } from './src/state.ts'
import { TodoStore } from './src/store.ts'

const PLAN_SUBMIT_TOOL_NAME = 'plannotator_submit_plan'
const decodeApprovedPlanSubmissionDetails = Schema.decodeUnknownResult(
  Schema.Struct({ approved: Schema.Literal(true) }),
)
type TodoServices = TodoEffects | TodoStore | TodoStatusRequestVersion | TodoUi
type TodoToolErrorCodec = NonNullable<ToolDefinition<TodoServices, TodoUiError, TodoRunContext>['errorCodec']>
type TodoToolFailure = Parameters<TodoToolErrorCodec['encode']>[0]
type TodoToolRun = NonNullable<ToolDefinition<TodoServices, TodoUiError, TodoRunContext>['withRun']>
type TodoPluginRegistrations = Parameters<
  NonNullable<Parameters<typeof PiExtension.define<TodoServices, TodoToolFailure>>[0]['effect']>
>[0]

const todoIdParameter = Type.String({ pattern: TODO_ID_PATTERN.source })
const todoStatusParameter = Type.Union(TODO_STATUSES.map((status) => Type.Literal(status)))
const addTodoParameters = Type.Object({
  content: Type.String(),
  details: Type.Optional(Type.String()),
  dependsOn: Type.Optional(Type.Array(todoIdParameter)),
})
const updateTodoParameters = Type.Tuple([
  todoIdParameter,
  Type.Object({
    content: Type.Optional(Type.String()),
    details: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    dependsOn: Type.Optional(Type.Array(todoIdParameter)),
  }),
])
const showTodoParameters = Type.Object({
  ids: Type.Optional(Type.Union([Type.Array(todoIdParameter), Type.Null()])),
  status: Type.Optional(Type.Array(todoStatusParameter)),
  limit: Type.Optional(Type.Integer({ minimum: 1 })),
  includeDetails: Type.Optional(Type.Boolean()),
})
const todoToolErrorWireSchema = Schema.Struct({
  _tag: Schema.String,
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.String),
})
const todoToolErrorCodec: TodoToolErrorCodec = {
  encode: (error: TodoToolFailure) => ({
    _tag: error._tag,
    operation: error.operation,
    message: error.message,
    ...(error.cause === undefined
      ? {}
      : { cause: error.cause instanceof Error ? error.cause.message : String(error.cause) }),
  }),
  decode: (value: unknown) => {
    const result = Schema.decodeUnknownResult(todoToolErrorWireSchema)(value)
    if (Result.isFailure(result)) throw new TypeError('The Todo tool error payload is invalid.')
    return new TodoUiError({
      operation: result.success.operation,
      message: result.success.message,
      ...(result.success.cause === undefined ? {} : { cause: result.success.cause }),
    })
  },
}

function runTodoApiOperation<A>(operation: string, run: () => Promise<A>): Effect.Effect<A, TodoUiError> {
  return Effect.tryPromise({
    try: run,
    catch: (cause: unknown) => todoHostError(operation, cause),
  })
}

function isApprovedPlanSubmission(event: {
  readonly toolName: string
  readonly isError?: boolean
  readonly details?: unknown
}): boolean {
  if (event.toolName !== PLAN_SUBMIT_TOOL_NAME || event.isError) return false
  return Result.isSuccess(decodeApprovedPlanSubmissionDetails(event.details))
}

type TodoCancelKeybindings = {
  matches(data: string, keybinding: 'tui.select.cancel'): boolean
  getKeys(keybinding: 'tui.select.cancel'): string[]
}

class TodoViewer {
  private cachedWidth?: number
  private cachedLines?: string[]
  private readonly todos: readonly Todo[]
  private readonly theme: PiTheme
  private readonly keybindings: TodoCancelKeybindings
  private readonly onClose: () => void

  constructor(todos: readonly Todo[], theme: PiTheme, keybindings: TodoCancelKeybindings, onClose: () => void) {
    this.todos = todos
    this.theme = theme
    this.keybindings = keybindings
    this.onClose = onClose
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, 'tui.select.cancel')) this.onClose()
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines

    const counts = getTodoCounts(this.todos)
    const lines: string[] = []
    const header = `${this.theme.fg('accent', ' Todos ')}${this.theme.fg('dim', ` ${formatCounts(counts)}`)}`
    lines.push('', truncateToWidth(header, width), '')

    if (this.todos.length === 0) {
      lines.push(truncateToWidth(`  ${this.theme.fg('dim', 'No todos')}`, width))
    } else {
      const depths = getTodoDepths(this.todos)
      for (const todo of this.todos) {
        lines.push(truncateToWidth(`  ${renderTodoLine(todo, this.theme, depths.get(todo.id) ?? 0)}`, width))
      }
    }

    const cancelKeys = this.keybindings.getKeys('tui.select.cancel')
    if (cancelKeys.length > 0) {
      const closeHint = `Press ${cancelKeys.join(' or ')} to close`
      lines.push('', truncateToWidth(`  ${this.theme.fg('dim', closeHint)}`, width), '')
    }
    this.cachedWidth = width
    this.cachedLines = lines
    return lines
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cachedLines = undefined
  }
}

function formatCounts(counts: ReturnType<typeof getTodoCounts>): string {
  const parts: string[] = []
  if (counts.pending > 0) parts.push(`${counts.pending} pending`)
  if (counts.inProgress > 0) parts.push(`${counts.inProgress} active`)
  if (counts.blocked > 0) parts.push(`${counts.blocked} blocked`)
  if (counts.completed > 0) parts.push(`${counts.completed} done`)
  if (counts.omitted > 0) parts.push(`${counts.omitted} omitted`)
  return parts.join(' • ') || 'empty'
}

function renderMarker(status: TodoStatus, theme: PiTheme): string {
  switch (status) {
    case 'pending':
      return theme.fg('dim', '[ ]')
    case 'in_progress':
      return theme.fg('accent', '[•]')
    case 'blocked':
      return theme.fg('warning', '[!]')
    case 'completed':
      return theme.fg('success', '[✓]')
    case 'omitted':
      return theme.fg('dim', '[-]')
  }
}

function renderContent(todo: Todo, theme: PiTheme): string {
  if (todo.status === 'completed' || todo.status === 'omitted') {
    return theme.fg('muted', theme.strikethrough(todo.content))
  }
  if (todo.status === 'in_progress') return theme.fg('text', todo.content)
  return theme.fg('muted', todo.content)
}

function getTodoDepths(todos: readonly Todo[]): ReadonlyMap<string, number> {
  const byId = new Map(todos.map((todo) => [todo.id, todo]))
  const depths = new Map<string, number>()
  const visiting = new Set<string>()

  const getDepth = (todo: Todo): number => {
    const cached = depths.get(todo.id)
    if (cached !== undefined) return cached
    if (visiting.has(todo.id)) return 0

    visiting.add(todo.id)
    const depth = todo.dependsOn.reduce((maximum, dependencyId) => {
      const dependency = byId.get(dependencyId)
      return dependency ? Math.max(maximum, getDepth(dependency) + 1) : maximum
    }, 0)
    visiting.delete(todo.id)
    depths.set(todo.id, depth)
    return depth
  }

  for (const todo of todos) getDepth(todo)
  return depths
}

function renderTodoLine(todo: Todo, theme: PiTheme, depth = 0): string {
  const prefix = depth > 0 ? `${'  '.repeat(depth)}↳ ` : ''
  return `${prefix}${renderMarker(todo.status, theme)} ${renderContent(todo, theme)}`
}

const updateUi = Effect.fnUntraced(function* (
  todos: readonly Todo[],
  suspended = false,
): Effect.fn.Return<void, TodoUiError, PiContext | PiUi> {
  const context = yield* PiContext
  const hostUi = yield* PiUi
  if (!context.hasUI) return
  if (suspended || todos.length === 0) {
    yield* hostUi.setWidget('todo', undefined).pipe(Effect.mapError((cause) => todoHostError('update', cause)))
    return
  }

  const unfinished = todos.filter(isOpenTodo)
  if (unfinished.length === 0) {
    yield* hostUi.setWidget('todo', undefined).pipe(Effect.mapError((cause) => todoHostError('update', cause)))
    return
  }

  let toolsExpanded = yield* hostUi.getToolsExpanded().pipe(Effect.mapError((cause) => todoHostError('update', cause)))
  yield* hostUi
    .setWidget('todo', (_tui: PiTui, theme: PiTheme) => ({
      render(width: number): string[] {
        toolsExpanded = hostUi.getToolsExpandedValue()
        const visible = unfinished.slice(0, 8)
        const depths = getTodoDepths(todos)
        const lines: string[] = []
        for (const todo of visible) {
          lines.push(truncateToWidth(`  ${renderTodoLine(todo, theme, depths.get(todo.id) ?? 0)}`, width))
          if (toolsExpanded) {
            const detailsIndent = '  '.repeat((depths.get(todo.id) ?? 0) + 2)
            for (const line of todoDescriptionLines(todo)) {
              for (const wrapped of wrapTextWithAnsi(line, Math.max(1, width - detailsIndent.length))) {
                lines.push(truncateToWidth(`${detailsIndent}${theme.fg('dim', wrapped)}`, width))
              }
            }
          }
        }
        if (unfinished.length > 8) lines.push(theme.fg('dim', `… ${unfinished.length - 8} more`))
        return lines
      },
      invalidate(): void {},
    }))
    .pipe(Effect.mapError((cause) => todoHostError('update', cause)))
})

const todoUiLayer: Layer.Layer<TodoUi, never, never> = Layer.succeed(
  TodoUi,
  TodoUi.of({
    update: (todos: readonly Todo[], suspended?: boolean) => updateUi(todos, suspended),
    show: (todos: readonly Todo[]) =>
      Effect.gen(function* () {
        const ui = yield* PiUi
        yield* ui
          .custom<void>((_tui, theme, keybindings, done) => new TodoViewer(todos, theme, keybindings, () => done()))
          .pipe(
            Effect.mapError((cause) => todoHostError('show', cause)),
            Effect.asVoid,
          )
      }),
  }),
)

const statusRequestLayer = Layer.effect(
  TodoStatusRequestVersion,
  Effect.gen(function* () {
    return { value: yield* Ref.make(0), phaseLock: yield* Semaphore.make(1) }
  }),
)

const todoLayer = Layer.mergeAll(TodoStore.layer, todoUiLayer, statusRequestLayer, TodoEffectsLayer)
const todoTool = createTool<TodoServices, TodoUiError, TodoRunContext>({
  toolName: 'todo',
  label: 'Todo',
  description:
    'Run TypeScript code that reads and updates the current todo plan for non-trivial work with three or more tasks.',
  promptSnippet: 'Use todo only for non-trivial work with three or more tasks',
  promptGuidelines: [TODO_PROMPT],
  timeoutMs: 30_000,
  executionMode: 'sequential',
  typeDeclarations: TODO_CODE_TYPES,
  examples: [TODO_CODE_EXAMPLE.trim()],
  errorCodec: todoToolErrorCodec,
  methods: {
    add: defineMethod({
      description:
        'Add a todo to the current plan. Add prerequisites before their dependents, then use their IDs in dependsOn.',
      signature: '(input: TodoInput): Promise<Todo>',
      parameters: addTodoParameters,
      execute: (input: TodoInput, _signal: AbortSignal | undefined, context: TodoRunContext) =>
        runTodoApiOperation('add', () => context.api.add(input)),
    }),
    update: defineMethod({
      description: 'Update one todo by ID. Dependency changes are validated atomically.',
      signature: '(id: TodoId, patch: TodoPatch): Promise<Todo>',
      parameters: updateTodoParameters,
      execute: ([id, patch]: [TodoId, TodoPatch], _signal: AbortSignal | undefined, context: TodoRunContext) =>
        runTodoApiOperation('update', () => context.api.update(id, patch)),
    }),
    show: defineMethod({
      description:
        'List todos in ID order. By default, return up to five pending or in-progress todos without details. ' +
        'Empty or null IDs use the default query. Non-empty IDs cannot combine with status. ' +
        'Non-empty IDs return every selected todo, regardless of limit. Empty status returns none. ' +
        'The limit applies after filtering and sorting. Set includeDetails to true to show details.',
      signature: '(options?: TodoShowOptions): Promise<readonly Todo[]>',
      parameters: showTodoParameters,
      optionalParameters: true,
      execute: (options: TodoShowOptions | undefined, _signal: AbortSignal | undefined, context: TodoRunContext) =>
        runTodoApiOperation('show', () => context.api.show(options)),
    }),
    next: defineMethod({
      description: 'Start the next ready todo. Fail if a todo is active or no todo is ready.',
      signature: '(): Promise<Todo>',
      execute: (_params: unknown, _signal: AbortSignal | undefined, context: TodoRunContext) =>
        runTodoApiOperation('next', () => context.api.next()),
    }),
    complete: defineMethod({
      description:
        'Complete the active todo and return remaining counts. ' +
        'allDone is true only when no pending, in-progress, or blocked todos remain.',
      signature: '(): Promise<TodoCompleteResult>',
      execute: (_params: unknown, _signal: AbortSignal | undefined, context: TodoRunContext) =>
        runTodoApiOperation('complete', () => context.api.complete()),
    }),
    omit: defineMethod({
      description: 'Mark one todo as omitted. Its dependents remain blocked until it is completed.',
      signature: '(id: TodoId): Promise<Todo>',
      parameters: todoIdParameter,
      execute: (id: TodoId, _signal: AbortSignal | undefined, context: TodoRunContext) =>
        runTodoApiOperation('omit', () => context.api.omit(id)),
    }),
    restore: defineMethod({
      description: 'Restore one omitted todo to a pending or dependency-blocked state.',
      signature: '(id: TodoId): Promise<Todo>',
      parameters: todoIdParameter,
      execute: (id: TodoId, _signal: AbortSignal | undefined, context: TodoRunContext) =>
        runTodoApiOperation('restore', () => context.api.restore(id)),
    }),
    clear: defineMethod({
      description: 'Clear every todo from the current plan and return the number removed.',
      signature: '(): Promise<{ readonly cleared: number }>',
      execute: (_params: unknown, _signal: AbortSignal | undefined, context: TodoRunContext) =>
        runTodoApiOperation('clear', () => context.api.clear()),
    }),
  },
  withRun: (run: Parameters<TodoToolRun>[0], signal: Parameters<TodoToolRun>[1]) =>
    Effect.gen(function* () {
      const effects = yield* TodoEffects
      return yield* effects.withRun(run, signal)
    }),
})

const todoPlugin = PiExtension.define<TodoServices, TodoToolFailure>({
  id: 'todo',
  layer: todoLayer,
  effect: (registrations: TodoPluginRegistrations) =>
    Effect.gen(function* () {
      const effects = yield* TodoEffects
      yield* registrations.events.on('session_start', () => effects.syncFromSession())
      yield* registrations.events.on('session_tree', (event) =>
        effects.syncFromSession(event.summaryEntry !== undefined),
      )
      yield* registrations.events.on('before_agent_start', () => effects.syncFromSession())
      yield* registrations.events.on('input', () =>
        effects.requestPlannotatorPhase().pipe(Effect.as({ action: 'continue' })),
      )
      yield* registrations.events.on('tool_result', (event) =>
        isApprovedPlanSubmission(event) ? effects.requestPlannotatorPhase() : Effect.succeed(undefined),
      )
      yield* registrations.events.on('agent_end', () => effects.handleAgentEnd())
      yield* registrations.events.on('session_compact', (event) => effects.handleCompaction(event))
      yield* registrations.events.on('session_shutdown', () => effects.clearTodoWidget())
      yield* todoTool.register(registrations.tools)
      yield* registrations.commands.register('todos', {
        description: 'Show todos on the current branch',
        handler: () =>
          Effect.gen(function* () {
            const context = yield* PiContext
            const ui = yield* PiUi
            if (context.mode !== 'tui') {
              if (context.hasUI) {
                yield* ui
                  .notify('/todos requires interactive mode', 'error')
                  .pipe(Effect.mapError((cause) => todoHostError('notify', cause)))
              }
              return
            }
            if (context.hasUI) yield* effects.showTodos()
          }),
      })
      yield* registrations.commands.register('clear-todos', {
        description: 'Clear todos on the current branch',
        handler: () =>
          Effect.gen(function* () {
            const context = yield* PiContext
            const ui = yield* PiUi
            if (context.mode !== 'tui') {
              if (context.hasUI) {
                yield* ui
                  .notify('/clear-todos requires interactive mode', 'error')
                  .pipe(Effect.mapError((cause) => todoHostError('notify', cause)))
              }
              return
            }
            if (!context.hasUI) return
            const cleared = yield* effects.clearTodos(context.signal)
            const clearedMessage = `Cleared ${cleared} todo${cleared === 1 ? '' : 's'}`
            const pi = yield* Pi
            const deliveryFailure = yield* Effect.match(
              Effect.gen(function* () {
                const isIdle = yield* context.isIdle().pipe(Effect.mapError((cause) => todoHostError('is-idle', cause)))
                yield* pi.messages
                  .sendMessage(
                    { customType: 'todo-clear', content: clearedMessage, display: false },
                    isIdle ? { triggerTurn: false } : { deliverAs: 'nextTurn' },
                  )
                  .pipe(Effect.mapError((cause) => todoHostError('send-message', cause)))
              }),
              {
                onFailure: (error: TodoUiError) => error,
                onSuccess: () => undefined,
              },
            )
            yield* ui.notify(clearedMessage, 'info').pipe(Effect.mapError((cause) => todoHostError('notify', cause)))
            if (deliveryFailure) {
              yield* ui
                .notify(
                  `${clearedMessage}, but the assistant context was not updated: ${deliveryFailure.message}`,
                  'warning',
                )
                .pipe(Effect.mapError((cause) => todoHostError('notify', cause)))
            }
          }),
      })
    }),
})

const todoExtension = PiExtension.install(todoPlugin)

export { TodoViewer, todoExtension as default }
