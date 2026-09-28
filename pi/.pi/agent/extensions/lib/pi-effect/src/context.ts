import type { Api, Model } from '@earendil-works/pi-ai'
import type {
  BuildSystemPromptOptions,
  ExtensionAPI,
  SessionEntry,
  SessionTreeNode,
  ToolExecutionMode,
} from '@earendil-works/pi-coding-agent'
import { Context, Effect } from 'effect'
import { type PiExtensionError, PiOperationsError, type PiToolError, piCauseMessage } from './errors.ts'
import type { PiOperationsService } from './pi.ts'

/** Optional abort signals supplied by Pi callbacks and callers. */
type PiInvocationSignals = readonly (AbortSignal | undefined)[]

type PiThinkingLevel = Parameters<ExtensionAPI['setThinkingLevel']>[0]

/** Pi execution mode for the current extension invocation. */
type PiMode = 'tui' | 'rpc' | 'json' | 'print'

/** Token usage and percentage for the current context window. */
type PiContextUsage = {
  /** Current token count, or `null` when Pi cannot provide it. */
  readonly tokens: number | null
  /** Maximum token count for the current context window. */
  readonly contextWindow: number
  /** Current usage percentage, or `null` when Pi cannot provide it. */
  readonly percent: number | null
}

/** Snapshot of the current session and Effect operations for reading its state. */
type PiSessionContextValue = {
  /** Working directory associated with the session. */
  readonly cwd: string
  /** Pi session identifier. */
  readonly id: string
  /** Session file path, or `undefined` when the session has no file. */
  readonly file: string | undefined
  /** Directory that contains session data. */
  readonly directory: string
  /** Identifier of the current leaf entry, or `null` when the session is empty. */
  readonly leafId: string | null
  /** Current leaf entry, or `undefined` when the session is empty. */
  readonly leaf: SessionEntry | undefined
  /** Entries in the current session snapshot. */
  readonly entries: readonly SessionEntry[]
  /** Tree of session entries used for navigation. */
  readonly tree: readonly SessionTreeNode[]
  /** Reads one session entry by its identifier. */
  readonly entry: (id: string) => Effect.Effect<SessionEntry | undefined, PiOperationsError>
  /** Reads the branch for `fromId`, or the current leaf when `fromId` is omitted. */
  readonly branch: (fromId?: string) => Effect.Effect<readonly SessionEntry[], PiOperationsError>
  /** Reads the entries used to build the current model context. */
  readonly contextEntries: () => Effect.Effect<readonly SessionEntry[], PiOperationsError>
  /** Reads the label assigned to a session entry. */
  readonly label: (entryId: string) => Effect.Effect<string | undefined, PiOperationsError>
  /** Current session name, if one is set. */
  readonly name: string | undefined
}

/** Effect operations for reading and updating the current session. */
type PiSessionService = {
  /** Appends custom data to the session history. */
  readonly appendEntry: <TData>(customType: string, data?: TData) => Effect.Effect<void, PiOperationsError>
  /** Sets the current session name. */
  readonly setName: (name: string) => Effect.Effect<void, PiOperationsError>
  /** Reads the current session name, if one is set. */
  readonly getName: () => Effect.Effect<string | undefined, PiOperationsError>
  /** Sets or clears the label for a session entry. */
  readonly setLabel: (entryId: string, label: string | undefined) => Effect.Effect<void, PiOperationsError>
  /** Reads a session entry by its identifier. */
  readonly entry: (id: string) => Effect.Effect<SessionEntry | undefined, PiOperationsError>
  /** Reads the branch for `fromId`, or the current leaf when `fromId` is omitted. */
  readonly branch: (fromId?: string) => Effect.Effect<readonly SessionEntry[], PiOperationsError>
  /** Reads all entries in the current session. */
  readonly entries: () => Effect.Effect<readonly SessionEntry[], PiOperationsError>
  /** Reads the session tree used for navigation. */
  readonly tree: () => Effect.Effect<readonly SessionTreeNode[], PiOperationsError>
  /** Reads entries included in the current model context. */
  readonly contextEntries: () => Effect.Effect<readonly SessionEntry[], PiOperationsError>
}

/** Invocation context shared by command, tool, session, and event handlers. */
type PiContextValue = {
  /** Current Pi execution mode. */
  readonly mode: PiMode
  /** Whether Pi provides UI operations for this invocation. */
  readonly hasUI: boolean
  /** Working directory for the current extension invocation. */
  readonly cwd: string
  /** Abort signal for the current invocation, if Pi provides one. */
  readonly signal: AbortSignal | undefined
  /** Current model, if Pi has selected one. */
  readonly model: Model<Api> | undefined
  /** Current thinking level, if Pi has selected one. */
  readonly thinkingLevel: PiThinkingLevel | undefined
  /** Checks whether the agent is idle. */
  readonly isIdle: () => Effect.Effect<boolean, PiOperationsError>
  /** Checks whether the project is trusted. */
  readonly isProjectTrusted: () => Effect.Effect<boolean, PiOperationsError>
  /** Checks whether messages are waiting to be processed. */
  readonly hasPendingMessages: () => Effect.Effect<boolean, PiOperationsError>
  /** Reads context-window usage, if Pi can provide it. */
  readonly contextUsage: () => Effect.Effect<PiContextUsage | undefined, PiOperationsError>
  /** Requests that Pi abort the current agent operation. */
  readonly abort: () => Effect.Effect<void, PiOperationsError>
  /** Requests that Pi shut down the current process. */
  readonly shutdown: () => Effect.Effect<void, PiOperationsError>
  /** Requests context compaction with optional custom instructions. */
  readonly compact: (options?: PiCompactOptions) => Effect.Effect<void, PiOperationsError>
  /** Reads the system prompt for the current invocation. */
  readonly systemPrompt: () => Effect.Effect<string, PiOperationsError>
}

/** Options for compacting the current conversation. */
type PiCompactOptions = {
  /** Instructions Pi applies while creating the compacted context. */
  readonly customInstructions?: string
}

/** Result of a session operation that Pi can cancel. */
type PiSessionChangeResult = {
  /** Whether Pi cancelled the requested session operation. */
  readonly cancelled: boolean
}

/** Context values available after a session change. */
type PiSessionReplacement = {
  /** Command context for the replacement session. */
  readonly context: PiCommandContextValue
  /** Session snapshot for the replacement session. */
  readonly session: PiSessionContextValue
}

/** Options shared by session creation, fork, and switch operations. */
type PiSessionChangeOptions = {
  /** Parent session path used when creating a child session. */
  readonly parentSession?: string
  /** Position at which Pi inserts the new session entry. */
  readonly position?: 'before' | 'at'
  /** Effect that runs after Pi creates the new session. */
  readonly setup?: (session: PiSessionContextValue) => Effect.Effect<void, PiExtensionError>
  /** Effect that runs with context values for the new session. */
  readonly withSession?: (replacement: PiSessionReplacement) => Effect.Effect<void, PiExtensionError>
}

/** Invocation context and session operations available to command handlers. */
type PiCommandContextValue = PiContextValue & {
  /** Current session snapshot. */
  readonly session: PiSessionContextValue
  /** Reads the options used to build the current system prompt. */
  readonly systemPromptOptions: () => Effect.Effect<BuildSystemPromptOptions, PiOperationsError>
  /** Waits for the agent to become idle. */
  readonly waitForIdle: () => Effect.Effect<void, PiOperationsError>
  /** Creates a new session. */
  readonly newSession: (options?: PiSessionChangeOptions) => Effect.Effect<PiSessionChangeResult, PiOperationsError>
  /** Forks the session from the specified entry. */
  readonly fork: (
    entryId: string,
    options?: PiSessionChangeOptions,
  ) => Effect.Effect<PiSessionChangeResult, PiOperationsError>
  /** Navigates to a session-tree entry. */
  readonly navigateTree: (
    targetId: string,
    options?: {
      /** Whether Pi creates a summary while navigating. */
      readonly summarize?: boolean
      /** Custom instructions used when Pi creates a summary. */
      readonly customInstructions?: string
      /** Whether custom instructions replace the default instructions. */
      readonly replaceInstructions?: boolean
      /** Label assigned to the new tree entry. */
      readonly label?: string
    },
  ) => Effect.Effect<PiSessionChangeResult, PiOperationsError>
  /** Switches to the session at the given path. */
  readonly switchSession: (
    sessionPath: string,
    options?: PiSessionChangeOptions,
  ) => Effect.Effect<PiSessionChangeResult, PiOperationsError>
  /** Reloads the current session. */
  readonly reload: () => Effect.Effect<void, PiOperationsError>
}

/** Progress update sent from an Effect tool to Pi. */
type PiToolUpdate<TDetails = unknown> = {
  /** Text content displayed for this update. */
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  /** Structured data attached to the update. */
  readonly details?: TDetails
}

type PiToolExecutionMode = ToolExecutionMode

/** Invocation context available to an Effect tool. */
type PiToolContextValue = PiContextValue & {
  /** Current session snapshot. */
  readonly session: PiSessionContextValue
  /** Identifier of the current tool call. */
  readonly toolCallId: string
  /** Parameters supplied to the current tool. */
  readonly params: unknown
  /** Abort signal for the current tool call, if Pi provides one. */
  readonly toolSignal: AbortSignal | undefined
  /** Sends a progress update to Pi. */
  readonly onUpdate: (update: PiToolUpdate) => Effect.Effect<void, PiToolError>
  /** Execution mode selected for the current tool definition. */
  readonly executionMode: PiToolExecutionMode
}

/** Service tag for shared Pi invocation context. */
class PiContext extends Context.Service<PiContext, PiContextValue>()('pi-effect/PiContext') {}

/** Service tag for the current session snapshot and read operations. */
class PiSessionContext extends Context.Service<PiSessionContext, PiSessionContextValue>()(
  'pi-effect/PiSessionContext',
) {}

/** Service tag for session reads and updates. */
class PiSession extends Context.Service<PiSession, PiSessionService>()('pi-effect/PiSession') {}

/**
 * Creates the session service from Pi operations and the current session snapshot.
 * @param operations Low-level Pi operations used to change session state.
 * @param current Session snapshot used by read operations.
 * @returns The Pi session service.
 */
function createPiSessionService(operations: PiOperationsService, current: PiSessionContextValue): PiSessionService {
  return {
    appendEntry: operations.appendEntry,
    setName: operations.setSessionName,
    getName: operations.getSessionName,
    setLabel: operations.setLabel,
    entry: current.entry,
    branch: current.branch,
    entries: () =>
      Effect.try({
        try: () => current.entries,
        catch: (cause: unknown) =>
          new PiOperationsError({ operation: 'entries', message: piCauseMessage(cause), cause }),
      }),
    tree: () =>
      Effect.try({
        try: () => current.tree,
        catch: (cause: unknown) => new PiOperationsError({ operation: 'tree', message: piCauseMessage(cause), cause }),
      }),
    contextEntries: current.contextEntries,
  }
}

/** Service tag for command context and session-changing operations. */
class PiCommandContext extends Context.Service<PiCommandContext, PiCommandContextValue>()(
  'pi-effect/PiCommandContext',
) {}

/** Service tag for the current tool-call context. */
class PiToolContext extends Context.Service<PiToolContext, PiToolContextValue>()('pi-effect/PiToolContext') {}

/**
 * Combines defined signals so the result aborts when any input signal aborts.
 * Returns `undefined` when no signals are defined.
 * @param signals Optional signals from Pi and the caller.
 * @returns A combined signal, or `undefined` when no signals are defined.
 */
function combinePiAbortSignals(...signals: PiInvocationSignals): AbortSignal | undefined {
  const defined = signals.filter((signal): signal is AbortSignal => signal !== undefined)
  if (defined.length === 0) return undefined
  if (defined.length === 1) return defined[0]
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(defined)

  const controller = new AbortController()
  const abort = (): void => controller.abort()
  for (const signal of defined) {
    if (signal.aborted) {
      abort()
      break
    }
    signal.addEventListener('abort', abort, { once: true })
  }
  return controller.signal
}

/**
 * Provides invocation context to an Effect and removes `PiContext` from its requirements.
 * @param program Effect that requires `PiContext`.
 * @param context Context value provided to the Effect.
 * @returns The same Effect with `PiContext` removed from its requirements.
 */
function providePiContext<A, E, R>(
  program: Effect.Effect<A, E, R>,
  context: PiContextValue,
): Effect.Effect<A, E, Exclude<R, PiContext>> {
  return Effect.provideService(program, PiContext, context)
}

/**
 * Provides session context to an Effect and removes `PiSessionContext` from its requirements.
 * @param program Effect that requires `PiSessionContext`.
 * @param context Session context value provided to the Effect.
 * @returns The same Effect with `PiSessionContext` removed from its requirements.
 */
function providePiSessionContext<A, E, R>(
  program: Effect.Effect<A, E, R>,
  context: PiSessionContextValue,
): Effect.Effect<A, E, Exclude<R, PiSessionContext>> {
  return Effect.provideService(program, PiSessionContext, context)
}

/**
 * Provides command context to an Effect and removes `PiCommandContext` from its requirements.
 * @param program Effect that requires `PiCommandContext`.
 * @param context Command context value provided to the Effect.
 * @returns The same Effect with `PiCommandContext` removed from its requirements.
 */
function providePiCommandContext<A, E, R>(
  program: Effect.Effect<A, E, R>,
  context: PiCommandContextValue,
): Effect.Effect<A, E, Exclude<R, PiCommandContext>> {
  return Effect.provideService(program, PiCommandContext, context)
}

/**
 * Provides tool context to an Effect and removes `PiToolContext` from its requirements.
 * @param program Effect that requires `PiToolContext`.
 * @param context Tool context value provided to the Effect.
 * @returns The same Effect with `PiToolContext` removed from its requirements.
 */
function providePiToolContext<A, E, R>(
  program: Effect.Effect<A, E, R>,
  context: PiToolContextValue,
): Effect.Effect<A, E, Exclude<R, PiToolContext>> {
  return Effect.provideService(program, PiToolContext, context)
}

export {
  combinePiAbortSignals,
  createPiSessionService,
  PiCommandContext,
  type PiCommandContextValue,
  type PiCompactOptions,
  PiContext,
  type PiContextUsage,
  type PiContextValue,
  type PiInvocationSignals,
  type PiMode,
  PiSession,
  type PiSessionChangeOptions,
  type PiSessionChangeResult,
  PiSessionContext,
  type PiSessionContextValue,
  type PiSessionReplacement,
  type PiSessionService,
  type PiThinkingLevel,
  PiToolContext,
  type PiToolContextValue,
  type PiToolExecutionMode,
  type PiToolUpdate,
  providePiCommandContext,
  providePiContext,
  providePiSessionContext,
  providePiToolContext,
}
