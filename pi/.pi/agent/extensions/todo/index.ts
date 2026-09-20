import { StringEnum } from '@earendil-works/pi-ai'
import type { ExtensionAPI, ExtensionContext, Theme, ToolResultEvent } from '@earendil-works/pi-coding-agent'
import { keyHint } from '@earendil-works/pi-coding-agent'
import { matchesKey, Text, truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { Type } from 'typebox'
import {
  TodoContext,
  TodoEffects,
  TodoEffectsLayer,
  type TodoEffectsRequirements,
  type TodoNextToolDetails,
  TodoPi,
  TodoStatusRequestVersion,
  type TodoToolDetails,
  TodoUi,
  TodoUiError,
} from './src/effects.ts'
import {
  decodeStoredTodos,
  decodeTodoList,
  getTodoCounts,
  getWaitingTodos,
  isOpenTodo,
  TODO_OPERATIONS,
  type Todo,
  type TodoStatus,
  todoDescriptionLines,
} from './src/state.ts'
import { TodoStore } from './src/store.ts'

const PLAN_SUBMIT_TOOL_NAME = 'plannotator_submit_plan'

function toolExpandHint(): string {
  try {
    return keyHint('app.tools.expand', 'to expand')
  } catch {
    return 'to expand'
  }
}

function isApprovedPlanSubmission(event: ToolResultEvent): boolean {
  if (event.toolName !== PLAN_SUBMIT_TOOL_NAME || event.isError) {
    return false
  }
  const details = event.details
  return !!details && typeof details === 'object' && (details as { approved?: unknown }).approved === true
}

const TodoSchema = Type.Object({
  content: Type.String({ description: 'Short task title' }),
  dependsOn: Type.Array(Type.String(), { description: 'Task titles that must complete first' }),
  description: Type.Optional(
    Type.String({
      description:
        'Optional longer details, for example file paths, acceptance criteria, and decisions. Reminders and compaction snapshots include this text.',
    }),
  ),
})

const Params = Type.Object({
  operation: StringEnum(TODO_OPERATIONS),
  todos: Type.Optional(Type.Array(TodoSchema, { description: 'Task definitions for the replace operation' })),
})

class TodoViewer {
  private cachedWidth?: number
  private cachedLines?: string[]
  private readonly todos: readonly Todo[]
  private readonly theme: Theme
  private readonly onClose: () => void

  constructor(todos: readonly Todo[], theme: Theme, onClose: () => void) {
    this.todos = todos
    this.theme = theme
    this.onClose = onClose
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
      this.onClose()
    }
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines
    }

    const counts = getTodoCounts(this.todos)
    const lines: string[] = []
    const header = `${this.theme.fg('accent', ' Todos ')}${this.theme.fg('dim', ` ${formatCounts(counts)}`)}`
    lines.push('')
    lines.push(truncateToWidth(header, width))
    lines.push('')

    if (this.todos.length === 0) {
      lines.push(truncateToWidth(`  ${this.theme.fg('dim', 'No todos')}`, width))
    } else {
      const waitingIds = new Set(getWaitingTodos(this.todos).map((todo) => todo.id))
      for (const todo of this.todos) {
        lines.push(truncateToWidth(`  ${renderTodoLine(todo, this.theme, waitingIds.has(todo.id))}`, width))
      }
    }

    lines.push('')
    lines.push(truncateToWidth(`  ${this.theme.fg('dim', 'Press Escape to close')}`, width))
    lines.push('')

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

function renderMarker(status: TodoStatus, theme: Theme): string {
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

function renderContent(todo: Todo, theme: Theme): string {
  if (todo.status === 'completed' || todo.status === 'omitted') {
    return theme.fg('muted', theme.strikethrough(todo.content))
  }
  if (todo.status === 'in_progress') {
    return theme.fg('text', todo.content)
  }
  return theme.fg('muted', todo.content)
}

function renderTodoLine(todo: Todo, theme: Theme, waiting = false): string {
  const state = waiting ? ` ${theme.fg('warning', '(waiting)')}` : ''
  return `${renderMarker(todo.status, theme)} ${renderContent(todo, theme)}${state}`
}

function renderDescriptionLines(todo: Todo, theme: Theme): string[] {
  return todoDescriptionLines(todo).map((line) => `    ${theme.fg('dim', line)}`)
}

function updateUi(ctx: ExtensionContext, todos: readonly Todo[], suspended = false): void {
  if (!ctx.hasUI) {
    return
  }

  if (suspended || todos.length === 0) {
    ctx.ui.setWidget('todo', undefined)
    return
  }

  const unfinished = todos.filter(isOpenTodo)
  if (unfinished.length === 0) {
    ctx.ui.setWidget('todo', undefined)
    return
  }

  const waitingIds = new Set(getWaitingTodos(todos).map((todo) => todo.id))
  ctx.ui.setWidget('todo', (_tui, theme) => ({
    render(width: number) {
      const visible = unfinished.slice(0, 8)
      const expanded = ctx.ui.getToolsExpanded()
      const lines: string[] = []
      for (const todo of visible) {
        lines.push(truncateToWidth(`  ${renderTodoLine(todo, theme, waitingIds.has(todo.id))}`, width))
        if (expanded) {
          for (const line of todoDescriptionLines(todo)) {
            for (const wrapped of wrapTextWithAnsi(line, Math.max(1, width - 4))) {
              lines.push(`    ${theme.fg('dim', wrapped)}`)
            }
          }
        }
      }
      if (unfinished.length > 8) {
        lines.push(theme.fg('dim', `… ${unfinished.length - 8} more`))
      }
      return lines
    },
    invalidate() {},
  }))
}

function toTodoUiError(operation: string, cause: unknown): TodoUiError {
  return new TodoUiError({ operation, message: String(cause) })
}

const todoUiLayer: Layer.Layer<TodoUi, never, TodoContext> = Layer.effect(
  TodoUi,
  Effect.gen(function* () {
    const ctx = yield* TodoContext
    return TodoUi.of({
      update: (todos, suspended) =>
        Effect.try({
          try: () => updateUi(ctx, todos, suspended),
          catch: (cause) => toTodoUiError('update', cause),
        }),
      show: (todos) =>
        Effect.tryPromise({
          try: () =>
            ctx.ui.custom<void>((_tui, theme, _keybindings, done) => new TodoViewer(todos, theme, () => done())),
          catch: (cause) => toTodoUiError('show', cause),
        }),
    })
  }),
)

function todoExtension(pi: ExtensionAPI): void {
  const runtime = ManagedRuntime.make(TodoStore.layer)
  const statusRequestVersion = { value: 0 }
  let shuttingDown = false

  const run = <A, E>(
    use: (effects: TodoEffects['Service']) => Effect.Effect<A, E, TodoEffectsRequirements>,
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ): Promise<A> => {
    const todoContextLayer = Layer.succeed(TodoContext, ctx)
    const effectsLayer = TodoEffectsLayer.pipe(
      Layer.provideMerge(
        Layer.mergeAll(
          todoUiLayer.pipe(Layer.provideMerge(todoContextLayer)),
          Layer.succeed(TodoPi, pi),
          Layer.succeed(TodoStatusRequestVersion, statusRequestVersion),
        ),
      ),
    )
    return runtime.runPromise(Effect.provide(TodoEffects.use(use), effectsLayer), {
      signal: signal ?? ctx.signal,
    })
  }

  pi.on('session_start', async (_event, ctx) => {
    await run((effects) => effects.syncFromSession(), ctx)
  })
  pi.on('session_tree', async (_event, ctx) => {
    await run((effects) => effects.syncFromSession(), ctx)
  })
  pi.on('before_agent_start', async (_event, ctx) => {
    await run((effects) => effects.syncFromSession(), ctx)
  })
  pi.on('input', async (_event, ctx) => {
    await run((effects) => effects.requestPlannotatorPhase(), ctx)
    return { action: 'continue' }
  })
  pi.on('tool_result', async (event, ctx) => {
    if (isApprovedPlanSubmission(event)) {
      await run((effects) => effects.requestPlannotatorPhase(), ctx)
    }
  })
  pi.on('agent_end', async (_event, ctx) => {
    await run((effects) => effects.handleAgentEnd(), ctx)
  })
  pi.on('session_compact', async (event, ctx) => {
    await run((effects) => effects.handleCompaction(event), ctx)
  })
  pi.on('session_shutdown', async (_event, ctx) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    try {
      await run((effects) => effects.clearTodoWidget(), ctx)
    } finally {
      await runtime.dispose()
    }
  })

  pi.registerTool({
    name: 'todowrite',
    label: 'Todo',
    description: 'Create or update the todo plan, or apply a task operation to the active task.',
    promptSnippet: 'Use todowrite to create a plan or apply a task operation',
    promptGuidelines: [
      'Use todowrite for work with 3+ distinct steps; skip trivial work.',
      'Use operation replace to create or revise the task plan.',
      'Keep content a short title. Put details that you need later in the optional description field.',
      'Use operation complete_task only after the active task is complete and verified.',
      'Use todonext to return the current active task or start the next ready task.',
      'On Error, no changes were applied; use the accepted state shown in the error and retry the operation.',
      'Continue until no open task remains or the user explicitly omits it.',
    ],
    parameters: Params,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return run((effects) => effects.executeTodo(params), ctx, signal)
    },
    renderCall(args, theme, context) {
      const next = context?.argsComplete && args.operation === 'replace' ? decodeTodoList(args.todos) : undefined
      const label = theme.fg('toolTitle', theme.bold('todowrite'))
      if (!next) {
        return new Text(label, 0, 0)
      }

      const counts = getTodoCounts(next)
      return new Text(
        label +
          ' ' +
          theme.fg('muted', `${counts.total} item${counts.total === 1 ? '' : 's'}`) +
          (counts.inProgress > 0 ? ` ${theme.fg('accent', `${counts.inProgress} active`)}` : ''),
        0,
        0,
      )
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as TodoToolDetails | undefined
      if (!details) {
        const text = result.content[0]
        return new Text(text?.type === 'text' ? text.text : '', 0, 0)
      }
      if (details.error) {
        return new Text(theme.fg('error', `Error: ${details.error}`), 0, 0)
      }

      const list = decodeStoredTodos(details.todos) ?? []
      if (list.length === 0) {
        return new Text(theme.fg('dim', 'Todo list cleared'), 0, 0)
      }

      const counts = getTodoCounts(list)
      const visible = expanded
        ? list
        : (() => {
            const unfinished = list.filter(isOpenTodo)
            return (unfinished.length > 0 ? unfinished : list).slice(0, 4)
          })()
      const waitingIds = new Set(getWaitingTodos(list).map((todo) => todo.id))
      const lines = [theme.fg('muted', formatCounts(counts))]
      for (const todo of visible) {
        lines.push(renderTodoLine(todo, theme, waitingIds.has(todo.id)))
        if (expanded) {
          lines.push(...renderDescriptionLines(todo, theme))
        }
      }
      if (!expanded && visible.length < list.length) {
        lines.push(theme.fg('dim', `… ${list.length - visible.length} more`))
      }
      return new Text(lines.join('\n'), 0, 0)
    },
  })

  pi.registerTool({
    name: 'todonext',
    label: 'Todo Next',
    description: 'Return the current active task or start the next ready task.',
    promptSnippet: 'Use todonext to return the current task or start the next ready task',
    promptGuidelines: ['Use todonext when you need the current task or when no task is active.'],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      return run((effects) => effects.executeTodoNext(), ctx, signal)
    },
    renderCall(_args, theme) {
      return new Text(theme.fg('toolTitle', theme.bold('todonext')), 0, 0)
    },
    renderResult(result, { expanded }, theme) {
      const details = result.details as TodoNextToolDetails | undefined
      if (!details) {
        const text = result.content[0]
        return new Text(text?.type === 'text' ? text.text : '', 0, 0)
      }

      const lines =
        details.status !== 'none' && details.todo
          ? [`${theme.fg('accent', details.status === 'started' ? 'Started' : 'Current')}: ${details.todo.content}`]
          : [theme.fg('warning', 'No ready task')]
      if (expanded || details.status === 'none') {
        if (details.waiting.length > 0) {
          lines.push(`Waiting: ${details.waiting.map((todo) => todo.content).join(', ')}`)
        }
        if (details.blocked.length > 0) {
          lines.push(`Blocked: ${details.blocked.map((todo) => todo.content).join(', ')}`)
        }
      }
      if (!expanded) {
        lines.push(theme.fg('dim', toolExpandHint()))
      }
      return new Text(lines.join('\n'), 0, 0)
    },
  })

  pi.registerCommand('todos', {
    description: 'Show todos on the current branch',
    handler: async (_args, ctx) => {
      if (ctx.mode !== 'tui') {
        if (ctx.hasUI) {
          ctx.ui.notify('/todos requires interactive mode', 'error')
        }
        return
      }
      if (!ctx.hasUI) {
        return
      }

      await run((effects) => effects.showTodos(), ctx)
    },
  })
}

export { todoExtension as default }
