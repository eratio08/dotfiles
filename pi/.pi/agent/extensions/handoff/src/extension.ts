import type { Api, AssistantMessage, Message, Model } from '@earendil-works/pi-ai/compat'
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'
import { BorderedLoader, convertToLlm, serializeConversation } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, ManagedRuntime, Schema } from 'effect'

type SessionMessage = Extract<SessionEntry, { type: 'message' }>['message']

type CompactionMessage = {
  role: 'compactionSummary'
  summary: string
  tokensBefore: number
  timestamp: number
}

type HandoffMessage = SessionMessage | CompactionMessage

type HandoffRunResult =
  | { readonly status: 'completed'; readonly branchPointId: string }
  | { readonly status: 'cancelled'; readonly stage: 'generation' | 'navigation' }
  | { readonly status: 'skipped'; readonly reason: 'no-model' | 'no-conversation' }

type HandoffRestoreResult =
  | { readonly status: 'none' }
  | { readonly status: 'restored' }
  | { readonly status: 'warning'; readonly message: string }

const HANDOFF_MODEL_ENTRY = 'handoff-model'
const HANDOFF_MODEL_APPLIED_ENTRY = 'handoff-model-applied'

type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

type HandoffModelState = { provider: string; modelId: string; thinkingLevel: ThinkingLevel }

const THINKING_LEVELS: readonly ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === 'string' && THINKING_LEVELS.includes(value as ThinkingLevel)
}

function parseHandoffModelState(value: unknown): HandoffModelState | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const provider = (value as { provider?: unknown }).provider
  const modelId = (value as { modelId?: unknown }).modelId
  const thinkingLevel = (value as { thinkingLevel?: unknown }).thinkingLevel
  if (typeof provider !== 'string' || typeof modelId !== 'string' || !isThinkingLevel(thinkingLevel)) {
    return undefined
  }

  return { provider, modelId, thinkingLevel }
}

function getPendingHandoffModel(entries: readonly unknown[]): { id: string; state: HandoffModelState } | undefined {
  let pending: { id: string; state: HandoffModelState } | undefined
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || (entry as { type?: unknown }).type !== 'custom') {
      continue
    }

    const customType = (entry as { customType?: unknown }).customType
    if (customType === HANDOFF_MODEL_ENTRY) {
      const id = (entry as { id?: unknown }).id
      const state = parseHandoffModelState((entry as { data?: unknown }).data)
      pending = typeof id === 'string' && state ? { id, state } : undefined
      continue
    }
    if (customType === HANDOFF_MODEL_APPLIED_ENTRY && pending) {
      const sourceId = ((entry as { data?: unknown }).data as { sourceId?: unknown } | undefined)?.sourceId
      if (sourceId === pending.id) {
        pending = undefined
      }
    }
  }
  return pending
}

function runResultMessage(result: HandoffRunResult): { message: string; type: 'info' | 'error' } | undefined {
  if (result.status === 'cancelled') {
    return {
      message: result.stage === 'navigation' ? 'Branch cancelled' : 'Cancelled',
      type: 'info',
    }
  }
  if (result.status === 'skipped') {
    const messages = {
      'no-model': 'No model selected',
      'no-conversation': 'No conversation to hand off',
    } as const
    return { message: messages[result.reason], type: 'error' }
  }
  return undefined
}

function restoreResultMessage(result: HandoffRestoreResult): string | undefined {
  return result.status === 'warning' ? result.message : undefined
}

function entryToMessage(entry: SessionEntry): HandoffMessage | undefined {
  if (entry.type === 'message') {
    return entry.message
  }
  if (entry.type === 'compaction') {
    return {
      role: 'compactionSummary',
      summary: entry.summary,
      tokensBefore: entry.tokensBefore,
      timestamp: new Date(entry.timestamp).getTime(),
    }
  }
  return undefined
}

function getHandoffMessages(branch: readonly SessionEntry[]): HandoffMessage[] {
  let compactionIndex = -1
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].type === 'compaction') {
      compactionIndex = i
      break
    }
  }
  if (compactionIndex < 0) {
    return branch.map(entryToMessage).filter((message): message is HandoffMessage => message !== undefined)
  }

  const compaction = branch[compactionIndex]
  const firstKeptIndex =
    compaction.type === 'compaction' ? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId) : -1
  const compactedBranch = [
    compaction,
    ...(firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, compactionIndex) : []),
    ...branch.slice(compactionIndex + 1),
  ]
  return compactedBranch.map(entryToMessage).filter((message): message is HandoffMessage => message !== undefined)
}

function getBranchPointId(branch: readonly SessionEntry[]): string | undefined {
  return branch[0]?.id
}

function getPromptText(response: AssistantMessage): string {
  if (response.stopReason === 'error') {
    throw new Error(response.errorMessage ?? 'Handoff generation failed')
  }

  return response.content
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('\n')
    .trim()
}

const SYSTEM_PROMPT = `You are a context transfer assistant. Given a conversation history, generate a focused handoff prompt for a new thread that:

1. Summarizes relevant context from the conversation (decisions made, approaches taken, key findings)
2. Lists any relevant files that were discussed or modified
3. Is self-contained - the new thread should be able to proceed without the old conversation
4. Ends in a way that makes it natural for the user to add the next instruction

Format your response as a prompt the user can send to start the new thread. Be concise but include all necessary context. Do not include any preamble like "Here's the prompt" - just output the prompt itself.

Example output format:
## Context
We've been working on X. Key decisions:
- Decision 1
- Decision 2

Files involved:
- path/to/file1.ts
- path/to/file2.ts

I will give you the next instruction after you read this handoff.`

type TodoStateModule = typeof import('../../todo/src/extension.ts')

class HandoffGenerationError extends Schema.TaggedError<HandoffGenerationError>()('HandoffGenerationError', {
  message: Schema.String,
}) {}

class HandoffNavigationError extends Schema.TaggedError<HandoffNavigationError>()('HandoffNavigationError', {
  message: Schema.String,
}) {}

class HandoffPiError extends Schema.TaggedError<HandoffPiError>()('HandoffPiError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

class HandoffContext extends Context.Service<HandoffContext, ExtensionContext>()('handoff/ExtensionContext') {}

class HandoffCommandContext extends Context.Service<HandoffCommandContext, ExtensionCommandContext>()(
  'handoff/CommandContext',
) {}

class HandoffPi extends Context.Service<HandoffPi, ExtensionAPI>()('handoff/Pi') {}

type HandoffError = HandoffGenerationError | HandoffNavigationError | HandoffPiError

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function tryPi<A>(operation: string, evaluate: () => A): Effect.Effect<A, HandoffPiError> {
  return Effect.try({
    try: evaluate,
    catch: (cause: unknown) => new HandoffPiError({ operation, message: errorMessage(cause) }),
  })
}

const loadTodoState = Effect.tryPromise<TodoStateModule, string>({
  try: () => import('../../todo/src/extension.ts'),
  catch: errorMessage,
}).pipe(
  Effect.tapError((message) => Effect.logError(`[handoff] todo-state-import-failed: ${message}`)),
  Effect.catch(() => Effect.succeed<TodoStateModule | undefined>(undefined)),
)

const generatePrompt = Effect.fnUntraced(function* (
  selectedModel: Model<Api>,
  conversationText: string,
): Effect.fn.Return<string | null, HandoffGenerationError, HandoffCommandContext> {
  const ctx = yield* HandoffCommandContext
  return yield* Effect.tryPromise({
    try: async () => {
      let generationError: unknown
      let cancelled = false
      const result = await ctx.ui.custom<string | null>((tui, theme, _keybindings, done) => {
        let finished = false
        const finish = (value: string | null): void => {
          if (finished) {
            return
          }
          finished = true
          done(value)
        }
        const loader = new BorderedLoader(tui, theme, 'Generating handoff prompt...')
        loader.onAbort = () => {
          cancelled = true
          finish(null)
        }

        const doGenerate = async (): Promise<string | null> => {
          const userMessage: Message = {
            role: 'user',
            content: [{ type: 'text', text: `## Conversation History\n\n${conversationText}` }],
            timestamp: Date.now(),
          }

          const response = await ctx.modelRegistry.complete(
            selectedModel,
            { systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
            { signal: loader.signal, cacheRetention: 'none' },
          )
          if (response.stopReason === 'aborted' || loader.signal.aborted) {
            return null
          }

          const prompt = getPromptText(response)
          return prompt
        }

        void doGenerate()
          .then((prompt) => finish(prompt))
          .catch((error) => {
            if (!cancelled) {
              generationError = error
            }
            finish(null)
          })

        return loader
      })

      if (generationError && !cancelled) {
        throw generationError
      }
      return result
    },
    catch: (cause: unknown) => new HandoffGenerationError({ message: errorMessage(cause) }),
  }).pipe(Effect.tapError((error) => Effect.logError(`[handoff] generation-error: ${errorMessage(error)}`)))
})

const restoreModel = Effect.fnUntraced(function* (): Effect.fn.Return<
  HandoffRestoreResult,
  HandoffPiError,
  HandoffContext | HandoffPi
> {
  const pi = yield* HandoffPi
  const ctx = yield* HandoffContext
  const pending = yield* Effect.sync(() => getPendingHandoffModel(ctx.sessionManager.getBranch()))
  if (!pending) {
    return { status: 'none' as const }
  }

  const markApplied = (applied: boolean, reason?: string): Effect.Effect<void, HandoffPiError> =>
    tryPi('appendEntry', () => {
      pi.appendEntry(HANDOFF_MODEL_APPLIED_ENTRY, {
        sourceId: pending.id,
        applied,
        reason,
      })
    })

  const model = yield* Effect.sync(() => ctx.modelRegistry.find(pending.state.provider, pending.state.modelId))
  if (!model) {
    yield* markApplied(false, 'model-not-found')
    return {
      status: 'warning' as const,
      message: `Handoff model not found: ${pending.state.provider}/${pending.state.modelId}`,
    }
  }

  const modelResult = yield* Effect.match(
    Effect.tryPromise({
      try: () => pi.setModel(model),
      catch: (cause: unknown) => errorMessage(cause),
    }),
    {
      onFailure: (message: string) => ({ applied: false, reason: message }),
      onSuccess: (applied: boolean) => ({ applied, reason: applied ? undefined : 'auth-missing' }),
    },
  )
  if (!modelResult.applied) {
    yield* markApplied(false, modelResult.reason)
    return {
      status: 'warning' as const,
      message:
        modelResult.reason === 'auth-missing'
          ? `No API key for handoff model: ${pending.state.provider}/${pending.state.modelId}`
          : `Could not restore handoff model: ${modelResult.reason}`,
    }
  }

  const thinkingResult = yield* Effect.match(
    tryPi('setThinkingLevel', () => pi.setThinkingLevel(pending.state.thinkingLevel)),
    {
      onFailure: (error: HandoffPiError) => ({ applied: false, reason: error.message }),
      onSuccess: () => ({ applied: true, reason: undefined }),
    },
  )
  if (!thinkingResult.applied) {
    yield* markApplied(false, thinkingResult.reason)
    return { status: 'warning' as const, message: `Could not restore handoff model: ${thinkingResult.reason}` }
  }

  yield* markApplied(true)
  return { status: 'restored' as const }
})

const run = Effect.fnUntraced(function* (): Effect.fn.Return<
  HandoffRunResult,
  HandoffError,
  HandoffCommandContext | HandoffPi
> {
  const pi = yield* HandoffPi
  const ctx = yield* HandoffCommandContext
  yield* Effect.tryPromise({
    try: () => ctx.waitForIdle(),
    catch: (cause: unknown) => new HandoffPiError({ operation: 'waitForIdle', message: errorMessage(cause) }),
  })

  const selectedModel = ctx.model
  if (!selectedModel) {
    return { status: 'skipped' as const, reason: 'no-model' as const }
  }

  const branch = yield* Effect.sync(() => ctx.sessionManager.getBranch())
  const messages = getHandoffMessages(branch)
  if (messages.length === 0) {
    return { status: 'skipped' as const, reason: 'no-conversation' as const }
  }

  const branchPointId = getBranchPointId(branch)
  if (!branchPointId) {
    return { status: 'skipped' as const, reason: 'no-conversation' as const }
  }

  const todoState = yield* loadTodoState
  const handoffTodos = todoState?.getTodoHandoffSnapshot(todoState.extractLatestTodoSnapshot(branch)) ?? []
  const thinkingLevel = ctx.thinkingLevel ?? (yield* tryPi('getThinkingLevel', () => pi.getThinkingLevel()))
  const handoffModel: HandoffModelState = {
    provider: selectedModel.provider,
    modelId: selectedModel.id,
    thinkingLevel,
  }
  const conversationText = yield* tryPi('prepareConversation', () => serializeConversation(convertToLlm(messages)))

  const handoffPrompt = yield* generatePrompt(selectedModel, conversationText)
  if (!handoffPrompt) {
    return { status: 'cancelled' as const, stage: 'generation' as const }
  }

  const result = yield* Effect.tryPromise({
    try: () => ctx.navigateTree(branchPointId, { summarize: false }),
    catch: (cause: unknown) => new HandoffNavigationError({ message: errorMessage(cause) }),
  })
  if (result.cancelled) {
    return { status: 'cancelled' as const, stage: 'navigation' as const }
  }

  yield* tryPi('appendModelState', () => pi.appendEntry(HANDOFF_MODEL_ENTRY, handoffModel))
  if (todoState && handoffTodos.length > 0) {
    yield* tryPi('appendTodoState', () =>
      pi.appendEntry(todoState.TODO_STATE_ENTRY, {
        todos: handoffTodos,
      }),
    )
    yield* tryPi('sendTodoContext', () =>
      pi.sendMessage(
        {
          customType: 'todo',
          content: todoState.formatTodoContext(handoffTodos),
          display: false,
        },
        { triggerTurn: false },
      ),
    )
  }
  yield* tryPi('sendUserMessage', () => pi.sendUserMessage(handoffPrompt))
  return { status: 'completed' as const, branchPointId }
})

class HandoffEffects extends Context.Service<
  HandoffEffects,
  {
    readonly run: () => Effect.Effect<HandoffRunResult, HandoffError, HandoffCommandContext | HandoffPi>
    readonly restoreModel: () => Effect.Effect<HandoffRestoreResult, HandoffPiError, HandoffContext | HandoffPi>
  }
>()('handoff/HandoffEffects') {}

const HandoffEffectsLayer: Layer.Layer<HandoffEffects, never, never> = Layer.succeed(
  HandoffEffects,
  HandoffEffects.of({ run, restoreModel }),
)

function notify(ctx: ExtensionContext, message: string, type: 'info' | 'warning' | 'error'): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, type)
  }
}

function handoffExtension(pi: ExtensionAPI): void {
  const runtime = ManagedRuntime.make(Layer.mergeAll(HandoffEffectsLayer, Layer.succeed(HandoffPi, pi)))
  let shuttingDown = false

  const runCommand = (ctx: ExtensionCommandContext): Promise<HandoffRunResult> =>
    runtime.runPromise(
      HandoffEffects.use((effects) => effects.run()).pipe(Effect.provide(Layer.succeed(HandoffCommandContext, ctx))),
      { signal: ctx.signal },
    )

  const restoreModel = (ctx: ExtensionContext): Promise<HandoffRestoreResult> =>
    runtime.runPromise(
      HandoffEffects.use((effects) => effects.restoreModel()).pipe(Effect.provide(Layer.succeed(HandoffContext, ctx))),
      { signal: ctx.signal },
    )

  pi.on('before_agent_start', async (_event, ctx) => {
    if (shuttingDown) {
      return
    }

    try {
      const result = await restoreModel(ctx)
      const message = restoreResultMessage(result)
      if (message) {
        notify(ctx, message, 'warning')
      }
    } catch (error) {
      notify(ctx, error instanceof Error ? error.message : String(error), 'warning')
    }
  })

  pi.registerCommand('handoff', {
    description: 'Compact the current conversation so a fresh session can continue the work',
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (ctx.mode !== 'tui') {
        notify(ctx, 'handoff requires interactive mode', 'error')
        return
      }

      try {
        const result = await runCommand(ctx)
        const message = runResultMessage(result)
        if (message) {
          notify(ctx, message.message, message.type)
        }
      } catch (error) {
        notify(ctx, error instanceof Error ? error.message : 'Handoff failed', 'error')
      }
    },
  })

  pi.on('session_shutdown', async (_event, ctx) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    try {
      await runtime.runPromise(Effect.void, { signal: ctx.signal })
    } finally {
      await runtime.dispose()
    }
  })
}

export {
  getBranchPointId,
  getHandoffMessages,
  getPendingHandoffModel,
  getPromptText,
  HANDOFF_MODEL_APPLIED_ENTRY,
  HANDOFF_MODEL_ENTRY,
  HandoffCommandContext,
  HandoffContext,
  HandoffEffects,
  HandoffEffectsLayer,
  HandoffGenerationError,
  type HandoffMessage,
  type HandoffModelState,
  HandoffNavigationError,
  HandoffPi,
  HandoffPiError,
  type HandoffRestoreResult,
  type HandoffRunResult,
  handoffExtension as default,
  isThinkingLevel,
  parseHandoffModelState,
  restoreResultMessage,
  runResultMessage,
  type SessionMessage,
  type ThinkingLevel,
}
