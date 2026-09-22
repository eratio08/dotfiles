import { keyHint } from '@earendil-works/pi-coding-agent'
import { Container, matchesKey, Text, truncateToWidth, wrapTextWithAnsi } from '@earendil-works/pi-tui'
import {
  type EffectToolDefinition,
  PiContext,
  PiExtension,
  type PiServices,
  type PiTheme,
  type PiTui,
  PiUi,
} from '@eratio08/pi-effect'
import { Effect, Layer, Semaphore } from 'effect'
import { type Static, Type } from 'typebox'
import {
  TodoEffects,
  TodoEffectsLayer,
  type TodoProgramParams,
  TodoStatusRequestVersion,
  type TodoToolDetails,
  TodoUi,
  type TodoUiError,
  todoHostError,
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
type TodoOperationSummary = NonNullable<TodoToolDetails['summary']>
type TodoRendererState = {
  call?: { readonly setText: (text: string) => void }
  callText?: string
  hasResult?: boolean
  summary?: string
}
type TodoServices = TodoEffects | TodoStore | TodoStatusRequestVersion | TodoUi
type TodoRequirements = TodoServices | PiServices

function toolExpandHint(): string {
  try {
    return keyHint('app.tools.expand', 'to expand')
  } catch {
    return 'to expand'
  }
}

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

function isApprovedPlanSubmission(event: {
  readonly toolName: string
  readonly isError?: boolean
  readonly details?: unknown
}): boolean {
  if (event.toolName !== PLAN_SUBMIT_TOOL_NAME || event.isError) return false
  const details = event.details
  return !!details && typeof details === 'object' && (details as { approved?: unknown }).approved === true
}

class TodoViewer {
  private cachedWidth?: number
  private cachedLines?: string[]
  private readonly todos: readonly Todo[]
  private readonly theme: PiTheme
  private readonly onClose: () => void

  constructor(todos: readonly Todo[], theme: PiTheme, onClose: () => void) {
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

function updateUi(todos: readonly Todo[], suspended = false): Effect.Effect<void, TodoUiError, PiContext | PiUi> {
  return Effect.gen(function* () {
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

    yield* hostUi
      .setWidget('todo', (_tui: PiTui, theme: PiTheme) => ({
        render(width: number) {
          const visible = unfinished.slice(0, 8)
          const depths = getTodoDepths(todos)
          const lines: string[] = []
          for (const todo of visible) {
            lines.push(truncateToWidth(`  ${renderTodoLine(todo, theme, depths.get(todo.id) ?? 0)}`, width))
            if (Effect.runSync(hostUi.getToolsExpanded())) {
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
        invalidate() {},
      }))
      .pipe(Effect.mapError((cause) => todoHostError('update', cause)))
  })
}

const todoUiLayer: Layer.Layer<TodoUi, never, never> = Layer.succeed(
  TodoUi,
  TodoUi.of({
    update: (todos, suspended) => updateUi(todos, suspended),
    show: (todos) =>
      Effect.gen(function* () {
        const ui = yield* PiUi
        yield* ui
          .custom<void>((_tui, theme, _keybindings, done) => new TodoViewer(todos, theme, () => done()))
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
    return { value: 0, phaseLock: yield* Semaphore.make(1) }
  }),
)

const todoLayer = Layer.mergeAll(TodoStore.layer, todoUiLayer, statusRequestLayer, TodoEffectsLayer)
const todoTool: EffectToolDefinition<typeof Params, TodoRequirements, TodoUiError, TodoToolDetails> = {
  name: 'todo',
  label: 'Todo',
  description:
    'Run TypeScript code that reads and updates the current todo plan for non-trivial work with three or more tasks.',
  promptSnippet: 'Use todo only for non-trivial work with three or more tasks',
  promptGuidelines: [
    'Use todo only for non-trivial work with three or more tasks; skip trivial work.',
    `todo receives these TypeScript declarations:\n${TODO_CODE_TYPES}\ntodo example:\n${TODO_CODE_EXAMPLE}`,
    'Export a default async function that receives TodoApi.',
    'Create a dependency before the task that depends on it, and await mutation calls in order.',
    "Use show() to inspect up to five tasks, use show({ ids: [id] }) to select tasks by ID, and use show({ status: 'pending' }) to select tasks by status. Set limit to change the cap for broad and status queries. An explicit ID list returns every requested task.",
  ],
  parameters: Params,
  executionMode: 'sequential',
  execute: (params: TodoToolParams) =>
    Effect.gen(function* () {
      const effects = yield* TodoEffects
      return yield* effects.executeTodo(params as TodoProgramParams)
    }),
  renderCall(_args, theme, context) {
    const state = (context.state ?? {}) as TodoRendererState
    const text = new Text('', 0, 0)
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
}

const todoPlugin = PiExtension.define<TodoServices, TodoUiError>({
  id: 'todo',
  layer: todoLayer,
  effect: (registrations) =>
    Effect.gen(function* () {
      const effects = yield* TodoEffects
      yield* registrations.events.on('session_start', () => effects.syncFromSession().pipe(Effect.as(undefined)))
      yield* registrations.events.on('session_tree', (event) =>
        effects.syncFromSession(event.summaryEntry !== undefined).pipe(Effect.as(undefined)),
      )
      yield* registrations.events.on('before_agent_start', () => effects.syncFromSession().pipe(Effect.as(undefined)))
      yield* registrations.events.on('input', () =>
        effects.requestPlannotatorPhase().pipe(Effect.as({ action: 'continue' })),
      )
      yield* registrations.events.on('tool_result', (event) =>
        isApprovedPlanSubmission(event)
          ? effects.requestPlannotatorPhase().pipe(Effect.as(undefined))
          : Effect.succeed(undefined),
      )
      yield* registrations.events.on('agent_end', () => effects.handleAgentEnd().pipe(Effect.as(undefined)))
      yield* registrations.events.on('session_compact', (event) =>
        effects.handleCompaction(event).pipe(Effect.as(undefined)),
      )
      yield* registrations.events.on('session_shutdown', () => effects.clearTodoWidget().pipe(Effect.as(undefined)))
      yield* registrations.tools.register(todoTool)
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
    }),
})

const todoExtension = PiExtension.install(todoPlugin)

export { formatTodoOperationSummary, todoExtension as default }
