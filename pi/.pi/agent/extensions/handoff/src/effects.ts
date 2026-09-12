import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Api, Message, Model } from '@earendil-works/pi-ai/compat'
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionEntry,
} from '@earendil-works/pi-coding-agent'
import { BorderedLoader, convertToLlm, serializeConversation } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, Schema } from 'effect'
import {
  getPendingHandoffModel,
  HANDOFF_MODEL_APPLIED_ENTRY,
  HANDOFF_MODEL_ENTRY,
  type HandoffModelState,
} from '../handoff-model.ts'

const DEBUG_LOG = join(process.env.TMPDIR ?? '/tmp', 'pi-handoff-debug.log')

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

type SessionMessage = Extract<SessionEntry, { type: 'message' }>['message']
type CompactionMessage = {
  role: 'compactionSummary'
  summary: string
  tokensBefore: number
  timestamp: number
}
type HandoffMessage = SessionMessage | CompactionMessage
type TodoStateModule = typeof import('../../todo/src/state.ts')

export type HandoffRunResult =
  | { readonly status: 'completed'; readonly branchPointId: string }
  | { readonly status: 'cancelled'; readonly stage: 'generation' | 'navigation' }
  | { readonly status: 'skipped'; readonly reason: 'no-model' | 'no-conversation' }

export type HandoffRestoreResult =
  | { readonly status: 'none' }
  | { readonly status: 'restored' }
  | { readonly status: 'warning'; readonly message: string }

export class HandoffGenerationError extends Schema.TaggedError<HandoffGenerationError>()('HandoffGenerationError', {
  message: Schema.String,
}) {}

export class HandoffNavigationError extends Schema.TaggedError<HandoffNavigationError>()('HandoffNavigationError', {
  message: Schema.String,
}) {}

export class HandoffHostError extends Schema.TaggedError<HandoffHostError>()('HandoffHostError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

type HandoffError = HandoffGenerationError | HandoffNavigationError | HandoffHostError

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function debug(event: string, details: Record<string, unknown> = {}): Promise<void> {
  return appendFile(
    DEBUG_LOG,
    `${new Date().toISOString()} [DEBUG-handoff-38e1] ${event} ${JSON.stringify(details)}\n`,
  ).catch(() => undefined)
}

function tryHost<A>(operation: string, evaluate: () => A): Effect.Effect<A, HandoffHostError> {
  return Effect.try({
    try: evaluate,
    catch: (cause) => new HandoffHostError({ operation, message: errorMessage(cause) }),
  })
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

export function getHandoffMessages(branch: readonly SessionEntry[]): HandoffMessage[] {
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

export function getBranchPointId(branch: readonly SessionEntry[]): string | undefined {
  return branch[0]?.id
}

async function loadTodoState(): Promise<TodoStateModule | undefined> {
  try {
    return await import('../../todo/src/state.ts')
  } catch (error) {
    void debug('todo-state-import-failed', { message: errorMessage(error) })
    return undefined
  }
}

function getPromptText(response: { stopReason: string; errorMessage?: string; content: readonly unknown[] }): string {
  if (response.stopReason === 'error') {
    throw new Error(response.errorMessage ?? 'Handoff generation failed')
  }

  return response.content
    .filter((content): content is { type: 'text'; text: string } => {
      return typeof content === 'object' && content !== null && (content as { type?: unknown }).type === 'text'
    })
    .map((content) => content.text)
    .join('\n')
    .trim()
}

function generatePrompt(
  ctx: ExtensionCommandContext,
  selectedModel: Model<Api>,
  conversationText: string,
): Effect.Effect<string | null, HandoffGenerationError> {
  return Effect.tryPromise({
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
          void debug('loader-abort')
          finish(null)
        }

        const doGenerate = async (): Promise<string | null> => {
          const userMessage: Message = {
            role: 'user',
            content: [{ type: 'text', text: `## Conversation History\n\n${conversationText}` }],
            timestamp: Date.now(),
          }

          void debug('completion-start', { aborted: loader.signal.aborted })
          const response = await ctx.modelRegistry.complete(
            selectedModel,
            { systemPrompt: SYSTEM_PROMPT, messages: [userMessage] },
            { signal: loader.signal, cacheRetention: 'none' },
          )
          void debug('completion-finished', {
            stopReason: response.stopReason,
            error: response.errorMessage,
          })
          if (response.stopReason === 'aborted' || loader.signal.aborted) {
            return null
          }

          const prompt = getPromptText(response)
          void debug('prompt-generated', { length: prompt.length })
          return prompt
        }

        void doGenerate()
          .then((prompt) => {
            void debug('generation-resolved', { prompt: prompt !== null })
            finish(prompt)
          })
          .catch((error) => {
            if (!cancelled) {
              generationError = error
            }
            void debug('generation-error', { message: errorMessage(error) })
            finish(null)
          })

        return loader
      })

      if (generationError && !cancelled) {
        throw generationError
      }
      return result
    },
    catch: (cause) => new HandoffGenerationError({ message: errorMessage(cause) }),
  })
}

function restoreModel(pi: ExtensionAPI, ctx: ExtensionContext): Effect.Effect<HandoffRestoreResult, HandoffHostError> {
  return Effect.gen(function* () {
    const pending = yield* Effect.sync(() => getPendingHandoffModel(ctx.sessionManager.getBranch()))
    if (!pending) {
      return { status: 'none' as const }
    }

    const markApplied = (applied: boolean, reason?: string): Effect.Effect<void, HandoffHostError> =>
      tryHost('appendEntry', () => {
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
        catch: (cause) => errorMessage(cause),
      }),
      {
        onFailure: (message) => ({ applied: false, reason: message }),
        onSuccess: (applied) => ({ applied, reason: applied ? undefined : 'auth-missing' }),
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
      tryHost('setThinkingLevel', () => pi.setThinkingLevel(pending.state.thinkingLevel)),
      {
        onFailure: (error) => ({ applied: false, reason: error.message }),
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
}

export class HandoffEffects extends Context.Service<
  HandoffEffects,
  {
    readonly run: (ctx: ExtensionCommandContext) => Effect.Effect<HandoffRunResult, HandoffError>
    readonly restoreModel: (ctx: ExtensionContext) => Effect.Effect<HandoffRestoreResult, HandoffHostError>
  }
>()('handoff/HandoffEffects') {}

export function HandoffEffectsLayer(pi: ExtensionAPI): Layer.Layer<HandoffEffects, never, never> {
  return Layer.effect(
    HandoffEffects,
    Effect.succeed(
      HandoffEffects.of({
        run: (ctx) =>
          Effect.gen(function* () {
            yield* Effect.tryPromise({
              try: () => ctx.waitForIdle(),
              catch: (cause) => new HandoffHostError({ operation: 'waitForIdle', message: errorMessage(cause) }),
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

            const todoState = yield* Effect.promise(() => loadTodoState())
            const handoffTodos = todoState?.getTodoHandoffSnapshot(todoState.extractLatestTodoSnapshot(branch)) ?? []
            const handoffNumber =
              ctx.sessionManager
                .getEntries()
                .filter((entry) => entry.type === 'custom' && entry.customType === HANDOFF_MODEL_ENTRY).length + 1
            const handoffModel: HandoffModelState = {
              provider: selectedModel.provider,
              modelId: selectedModel.id,
              thinkingLevel: ctx.thinkingLevel ?? pi.getThinkingLevel(),
            }
            const conversationText = yield* tryHost('prepareConversation', () =>
              serializeConversation(convertToLlm(messages)),
            )

            void debug('handoff-start', {
              model: selectedModel.provider,
              messages: messages.length,
            })
            const handoffPrompt = yield* generatePrompt(ctx, selectedModel, conversationText)
            void debug('handoff-prompt-result', {
              prompt: handoffPrompt !== null,
              length: handoffPrompt?.length ?? 0,
            })
            if (!handoffPrompt) {
              return { status: 'cancelled' as const, stage: 'generation' as const }
            }

            const result = yield* Effect.tryPromise({
              try: () => ctx.navigateTree(branchPointId, { summarize: false }),
              catch: (cause) => new HandoffNavigationError({ message: errorMessage(cause) }),
            })
            if (result.cancelled) {
              return { status: 'cancelled' as const, stage: 'navigation' as const }
            }

            yield* tryHost('appendModelState', () => pi.appendEntry(HANDOFF_MODEL_ENTRY, handoffModel))
            if (todoState && handoffTodos.length > 0) {
              yield* tryHost('appendTodoState', () =>
                pi.sendMessage(
                  {
                    customType: 'todo',
                    content: todoState.formatTodoContext(handoffTodos),
                    display: false,
                    details: { todos: handoffTodos },
                  },
                  { triggerTurn: false },
                ),
              )
              const todoEntryId = ctx.sessionManager.getLeafId()
              if (todoEntryId) {
                yield* tryHost('labelTodoState', () => pi.setLabel(todoEntryId, `Handoff ${handoffNumber}`))
              }
            }
            yield* tryHost('sendUserMessage', () => pi.sendUserMessage(handoffPrompt))
            return { status: 'completed' as const, branchPointId }
          }),
        restoreModel: (ctx) => restoreModel(pi, ctx),
      }),
    ),
  )
}
