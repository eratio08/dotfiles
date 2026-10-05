import type { Theme } from '@earendil-works/pi-coding-agent'
import { truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
import {
  type EffectToolDefinition,
  Pi,
  PiContext,
  type PiContextTag,
  PiExtension,
  type PiServices,
  PiToolContext,
  PiUi,
} from '@eratio/pi-effect'
import { Effect, Layer, Ref, Result, Schema, Semaphore } from 'effect'
import { Type } from 'typebox'
import {
  getTodoCounts,
  TODO_ID_PATTERN,
  TODO_STATUSES,
  type Todo,
  type TodoCompleteResult,
  TodoEffects,
  TodoEffectsLayer,
  type TodoId,
  type TodoInput,
  type TodoPatch,
  type TodoShowOptions,
  type TodoStatus,
  TodoStatusRequestVersion,
  TodoStore,
  TodoUi,
  type TodoUiError,
  todoDescriptionLines,
  todoHostError,
} from './src/extension.ts'

const PLAN_SUBMIT_TOOL_NAME = 'plannotator_submit_plan'
const decodeApprovedPlanSubmissionDetails = Schema.decodeUnknownResult(
  Schema.Struct({ approved: Schema.Literal(true) }),
)
type TodoServices = TodoEffects | TodoStore | TodoStatusRequestVersion | TodoUi
type TodoPluginRegistrations = Parameters<
  NonNullable<Parameters<typeof PiExtension.define<TodoServices, TodoUiError>>[0]['effect']>
>[0]

const todoIdParameter = Type.String({ pattern: TODO_ID_PATTERN.source })
const todoStatusParameter = Type.Union(TODO_STATUSES.map((status) => Type.Literal(status)))
const addTodoParameters = Type.Object({
  content: Type.String(),
  details: Type.Optional(Type.String()),
  dependsOn: Type.Optional(Type.Array(todoIdParameter)),
})
const updateTodoParameters = Type.Object({
  id: todoIdParameter,
  patch: Type.Object({
    content: Type.Optional(Type.String()),
    details: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    dependsOn: Type.Optional(Type.Array(todoIdParameter)),
  }),
})
const showTodoParameters = Type.Object({
  ids: Type.Optional(Type.Union([Type.Array(todoIdParameter), Type.Null()])),
  status: Type.Optional(Type.Array(todoStatusParameter)),
  limit: Type.Optional(Type.Integer({ minimum: 1 })),
  includeDetails: Type.Optional(Type.Boolean()),
})
const todoToolNamespace = {
  name: 'todo',
  description: 'Tools for inspecting and updating the current todo plan.',
} as const
const todoOutputSchema = Type.Object({
  id: todoIdParameter,
  content: Type.String(),
  details: Type.Optional(Type.String()),
  status: todoStatusParameter,
  dependsOn: Type.Array(todoIdParameter),
})
const todoShowOutputSchema = Type.Array(todoOutputSchema)
const todoNoParameters = Type.Object({})
const todoCompleteOutputSchema = Type.Object({
  completed: todoOutputSchema,
  remaining: Type.Object({
    pending: Type.Integer({ minimum: 0 }),
    inProgress: Type.Integer({ minimum: 0 }),
    blocked: Type.Integer({ minimum: 0 }),
  }),
  allDone: Type.Boolean(),
})
const todoClearOutputSchema = Type.Object({ cleared: Type.Integer({ minimum: 0 }) })

const todoShowTool: EffectToolDefinition<
  typeof showTodoParameters,
  TodoServices | PiServices,
  TodoUiError,
  { readonly count: number }
> = {
  name: 'todo_show',
  label: 'Show todos',
  description:
    'List todos in ID order. By default, return up to five pending or in-progress todos without details. ' +
    'Empty or null IDs use the default query. Non-empty IDs cannot combine with status. ' +
    'Non-empty IDs return every selected todo, regardless of limit. Empty status returns none. ' +
    'The limit applies after filtering and sorting. Set includeDetails to true to show details.',
  promptSnippet: 'Inspect the current todo plan',
  promptGuidelines: [
    'Use todo_show when the current plan is unclear.',
    'Use ids or status to filter tasks. Set includeDetails to request task details.',
  ],
  parameters: showTodoParameters,
  exposure: 'codemode',
  namespace: todoToolNamespace,
  annotations: { readOnlyHint: true, idempotentHint: true },
  outputSchema: todoShowOutputSchema,
  execute: (options: TodoShowOptions) =>
    Effect.gen(function* () {
      const tool = yield* PiToolContext
      const effects = yield* TodoEffects
      const todos = yield* effects.withRun('show', (api) => api.show(options), tool.toolSignal)
      return {
        content: [{ type: 'text', text: JSON.stringify(todos) }],
        details: { count: todos.length },
        structuredContent: todos,
      }
    }),
}

const todoAddTool: EffectToolDefinition<
  typeof addTodoParameters,
  TodoServices | PiServices,
  TodoUiError,
  { readonly id: string }
> = {
  name: 'todo_add',
  label: 'Add todo',
  description:
    'Add a todo to the current plan. Add prerequisites before their dependents, then use their IDs in dependsOn.',
  promptSnippet: 'Add a todo to the current plan',
  promptGuidelines: ['Add prerequisites before their dependents. Use dependsOn to link their IDs.'],
  parameters: addTodoParameters,
  exposure: 'codemode',
  namespace: todoToolNamespace,
  outputSchema: todoOutputSchema,
  execute: (input: TodoInput) =>
    Effect.gen(function* () {
      const tool = yield* PiToolContext
      const effects = yield* TodoEffects
      const todo = yield* effects.withRun('add', (api) => api.add(input), tool.toolSignal)
      return {
        content: [{ type: 'text', text: JSON.stringify(todo) }],
        details: { id: todo.id },
        structuredContent: todo,
      }
    }),
}

const todoUpdateTool: EffectToolDefinition<
  typeof updateTodoParameters,
  TodoServices | PiServices,
  TodoUiError,
  { readonly id: string }
> = {
  name: 'todo_update',
  label: 'Update todo',
  description: 'Update one todo by ID. Dependency changes are validated atomically.',
  promptSnippet: 'Update a todo in the current plan',
  promptGuidelines: ["Use todo_update to change a todo's content, details, or dependencies."],
  parameters: updateTodoParameters,
  exposure: 'codemode',
  namespace: todoToolNamespace,
  outputSchema: todoOutputSchema,
  execute: ({ id, patch }: { id: TodoId; patch: TodoPatch }) =>
    Effect.gen(function* () {
      const tool = yield* PiToolContext
      const effects = yield* TodoEffects
      const todo = yield* effects.withRun('update', (api) => api.update(id, patch), tool.toolSignal)
      return {
        content: [{ type: 'text', text: JSON.stringify(todo) }],
        details: { id: todo.id },
        structuredContent: todo,
      }
    }),
}

const todoNextTool: EffectToolDefinition<
  typeof todoNoParameters,
  TodoServices | PiServices,
  TodoUiError,
  { readonly id: string }
> = {
  name: 'todo_next',
  label: 'Start next todo',
  description: 'Start the next ready todo. Fail if a todo is active or no todo is ready.',
  promptSnippet: 'Start the next ready todo',
  promptGuidelines: ['Use todo_next when no todo is active and the plan has a ready todo.'],
  parameters: todoNoParameters,
  exposure: 'codemode',
  namespace: todoToolNamespace,
  outputSchema: todoOutputSchema,
  execute: () =>
    Effect.gen(function* () {
      const tool = yield* PiToolContext
      const effects = yield* TodoEffects
      const todo = yield* effects.withRun('next', (api) => api.next(), tool.toolSignal)
      return {
        content: [{ type: 'text', text: JSON.stringify(todo) }],
        details: { id: todo.id },
        structuredContent: todo,
      }
    }),
}

const todoCompleteTool: EffectToolDefinition<
  typeof todoNoParameters,
  TodoServices | PiServices,
  TodoUiError,
  { readonly id: string }
> = {
  name: 'todo_complete',
  label: 'Complete todo',
  description:
    'Complete the active todo and return remaining counts. allDone is true only when no pending, in-progress, or blocked todos remain.',
  promptSnippet: 'Complete the active todo',
  promptGuidelines: ['Use todo_complete after finishing the active task.'],
  parameters: todoNoParameters,
  exposure: 'codemode',
  namespace: todoToolNamespace,
  outputSchema: todoCompleteOutputSchema,
  execute: () =>
    Effect.gen(function* () {
      const tool = yield* PiToolContext
      const effects = yield* TodoEffects
      const result: TodoCompleteResult = yield* effects.withRun('complete', (api) => api.complete(), tool.toolSignal)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: { id: result.completed.id },
        structuredContent: result,
      }
    }),
}

const todoOmitTool: EffectToolDefinition<
  typeof todoIdParameter,
  TodoServices | PiServices,
  TodoUiError,
  { readonly id: string }
> = {
  name: 'todo_omit',
  label: 'Omit todo',
  description: 'Mark one todo as omitted. Its dependents remain blocked until it is completed.',
  promptSnippet: 'Omit a todo from the current plan',
  promptGuidelines: ['Use todo_omit when a task is no longer required.'],
  parameters: todoIdParameter,
  exposure: 'codemode',
  namespace: todoToolNamespace,
  outputSchema: todoOutputSchema,
  execute: (id: TodoId) =>
    Effect.gen(function* () {
      const tool = yield* PiToolContext
      const effects = yield* TodoEffects
      const todo = yield* effects.withRun('omit', (api) => api.omit(id), tool.toolSignal)
      return {
        content: [{ type: 'text', text: JSON.stringify(todo) }],
        details: { id: todo.id },
        structuredContent: todo,
      }
    }),
}

const todoRestoreTool: EffectToolDefinition<
  typeof todoIdParameter,
  TodoServices | PiServices,
  TodoUiError,
  { readonly id: string }
> = {
  name: 'todo_restore',
  label: 'Restore todo',
  description: 'Restore one omitted todo to a pending or dependency-blocked state.',
  promptSnippet: 'Restore a todo to the current plan',
  promptGuidelines: ['Use todo_restore only for a todo with omitted status.'],
  parameters: todoIdParameter,
  exposure: 'codemode',
  namespace: todoToolNamespace,
  outputSchema: todoOutputSchema,
  execute: (id: TodoId) =>
    Effect.gen(function* () {
      const tool = yield* PiToolContext
      const effects = yield* TodoEffects
      const todo = yield* effects.withRun('restore', (api) => api.restore(id), tool.toolSignal)
      return {
        content: [{ type: 'text', text: JSON.stringify(todo) }],
        details: { id: todo.id },
        structuredContent: todo,
      }
    }),
}

const todoClearTool: EffectToolDefinition<
  typeof todoNoParameters,
  TodoServices | PiServices,
  TodoUiError,
  { readonly cleared: number }
> = {
  name: 'todo_clear',
  label: 'Clear todos',
  description: 'Clear every todo from the current plan and return the number removed.',
  promptSnippet: 'Clear the current todo plan',
  promptGuidelines: ['Use todo_clear only when the current plan must be removed.'],
  parameters: todoNoParameters,
  exposure: 'codemode',
  namespace: todoToolNamespace,
  outputSchema: todoClearOutputSchema,
  execute: () =>
    Effect.gen(function* () {
      const tool = yield* PiToolContext
      const effects = yield* TodoEffects
      const result = yield* effects.withRun('clear', (api) => api.clear(), tool.toolSignal)
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: { cleared: result.cleared },
        structuredContent: result,
      }
    }),
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

type TodoTheme = Pick<Theme, 'fg' | 'strikethrough'>

class TodoViewer {
  private cachedWidth?: number
  private cachedLines?: string[]
  private readonly todos: readonly Todo[]
  private readonly theme: TodoTheme
  private readonly keybindings: TodoCancelKeybindings
  private readonly onClose: () => void

  constructor(todos: readonly Todo[], theme: TodoTheme, keybindings: TodoCancelKeybindings, onClose: () => void) {
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
      for (const { todo, depth } of getTodoDisplayTree(this.todos)) {
        lines.push(truncateToWidth(`  ${renderTodoLine(todo, this.theme, depth)}`, width))
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

function renderMarker(status: TodoStatus, theme: TodoTheme): string {
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

function renderContent(todo: Todo, theme: TodoTheme): string {
  if (todo.status === 'completed' || todo.status === 'omitted') {
    return theme.fg('muted', theme.strikethrough(todo.content))
  }
  if (todo.status === 'in_progress') return theme.fg('text', todo.content)
  return theme.fg('muted', todo.content)
}

function getTodoDisplayTree(todos: readonly Todo[]): Array<{ todo: Todo; depth: number }> {
  const byId = new Map(todos.map((todo) => [todo.id, todo]))
  const children = new Map<string, Todo[]>()
  const roots: Todo[] = []

  for (const todo of todos) {
    const blockers =
      todo.status === 'blocked'
        ? todo.dependsOn.filter((dependencyId) => byId.get(dependencyId)?.status !== 'completed')
        : []
    const parentId = blockers.at(-1) ?? todo.dependsOn.at(-1)
    const parent = parentId ? byId.get(parentId) : undefined
    if (!parent) {
      roots.push(todo)
      continue
    }

    const siblings = children.get(parent.id) ?? []
    siblings.push(todo)
    children.set(parent.id, siblings)
  }

  const rows: Array<{ todo: Todo; depth: number }> = []
  const visited = new Set<string>()
  const visit = (todo: Todo, depth: number): void => {
    if (visited.has(todo.id)) return

    visited.add(todo.id)
    rows.push({ todo, depth })
    for (const child of children.get(todo.id) ?? []) visit(child, depth + 1)
  }

  for (const root of roots) visit(root, 0)
  for (const todo of todos) visit(todo, 0)
  return rows
}

function renderTodoLine(todo: Todo, theme: TodoTheme, depth = 0): string {
  const prefix = depth > 0 ? `${'  '.repeat(depth)}↳ ` : ''
  return `${prefix}${renderMarker(todo.status, theme)} ${renderContent(todo, theme)}`
}

const updateUi = Effect.fnUntraced(function* (
  todos: readonly Todo[],
  suspended = false,
): Effect.fn.Return<void, TodoUiError, PiContextTag | PiUi> {
  const context = yield* PiContext
  const hostUi = yield* PiUi
  if (!context.hasUI) return
  if (suspended || todos.length === 0) {
    yield* hostUi.setWidget('todo', undefined).pipe(Effect.mapError((cause) => todoHostError('update', cause)))
    return
  }

  const displayTree = getTodoDisplayTree(todos)

  let toolsExpanded = yield* hostUi.getToolsExpanded().pipe(Effect.mapError((cause) => todoHostError('update', cause)))
  yield* hostUi
    .setWidget('todo', (_tui, theme) => ({
      render(width: number): string[] {
        toolsExpanded = hostUi.getToolsExpandedValue()
        const maxVisible = 5
        const visibleCount = Math.min(displayTree.length, maxVisible)
        const activeIndex = displayTree.findIndex(({ todo }) => todo.status === 'in_progress')
        const startIndex =
          activeIndex < 0
            ? 0
            : Math.max(0, Math.min(activeIndex - Math.floor(maxVisible / 2), displayTree.length - visibleCount))
        const visible = displayTree.slice(startIndex, startIndex + visibleCount)
        const baseDepth = visible[0]?.depth ?? 0
        const lines: string[] = []
        for (const { todo, depth } of visible) {
          const visibleDepth = Math.max(0, depth - baseDepth)
          lines.push(truncateToWidth(`  ${renderTodoLine(todo, theme, visibleDepth)}`, width))
          if (toolsExpanded) {
            const detailsIndent = '  '.repeat(visibleDepth + 2)
            for (const line of todoDescriptionLines(todo)) {
              for (const wrapped of wrapTextWithAnsi(line, Math.max(1, width - detailsIndent.length))) {
                lines.push(truncateToWidth(`${detailsIndent}${theme.fg('dim', wrapped)}`, width))
              }
            }
          }
        }
        if (displayTree.length > visible.length) {
          lines.push(theme.fg('dim', `… ${displayTree.length - visible.length} more`))
        }
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
const todoPlugin = PiExtension.define<TodoServices, TodoUiError>({
  id: 'todo',
  layer: todoLayer,
  effect: (registrations: TodoPluginRegistrations) =>
    Effect.gen(function* () {
      const effects = yield* TodoEffects
      yield* registrations.events.on('session_start', () => effects.restoreFromSession())
      yield* registrations.events.on('session_tree', () => effects.carryTodosThroughTreeNavigation())
      yield* registrations.events.on('before_agent_start', () => effects.prepareAgentStart())
      yield* registrations.events.on('input', () =>
        effects.requestPlannotatorPhase().pipe(Effect.as({ action: 'continue' })),
      )
      yield* registrations.events.on('tool_result', (event) =>
        isApprovedPlanSubmission(event) ? effects.requestPlannotatorPhase() : Effect.succeed(undefined),
      )
      yield* registrations.events.on('agent_end', () => effects.handleAgentEnd())
      yield* registrations.events.on('session_compact', (event) => effects.handleCompaction(event))
      yield* registrations.events.on('session_shutdown', () => effects.clearTodoWidget())
      yield* registrations.tools.register(todoShowTool)
      yield* registrations.tools.register(todoAddTool)
      yield* registrations.tools.register(todoUpdateTool)
      yield* registrations.tools.register(todoNextTool)
      yield* registrations.tools.register(todoCompleteTool)
      yield* registrations.tools.register(todoOmitTool)
      yield* registrations.tools.register(todoRestoreTool)
      yield* registrations.tools.register(todoClearTool)
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
