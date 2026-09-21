import type { ExtensionAPI, ExtensionContext, Theme, ToolResultEvent } from '@earendil-works/pi-coding-agent'
import { keyHint } from '@earendil-works/pi-coding-agent'
import { Container, matchesKey, Text, truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { type Static, Type } from 'typebox'
import {
  TodoContext,
  TodoEffects,
  TodoEffectsLayer,
  type TodoEffectsRequirements,
  TodoPi,
  type TodoProgramParams,
  TodoStatusRequestVersion,
  type TodoToolDetails,
  TodoUi,
  TodoUiError,
} from './src/effects.ts'
import { TODO_CODE_EXAMPLE, TODO_CODE_TYPES } from './src/evaluator.ts'
import { getTodoCounts, isOpenTodo, type Todo, type TodoStatus, todoDescriptionLines } from './src/state.ts'
import { TodoStore } from './src/store.ts'

const PLAN_SUBMIT_TOOL_NAME = 'plannotator_submit_plan'
const Params = Type.Object({
  code: Type.String({
    description: 'TypeScript module that exports a default async function receiving TodoApi.',
    minLength: 1,
  }),
})
type TodoToolParams = Static<typeof Params>

function toolExpandHint(): string {
  try {
    return keyHint('app.tools.expand', 'to expand')
  } catch {
    return 'to expand'
  }
}

type TodoOperationSummary = NonNullable<TodoToolDetails['summary']>
type TodoRendererState = { call?: Text; callText?: string; hasResult?: boolean; summary?: string }

function formatTodoOperationSummary(summary: TodoOperationSummary): string {
  const counters: Array<[keyof TodoOperationSummary, string]> = [
    ['added', 'added'],
    ['updated', 'updated'],
    ['started', 'started'],
    ['completed', 'completed'],
    ['omitted', 'omitted'],
    ['restored', 'restored'],
    ['cleared', 'cleared'],
  ]
  const parts = counters
    .filter(([operation]) => summary[operation] > 0)
    .map(([operation, label]) => `${label} ${summary[operation]}`)
  return parts.join(' · ') || 'no changes'
}

function isApprovedPlanSubmission(event: ToolResultEvent): boolean {
  if (event.toolName !== PLAN_SUBMIT_TOOL_NAME || event.isError) return false
  const details = event.details
  return !!details && typeof details === 'object' && (details as { approved?: unknown }).approved === true
}

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
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) this.onClose()
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

    lines.push('', truncateToWidth(`  ${this.theme.fg('dim', 'Press Escape to close')}`, width), '')
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

function renderTodoLine(todo: Todo, theme: Theme, depth = 0): string {
  const prefix = depth > 0 ? `${'  '.repeat(depth)}↳ ` : ''
  return `${prefix}${renderMarker(todo.status, theme)} ${renderContent(todo, theme)}`
}

function updateUi(ctx: ExtensionContext, todos: readonly Todo[], suspended = false): void {
  if (!ctx.hasUI) return
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
      const depths = getTodoDepths(todos)
      const expanded = ctx.ui.getToolsExpanded()
      const lines: string[] = []
      for (const todo of visible) {
        lines.push(truncateToWidth(`  ${renderTodoLine(todo, theme, depths.get(todo.id) ?? 0)}`, width))
        if (expanded) {
          const detailsIndent = '  '.repeat((depths.get(todo.id) ?? 0) + 2)
          for (const line of todoDescriptionLines(todo)) {
            for (const wrapped of wrapTextWithAnsi(line, Math.max(1, width - detailsIndent.length))) {
              lines.push(`${detailsIndent}${theme.fg('dim', wrapped)}`)
            }
          }
        }
      }
      if (unfinished.length > 8) lines.push(theme.fg('dim', `… ${unfinished.length - 8} more`))
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
  pi.on('session_tree', async (event, ctx) => {
    await run((effects) => effects.syncFromSession(event.summaryEntry !== undefined), ctx)
  })
  pi.on('before_agent_start', async (_event, ctx) => {
    await run((effects) => effects.syncFromSession(), ctx)
  })
  pi.on('input', async (_event, ctx) => {
    await run((effects) => effects.requestPlannotatorPhase(), ctx)
    return { action: 'continue' }
  })
  pi.on('tool_result', async (event, ctx) => {
    if (isApprovedPlanSubmission(event)) await run((effects) => effects.requestPlannotatorPhase(), ctx)
  })
  pi.on('agent_end', async (_event, ctx) => {
    await run((effects) => effects.handleAgentEnd(), ctx)
  })
  pi.on('session_compact', async (event, ctx) => {
    await run((effects) => effects.handleCompaction(event), ctx)
  })
  pi.on('session_shutdown', async (_event, ctx) => {
    if (shuttingDown) return
    shuttingDown = true
    try {
      await run((effects) => effects.clearTodoWidget(), ctx)
    } finally {
      await runtime.dispose()
    }
  })

  pi.registerTool({
    name: 'todo',
    label: 'Todo',
    description: 'Run TypeScript code that reads and updates the current todo plan as one transaction.',
    promptSnippet: 'Use todo for work with three or more distinct steps',
    promptGuidelines: [
      'Use todo for work with three or more distinct steps; skip trivial work.',
      `todo receives these TypeScript declarations:\n${TODO_CODE_TYPES}\ntodo example:\n${TODO_CODE_EXAMPLE}`,
      'Export a default async function that receives TodoApi.',
      'Create a dependency before the task that depends on it, and await mutation calls in order.',
      'Call next() once to start work; call show() to inspect an active task and complete() before starting another.',
    ],
    parameters: Params,
    executionMode: 'sequential',
    async execute(_toolCallId, params: TodoToolParams, signal, _onUpdate, ctx) {
      return run((effects) => effects.executeTodo(params as TodoProgramParams, signal), ctx, signal)
    },
    renderCall(_args, theme, context) {
      const state = (context.state ?? {}) as TodoRendererState
      const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0)
      state.call = text
      state.callText = theme.fg('toolTitle', theme.bold('todo'))
      const summary = !context.expanded && state.hasResult && state.summary ? ` · ${state.summary}` : ''
      const hint = !context.expanded && state.hasResult ? ` ${theme.fg('muted', `(${toolExpandHint()})`)}` : ''
      text.setText(`${state.callText}${summary}${hint}`)
      return text
    },
    renderResult(result, { expanded }, theme, context) {
      const state = (context.state ?? {}) as TodoRendererState
      const details = result.details as TodoToolDetails | undefined
      const output = details?.output ?? result.content.find((item) => item.type === 'text')?.text ?? ''
      const summary = details?.summary ? formatTodoOperationSummary(details.summary) : undefined
      state.hasResult = true
      state.summary = summary
      if (context.isError) return new Text(theme.fg('error', output), 0, 0)
      if (expanded) {
        const expandedSummary = summary ?? 'no changes'
        const code = details?.code ?? '[Submitted code unavailable]'
        const codeHeading = details?.codeTruncated ? 'Code (truncated)' : 'Code'
        const expandedOutput = ['Summary', expandedSummary, '', codeHeading, code, '', 'Result', output].join('\n')
        return new Text(theme.fg('toolOutput', expandedOutput), 0, 0)
      }
      if (state.call && state.callText) {
        const collapsedSummary = summary ? ` · ${summary}` : ''
        state.call.setText(`${state.callText}${collapsedSummary} ${theme.fg('muted', `(${toolExpandHint()})`)}`)
      }
      return new Container()
    },
  })

  pi.registerCommand('todos', {
    description: 'Show todos on the current branch',
    handler: async (_args, ctx) => {
      if (ctx.mode !== 'tui') {
        if (ctx.hasUI) ctx.ui.notify('/todos requires interactive mode', 'error')
        return
      }
      if (!ctx.hasUI) return
      await run((effects) => effects.showTodos(), ctx)
    },
  })
}

export { formatTodoOperationSummary, todoExtension as default }
