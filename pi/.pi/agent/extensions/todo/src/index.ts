import { StringEnum } from '@earendil-works/pi-ai'
import type { ExtensionAPI, ExtensionContext, Theme, ToolResultEvent } from '@earendil-works/pi-coding-agent'
import { matchesKey, Text, truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { Type } from 'typebox'
import { TodoContext, TodoEffects, TodoEffectsLayer, type TodoToolDetails, TodoUi, TodoUiError } from './effects.ts'
import {
  getTodoCounts,
  isOpenTodo,
  normalizeTodos,
  TODO_PRIORITIES,
  TODO_STATUSES,
  type Todo,
  type TodoPriority,
  type TodoStatus,
  TodoStore,
  todoDescriptionLines,
} from './state.ts'

const PLAN_SUBMIT_TOOL_NAME = 'plannotator_submit_plan'

function isApprovedPlanSubmission(event: ToolResultEvent): boolean {
  if (event.toolName !== PLAN_SUBMIT_TOOL_NAME || event.isError) {
    return false
  }
  const details = event.details
  return !!details && typeof details === 'object' && (details as { approved?: unknown }).approved === true
}

const TodoSchema = Type.Object({
  content: Type.String({ description: 'Short task title' }),
  status: StringEnum(TODO_STATUSES),
  priority: StringEnum(TODO_PRIORITIES),
  description: Type.Optional(
    Type.String({
      description:
        'Optional longer details, for example file paths, acceptance criteria, and decisions. Reminders and compaction snapshots include this text.',
    }),
  ),
})

const Params = Type.Object({
  todos: Type.Array(TodoSchema, { description: 'Full todo list snapshot' }),
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
      for (const todo of this.todos) {
        lines.push(truncateToWidth(`  ${renderTodoLine(todo, this.theme, true)}`, width))
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
  if (counts.completed > 0) parts.push(`${counts.completed} done`)
  if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`)
  return parts.join(' • ') || 'empty'
}

function renderMarker(status: TodoStatus, theme: Theme): string {
  switch (status) {
    case 'pending':
      return theme.fg('dim', '[ ]')
    case 'in_progress':
      return theme.fg('accent', '[•]')
    case 'completed':
      return theme.fg('success', '[✓]')
    case 'cancelled':
      return theme.fg('warning', '[-]')
  }
}

function renderPriority(priority: TodoPriority, theme: Theme): string {
  switch (priority) {
    case 'high':
      return theme.fg('error', 'high')
    case 'medium':
      return theme.fg('warning', 'medium')
    case 'low':
      return theme.fg('dim', 'low')
  }
}

function renderContent(todo: Todo, theme: Theme): string {
  if (todo.status === 'completed' || todo.status === 'cancelled') {
    return theme.fg('muted', theme.strikethrough(todo.content))
  }
  if (todo.status === 'in_progress') {
    return theme.fg('text', todo.content)
  }
  return theme.fg('muted', todo.content)
}

function renderTodoLine(todo: Todo, theme: Theme, includePriority: boolean): string {
  const priority = includePriority ? ` ${theme.fg('dim', `(${renderPriority(todo.priority, theme)})`)}` : ''
  return `${renderMarker(todo.status, theme)} ${renderContent(todo, theme)}${priority}`
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

  ctx.ui.setWidget('todo', (_tui, theme) => ({
    render(width: number) {
      const visible = unfinished.slice(0, 8)
      const expanded = ctx.ui.getToolsExpanded()
      const lines: string[] = []
      for (const todo of visible) {
        lines.push(truncateToWidth(renderTodoLine(todo, theme, false), width))
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

const todoUiLayer = Layer.effect(
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

export default function (pi: ExtensionAPI) {
  const runtime = ManagedRuntime.make(TodoStore.layer)
  const statusRequestVersion = { value: 0 }
  let shuttingDown = false

  const run = <A, E>(
    use: (effects: TodoEffects['Service']) => Effect.Effect<A, E>,
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ): Promise<A> => {
    const effectsLayer = TodoEffectsLayer(pi, statusRequestVersion).pipe(
      Layer.provide(todoUiLayer),
      Layer.provide(Layer.succeed(TodoContext, ctx)),
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
    description:
      'Maintain the accepted full todo snapshot for multi-step work. Keep one active item and advance it only after verified work.',
    promptSnippet: 'Use todowrite with the full accepted list and advance one active task at a time',
    promptGuidelines: [
      'Use todowrite for work with 3+ distinct steps; skip trivial work.',
      'Keep content a short title. Put details that you need later in the optional description field.',
      'The description stays available after compaction. Record file paths, acceptance criteria, and decisions in the description when later steps depend on them.',
      'Accepted snapshot: every call replaces the full list, so preserve every task and its exact content.',
      'Start: mark exactly one actionable task in_progress; leave other unfinished tasks pending.',
      'Advance: after verified work, mark only the task that was in_progress in the last accepted snapshot completed.',
      'When work remains, activate exactly one pending next task in the same update; when none remains, leave all tasks closed.',
      'Starting a task and completing it require separate accepted updates: pending -> in_progress -> completed.',
      'Complete at most one task per update; the active count shown for a tool call describes the proposed snapshot, not the accepted state.',
      'On Error, no changes were applied; use the accepted state shown in the error and retry one valid transition.',
      'Continue until no open task remains or the user explicitly cancels it.',
    ],
    parameters: Params,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      return run((effects) => effects.executeTodo(params), ctx, signal)
    },
    renderCall(args, theme) {
      const next = normalizeTodos(args.todos) ?? []
      const counts = getTodoCounts(next)
      return new Text(
        theme.fg('toolTitle', theme.bold('todowrite ')) +
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

      const list = normalizeTodos(details.todos) ?? []
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
      const lines = [theme.fg('muted', formatCounts(counts))]
      for (const todo of visible) {
        lines.push(renderTodoLine(todo, theme, true))
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
