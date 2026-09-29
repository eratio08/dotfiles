import type { Api, ImageContent, Model, Provider, TextContent } from '@earendil-works/pi-ai'
import type {
  AgentToolResult,
  BuildSystemPromptOptions,
  ExecOptions,
  ExecResult,
  ExtensionAPI,
  KeybindingsManager,
  ProviderConfig,
  SessionEntry,
  SessionTreeNode,
  Theme,
  ToolDefinition,
  ToolExecutionMode,
  ToolInfo,
} from '@earendil-works/pi-coding-agent'
import type {
  AutocompleteProvider,
  Component,
  EditorComponent,
  EditorTheme,
  OverlayOptions,
  TUI,
} from '@earendil-works/pi-tui'
import { Context, Effect, Option, Schema, type Scope, Semaphore } from 'effect'
import type { Static, TSchema } from 'typebox'
import type { PiExtensionError } from './extension.ts'

/** Optional abort signals supplied by Pi callbacks and callers. */
type PiInvocationSignals = readonly (AbortSignal | undefined)[]

/** Thinking level values accepted by Pi's extension API. */
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

/** Execution modes supported by Pi tool definitions. */
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
 * Error returned when a Pi operation fails.
 * `operation` names the failed Pi operation, and `cause` stores the original failure when available.
 */
class PiOperationsError extends Schema.TaggedError<PiOperationsError>()('PiOperationsError', {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Error returned when an operation requires UI that the current Pi mode does not provide.
 * It records the attempted operation and the current mode.
 */
class PiUiUnavailableError extends Schema.TaggedError<PiUiUnavailableError>()('PiUiUnavailableError', {
  operation: Schema.String,
  mode: Schema.String,
  message: Schema.String,
}) {}

/**
 * Error returned when an Effect tool fails during execution.
 * It records the tool name, operation, failure message, and optional original cause.
 */
class PiToolError extends Schema.TaggedError<PiToolError>()('PiToolError', {
  tool: Schema.String,
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/**
 * Converts an unknown failure cause to a readable message.
 * Uses `Error.message` for Error values and `String(cause)` for other values.
 * @param cause Failure value to convert.
 * @returns Readable error message.
 */
function piCauseMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/** Runs a synchronous callback and maps thrown failures to `PiOperationsError`. */
const piOperationTry = Effect.fnUntraced(function* <A>(
  operation: string,
  evaluate: () => A,
): Effect.fn.Return<A, PiOperationsError> {
  return yield* Effect.try({
    try: evaluate,
    catch: (cause: unknown) => new PiOperationsError({ operation, message: piCauseMessage(cause), cause }),
  })
})

/** Runs an asynchronous callback and maps rejected promises to `PiOperationsError`. */
const piOperationTryPromise = Effect.fnUntraced(function* <A>(
  operation: string,
  evaluate: (signal: AbortSignal) => Promise<A>,
): Effect.fn.Return<A, PiOperationsError> {
  return yield* Effect.tryPromise({
    try: (signal: AbortSignal) => evaluate(signal),
    catch: (cause: unknown) => new PiOperationsError({ operation, message: piCauseMessage(cause), cause }),
  })
})

/** Text or multimodal content accepted by Pi message operations. */
type PiContent = string | readonly (TextContent | ImageContent)[]

/** Custom message sent to the Pi session. */
type PiCustomMessage<TDetails = unknown> = {
  /** Custom message type used to select a renderer. */
  readonly customType: string
  /** Message content. */
  readonly content: PiContent
  /** Whether Pi displays the message in the conversation. */
  readonly display?: boolean
  /** Structured data stored with the message. */
  readonly details?: TDetails
}

/** Options for sending a custom message. */
type PiSendMessageOptions = {
  /** Whether sending the message starts an assistant turn. */
  readonly triggerTurn?: boolean
  /** How Pi delivers the message relative to the current turn. */
  readonly deliverAs?: 'steer' | 'followUp' | 'nextTurn'
}

/** Options for sending a user message to Pi. */
type PiSendUserMessageOptions = {
  /** How Pi delivers the message relative to the current turn. */
  readonly deliverAs?: 'steer' | 'followUp'
}

/** Effect operations for sending custom and user messages to Pi. */
type PiMessagesService = {
  /** Sends a custom message to the current session. */
  readonly sendMessage: <TDetails>(
    message: PiCustomMessage<TDetails>,
    options?: PiSendMessageOptions,
  ) => Effect.Effect<void, PiOperationsError>
  /** Sends a user message to the current session. */
  readonly sendUserMessage: (
    content: PiContent,
    options?: PiSendUserMessageOptions,
  ) => Effect.Effect<void, PiOperationsError>
}

/**
 * Creates the Pi messages service from PiOperations.
 * @param operations Low-level Pi operations that send messages.
 * @returns The Pi messages service.
 */
const createPiMessagesService = (operations: PiOperationsService): PiMessagesService => ({
  sendMessage: operations.sendMessage,
  sendUserMessage: operations.sendUserMessage,
})

/** Service tag for sending messages to Pi. */
class PiMessages extends Context.Service<PiMessages, PiMessagesService>()('pi-effect/PiMessages') {}

/** Effect operation for running a process through Pi. */
type PiProcessService = {
  /** Runs a process and returns its output and exit status. */
  readonly exec: (
    command: string,
    args: readonly string[],
    options?: ExecOptions,
  ) => Effect.Effect<ExecResult, PiOperationsError>
}

/**
 * Creates the Pi process service from PiOperations.
 * @param operations Low-level Pi operations that run processes.
 * @returns The Pi process service.
 */
const createPiProcessService = (operations: PiOperationsService): PiProcessService => ({ exec: operations.exec })

/** Service tag for running processes through Pi. */
class PiProcess extends Context.Service<PiProcess, PiProcessService>()('pi-effect/PiProcess') {}

/** Tool result content and optional structured details returned by an Effect tool. */
type PiToolResult<Details = unknown> = Pick<AgentToolResult<Details>, 'content' | 'details'>

/** Pi tool definition whose execution runs as an Effect and can request extension services. */
type EffectToolDefinition<Params extends TSchema, Services, Failure, Details = unknown> = Omit<
  ToolDefinition<Params, Details>,
  'execute'
> & {
  /** Short prompt text that describes the tool to the model. */
  readonly promptSnippet: string
  /** Rules that guide when and how the model uses the tool. */
  readonly promptGuidelines: readonly string[]
  /** Runs the tool with parameters defined by `Params`. */
  readonly execute: (params: Static<Params>) => Effect.Effect<PiToolResult<Details>, Failure, Services | PiToolContext>
}

/** Effect operations for reading and replacing the active tool list. */
type PiToolsService = {
  /** Reads the active tool names. */
  readonly active: () => Effect.Effect<readonly string[], PiOperationsError>
  /** Reads metadata for all tools known to Pi. */
  readonly all: () => Effect.Effect<readonly ToolInfo[], PiOperationsError>
  /** Replaces the active tool list. */
  readonly replaceActive: (toolNames: readonly string[]) => Effect.Effect<void, PiOperationsError>
}

/**
 * Creates the Pi tools service and serializes active-tool replacements.
 * @param operations Low-level Pi operations for reading and replacing tools.
 * @returns The Pi tools service.
 */
const createPiToolsService = (operations: PiOperationsService): PiToolsService => {
  const semaphore = Semaphore.makeUnsafe(1)
  return {
    active: operations.getActiveTools,
    all: operations.getAllTools,
    replaceActive: (toolNames: readonly string[]) =>
      semaphore
        .withPermit(operations.setActiveTools(toolNames))
        .pipe(
          Effect.mapError((cause) =>
            cause instanceof PiOperationsError
              ? cause
              : new PiOperationsError({ operation: 'setActiveTools', message: piCauseMessage(cause), cause }),
          ),
        ),
  }
}

/** Service tag for reading and replacing active tools. */
class PiTools extends Context.Service<PiTools, PiToolsService>()('pi-effect/PiTools') {}

/** Effect operation for reading a boolean or string Pi flag. */
type PiFlagsService = {
  /** Reads a flag by name, or returns `undefined` when it is not set. */
  readonly get: (name: string) => Effect.Effect<boolean | string | undefined, PiOperationsError>
}

/**
 * Creates the Pi flags service from PiOperations.
 * @param operations Low-level Pi operations that read flags.
 * @returns The Pi flags service.
 */
const createPiFlagsService = (operations: PiOperationsService): PiFlagsService => ({ get: operations.getFlag })

/** Service tag for reading Pi flags. */
class PiFlags extends Context.Service<PiFlags, PiFlagsService>()('pi-effect/PiFlags') {}

type EffectSuccess<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never

type PiComponentWithDispose = Component & { dispose?: () => void }
type PiWidgetFactory = (tui: TUI, theme: Theme) => PiComponentWithDispose
type PiFooterFactory = (tui: TUI, theme: Theme, footerData: unknown) => PiComponentWithDispose
type PiHeaderFactory = (tui: TUI, theme: Theme) => PiComponentWithDispose

/** Cancellation and timeout options for interactive UI dialogs. */
type PiUiDialogOptions = {
  /** Signal that cancels the dialog when aborted. */
  readonly signal?: AbortSignal
  /** Dialog timeout in milliseconds. */
  readonly timeout?: number
}

/** Placement options for a terminal UI widget. */
type PiWidgetOptions = {
  /** Whether the widget appears above or below the editor. */
  readonly placement?: 'aboveEditor' | 'belowEditor'
}

/** Animation settings for the Pi working indicator. */
type PiWorkingIndicatorOptions = {
  /** Frames shown by the indicator. */
  readonly frames?: readonly string[]
  /** Delay between frames in milliseconds. */
  readonly intervalMs?: number
}

/**
 * Factory for a custom terminal UI component that completes with a value of type `A`.
 * @param tui Active terminal UI instance.
 * @param theme Theme used to draw the component.
 * @param keybindings Keybinding manager available to the component.
 * @param done Completes the custom UI operation with a result.
 */
type PiCustomFactory<A> = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (result: A) => void,
) => PiComponentWithDispose | Promise<PiComponentWithDispose>

/** Effect-based Pi UI operations. Interactive operations can fail when UI is unavailable. */
type PiUiService = {
  /** Opens a selection dialog and returns the selected option, or `undefined` when cancelled.
   * Fails with `PiUiUnavailableError` when UI is unavailable.
   */
  readonly select: (
    title: string,
    options: readonly string[],
    dialog?: PiUiDialogOptions,
  ) => Effect.Effect<string | undefined, PiUiUnavailableError | PiOperationsError>
  /** Opens a confirmation dialog and returns the user's choice.
   * Fails with `PiUiUnavailableError` when UI is unavailable.
   */
  readonly confirm: (
    title: string,
    message: string,
    dialog?: PiUiDialogOptions,
  ) => Effect.Effect<boolean, PiUiUnavailableError | PiOperationsError>
  /** Opens a text-input dialog and returns its value, or `undefined` when cancelled.
   * Fails with `PiUiUnavailableError` when UI is unavailable.
   */
  readonly input: (
    title: string,
    placeholder?: string,
    dialog?: PiUiDialogOptions,
  ) => Effect.Effect<string | undefined, PiUiUnavailableError | PiOperationsError>
  /** Shows a notification when UI is available; otherwise does nothing. */
  readonly notify: (message: string, type?: 'info' | 'warning' | 'error') => Effect.Effect<void, PiOperationsError>
  /** Registers a terminal-input handler and returns an unsubscribe function.
   * Fails with `PiUiUnavailableError` when UI is unavailable or the mode is not `tui`.
   */
  readonly onTerminalInput: (
    handler: (data: string) => { consume?: boolean; data?: string } | undefined,
  ) => Effect.Effect<() => void, PiOperationsError | PiUiUnavailableError>
  /** Sets or clears a status item when UI is available. */
  readonly setStatus: (key: string, text: string | undefined) => Effect.Effect<void, PiOperationsError>
  /** Sets the working message when UI is available. */
  readonly setWorkingMessage: (message?: string) => Effect.Effect<void, PiOperationsError>
  /** Shows or hides the working indicator when UI is available. */
  readonly setWorkingVisible: (visible: boolean) => Effect.Effect<void, PiOperationsError>
  /** Sets the working indicator animation when UI is available. */
  readonly setWorkingIndicator: (options?: PiWorkingIndicatorOptions) => Effect.Effect<void, PiOperationsError>
  /** Sets or clears a widget when UI is available. */
  readonly setWidget: (
    key: string,
    content: readonly string[] | PiWidgetFactory | undefined,
    options?: PiWidgetOptions,
  ) => Effect.Effect<void, PiOperationsError>
  /** Sets or clears a custom footer when UI is available. */
  readonly setFooter: (factory: PiFooterFactory | undefined) => Effect.Effect<void, PiOperationsError>
  /** Sets or clears a custom header when UI is available. */
  readonly setHeader: (factory: PiHeaderFactory | undefined) => Effect.Effect<void, PiOperationsError>
  /** Sets the terminal title when UI is available. */
  readonly setTitle: (title: string) => Effect.Effect<void, PiOperationsError>
  /** Opens a custom terminal UI component and returns an `Option` result.
   * The result is `Some` when the component calls `done`.
   * Fails with `PiUiUnavailableError` when UI is unavailable or the mode is not `tui`.
   */
  readonly custom: <A>(
    factory: PiCustomFactory<A>,
    options?: { readonly overlay?: boolean; readonly overlayOptions?: OverlayOptions },
  ) => Effect.Effect<Option.Option<A>, PiUiUnavailableError | PiOperationsError>
  /** Pastes text into the editor when UI is available. */
  readonly pasteToEditor: (text: string) => Effect.Effect<void, PiOperationsError>
  /** Replaces the editor text when UI is available. */
  readonly setEditorText: (text: string) => Effect.Effect<void, PiOperationsError>
  /** Reads the current editor text. */
  readonly getEditorText: () => Effect.Effect<string, PiOperationsError>
  /** Opens the full editor and returns its text, or `undefined` when cancelled.
   * Fails with `PiUiUnavailableError` when UI is unavailable or the mode is not `tui`.
   */
  readonly editor: (
    title: string,
    prefill?: string,
  ) => Effect.Effect<string | undefined, PiUiUnavailableError | PiOperationsError>
  /** Adds or wraps an autocomplete provider. */
  readonly addAutocompleteProvider: (
    factory: (current: AutocompleteProvider) => AutocompleteProvider,
  ) => Effect.Effect<void, PiOperationsError>
  /** Sets the custom terminal UI editor component.
   * Fails with `PiUiUnavailableError` when UI is unavailable or the mode is not `tui`.
   */
  readonly setEditorComponent: (
    factory: ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) | undefined,
  ) => Effect.Effect<void, PiUiUnavailableError | PiOperationsError>
  /** Reads the custom terminal UI editor component factory, if one is set. */
  readonly getEditorComponent: () => Effect.Effect<
    ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) | undefined,
    PiOperationsError
  >
  /** Reads the active theme, if Pi has one. */
  readonly theme: () => Effect.Effect<Theme | undefined, PiOperationsError>
  /** Lists available themes and their optional file paths. */
  readonly getAllThemes: () => Effect.Effect<
    readonly { readonly name: string; readonly path: string | undefined }[],
    PiOperationsError
  >
  /** Reads a theme by name, if it is available. */
  readonly getTheme: (name: string) => Effect.Effect<Theme | undefined, PiOperationsError>
  /** Selects a theme by name or theme value and reports success or an error. */
  readonly setTheme: (
    theme: string | Theme,
  ) => Effect.Effect<{ readonly success: boolean; readonly error?: string }, PiOperationsError>
  /** Reads the expanded state without wrapping the value in an Effect. */
  readonly getToolsExpandedValue: () => boolean
  /** Reads whether Pi expands tool output. */
  readonly getToolsExpanded: () => Effect.Effect<boolean, PiOperationsError>
  /** Sets whether Pi expands tool output. */
  readonly setToolsExpanded: (expanded: boolean) => Effect.Effect<void, PiOperationsError>
}

/** Adapter contract for the UI operations used by the Effect UI service. */
type PiUiAdapter = {
  readonly select: (...args: Parameters<PiUiService['select']>) => Promise<string | undefined>
  readonly confirm: (...args: Parameters<PiUiService['confirm']>) => Promise<boolean>
  readonly input: (...args: Parameters<PiUiService['input']>) => Promise<string | undefined>
  readonly notify: (...args: Parameters<PiUiService['notify']>) => void
  readonly onTerminalInput: (...args: Parameters<PiUiService['onTerminalInput']>) => () => void
  readonly setStatus: (...args: Parameters<PiUiService['setStatus']>) => void
  readonly setWorkingMessage: (...args: Parameters<PiUiService['setWorkingMessage']>) => void
  readonly setWorkingVisible: (...args: Parameters<PiUiService['setWorkingVisible']>) => void
  readonly setWorkingIndicator: (...args: Parameters<PiUiService['setWorkingIndicator']>) => void
  readonly setWidget: (...args: Parameters<PiUiService['setWidget']>) => void
  readonly setFooter: (...args: Parameters<PiUiService['setFooter']>) => void
  readonly setHeader: (...args: Parameters<PiUiService['setHeader']>) => void
  readonly setTitle: (...args: Parameters<PiUiService['setTitle']>) => void
  readonly custom: <A>(
    factory: PiCustomFactory<A>,
    options?: Parameters<PiUiService['custom']>[1],
  ) => Effect.Effect<A, PiOperationsError | PiUiUnavailableError>
  readonly pasteToEditor: (...args: Parameters<PiUiService['pasteToEditor']>) => void
  readonly setEditorText: (...args: Parameters<PiUiService['setEditorText']>) => void
  readonly getEditorText: () => string
  readonly editor: (...args: Parameters<PiUiService['editor']>) => Promise<string | undefined>
  readonly addAutocompleteProvider: (...args: Parameters<PiUiService['addAutocompleteProvider']>) => void
  readonly setEditorComponent: (...args: Parameters<PiUiService['setEditorComponent']>) => void
  readonly getEditorComponent: () => EffectSuccess<ReturnType<PiUiService['getEditorComponent']>>
  readonly theme: EffectSuccess<ReturnType<PiUiService['theme']>>
  readonly getAllThemes: () => EffectSuccess<ReturnType<PiUiService['getAllThemes']>>
  readonly getTheme: (
    ...args: Parameters<PiUiService['getTheme']>
  ) => EffectSuccess<ReturnType<PiUiService['getTheme']>>
  readonly setTheme: (
    ...args: Parameters<PiUiService['setTheme']>
  ) => EffectSuccess<ReturnType<PiUiService['setTheme']>>
  readonly getToolsExpanded: () => EffectSuccess<ReturnType<PiUiService['getToolsExpanded']>>
  readonly setToolsExpanded: (...args: Parameters<PiUiService['setToolsExpanded']>) => void
}

/**
 * Creates UI operations that respect the invocation's UI availability and execution mode.
 * Interactive operations fail with `PiUiUnavailableError` when the required UI mode is unavailable.
 * @param context Invocation values that describe the Pi mode, UI availability, and abort signal.
 * @param ui Functions that call the underlying Pi UI.
 * @returns Effect-based UI operations for the invocation.
 */
function createPiUiService(context: PiContextValue, ui: PiUiAdapter): PiUiService {
  const unavailable = (operation: string): Effect.Effect<never, PiUiUnavailableError> =>
    Effect.fail(
      new PiUiUnavailableError({ operation, mode: context.mode, message: `UI is unavailable for ${context.mode}.` }),
    )
  const requireUI = <A, E>(
    operation: string,
    effect: Effect.Effect<A, E>,
  ): Effect.Effect<A, PiUiUnavailableError | E> => (context.hasUI ? effect : unavailable(operation))
  const requireTui = <A, E>(
    operation: string,
    effect: Effect.Effect<A, E>,
  ): Effect.Effect<A, PiUiUnavailableError | E> =>
    context.mode === 'tui' && context.hasUI ? effect : unavailable(operation)
  const sync = <A>(operation: string, evaluate: () => A): Effect.Effect<A, PiOperationsError> =>
    piOperationTry(operation, evaluate)
  const promise = <A>(
    operation: string,
    evaluate: (signal: AbortSignal) => Promise<A>,
  ): Effect.Effect<A, PiOperationsError> => piOperationTryPromise(operation, evaluate)
  const dialogOptions = (
    dialog: Parameters<PiUiAdapter['select']>[2],
    signal: AbortSignal,
  ): Parameters<PiUiAdapter['select']>[2] => ({
    ...dialog,
    signal: combinePiAbortSignals(dialog?.signal, context.signal, signal),
  })

  return {
    select: (
      title: string,
      options: Parameters<PiUiService['select']>[1],
      dialog?: Parameters<PiUiService['select']>[2],
    ) =>
      requireUI(
        'select',
        promise('select', (signal) => ui.select(title, options, dialogOptions(dialog, signal))),
      ),
    confirm: (
      title: string,
      message: Parameters<PiUiService['confirm']>[1],
      dialog?: Parameters<PiUiService['confirm']>[2],
    ) =>
      requireUI(
        'confirm',
        promise('confirm', (signal) => ui.confirm(title, message, dialogOptions(dialog, signal))),
      ),
    input: (
      title: string,
      placeholder?: Parameters<PiUiService['input']>[1],
      dialog?: Parameters<PiUiService['input']>[2],
    ) =>
      requireUI(
        'input',
        promise('input', (signal) => ui.input(title, placeholder, dialogOptions(dialog, signal))),
      ),
    notify: (message: string, type?: Parameters<PiUiService['notify']>[1]) =>
      context.hasUI ? sync('notify', () => ui.notify(message, type)) : Effect.succeed(undefined),
    onTerminalInput: (handler: Parameters<PiUiService['onTerminalInput']>[0]) =>
      requireTui(
        'onTerminalInput',
        sync('onTerminalInput', () => ui.onTerminalInput(handler)),
      ),
    setStatus: (key: string, text: Parameters<PiUiService['setStatus']>[1]) =>
      context.hasUI ? sync('setStatus', () => ui.setStatus(key, text)) : Effect.succeed(undefined),
    setWorkingMessage: (message: string | undefined) =>
      context.hasUI ? sync('setWorkingMessage', () => ui.setWorkingMessage(message)) : Effect.succeed(undefined),
    setWorkingVisible: (visible: boolean) =>
      context.hasUI ? sync('setWorkingVisible', () => ui.setWorkingVisible(visible)) : Effect.succeed(undefined),
    setWorkingIndicator: (options: Parameters<PiUiService['setWorkingIndicator']>[0]) =>
      context.hasUI ? sync('setWorkingIndicator', () => ui.setWorkingIndicator(options)) : Effect.succeed(undefined),
    setWidget: (
      key: string,
      content: Parameters<PiUiService['setWidget']>[1],
      options?: Parameters<PiUiService['setWidget']>[2],
    ) => (context.hasUI ? sync('setWidget', () => ui.setWidget(key, content, options)) : Effect.succeed(undefined)),
    setFooter: (factory: Parameters<PiUiService['setFooter']>[0]) =>
      context.hasUI ? sync('setFooter', () => ui.setFooter(factory)) : Effect.succeed(undefined),
    setHeader: (factory: Parameters<PiUiService['setHeader']>[0]) =>
      context.hasUI ? sync('setHeader', () => ui.setHeader(factory)) : Effect.succeed(undefined),
    setTitle: (title: string) =>
      context.hasUI ? sync('setTitle', () => ui.setTitle(title)) : Effect.succeed(undefined),
    custom: <A>(factory: PiCustomFactory<A>, options?: Parameters<PiUiService['custom']>[1]) =>
      requireTui('custom', ui.custom(factory, options).pipe(Effect.map(Option.some))),
    pasteToEditor: (text: string) =>
      context.hasUI ? sync('pasteToEditor', () => ui.pasteToEditor(text)) : Effect.succeed(undefined),
    setEditorText: (text: string) =>
      context.hasUI ? sync('setEditorText', () => ui.setEditorText(text)) : Effect.succeed(undefined),
    getEditorText: () => sync('getEditorText', () => ui.getEditorText()),
    editor: (title: string, prefill?: Parameters<PiUiService['editor']>[1]) =>
      requireTui(
        'editor',
        promise('editor', () => ui.editor(title, prefill)),
      ),
    addAutocompleteProvider: (factory: Parameters<PiUiService['addAutocompleteProvider']>[0]) =>
      context.hasUI
        ? sync('addAutocompleteProvider', () => ui.addAutocompleteProvider(factory))
        : Effect.succeed(undefined),
    setEditorComponent: (factory: Parameters<PiUiService['setEditorComponent']>[0]) =>
      requireTui(
        'setEditorComponent',
        sync('setEditorComponent', () => ui.setEditorComponent(factory)),
      ),
    getEditorComponent: () => sync('getEditorComponent', () => ui.getEditorComponent()),
    theme: () => sync('theme', () => ui.theme),
    getAllThemes: () => sync('getAllThemes', () => ui.getAllThemes()),
    getTheme: (name: string) => sync('getTheme', () => ui.getTheme(name)),
    setTheme: (theme: Parameters<PiUiService['setTheme']>[0]) => sync('setTheme', () => ui.setTheme(theme)),
    getToolsExpandedValue: () => ui.getToolsExpanded(),
    getToolsExpanded: () => sync('getToolsExpanded', () => ui.getToolsExpanded()),
    setToolsExpanded: (expanded: boolean) => sync('setToolsExpanded', () => ui.setToolsExpanded(expanded)),
  }
}

/** Service tag for Pi UI operations. */
class PiUi extends Context.Service<PiUi, PiUiService>()('pi-effect/PiUi') {}

/** Typed Effect wrapper for Pi's extension event bus. */
type PiEventBus = {
  /** Emits data on a named event channel. */
  readonly emit: (channel: string, data: unknown) => Effect.Effect<void, PiOperationsError>
  /** Subscribes to a channel and returns an Effect that resolves to an unsubscribe Effect. */
  readonly on: (
    channel: string,
    handler: (data: unknown) => void,
  ) => Effect.Effect<Effect.Effect<void, PiOperationsError>, PiOperationsError>
  /** Subscribes to a channel until the current Effect scope closes. */
  readonly onScoped: (
    channel: string,
    handler: (data: unknown) => void,
  ) => Effect.Effect<void, PiOperationsError, Scope.Scope>
}

/** Low-level Pi operations used to build the higher-level services. */
type PiOperationsService = {
  /** Runs a process through Pi and returns its execution result. */
  readonly exec: (
    command: string,
    args: readonly string[],
    options?: ExecOptions,
  ) => Effect.Effect<ExecResult, PiOperationsError>
  /** Sends a custom message to the current session. */
  readonly sendMessage: <TDetails>(
    message: PiCustomMessage<TDetails>,
    options?: PiSendMessageOptions,
  ) => Effect.Effect<void, PiOperationsError>
  /** Sends a user message to the current session. */
  readonly sendUserMessage: (
    content: PiContent,
    options?: PiSendUserMessageOptions,
  ) => Effect.Effect<void, PiOperationsError>
  /** Appends custom data to the session history. */
  readonly appendEntry: <TData>(customType: string, data?: TData) => Effect.Effect<void, PiOperationsError>
  /** Sets the current session name. */
  readonly setSessionName: (name: string) => Effect.Effect<void, PiOperationsError>
  /** Reads the current session name, if one is set. */
  readonly getSessionName: () => Effect.Effect<string | undefined, PiOperationsError>
  /** Sets or clears the label for a session entry. */
  readonly setLabel: (entryId: string, label: string | undefined) => Effect.Effect<void, PiOperationsError>
  /** Reads the active tool names. */
  readonly getActiveTools: () => Effect.Effect<readonly string[], PiOperationsError>
  /** Reads metadata for all tools known to Pi. */
  readonly getAllTools: () => Effect.Effect<readonly ToolInfo[], PiOperationsError>
  /** Replaces the active tool list. */
  readonly setActiveTools: (toolNames: readonly string[]) => Effect.Effect<void, PiOperationsError>
  /** Reads a named boolean or string flag. */
  readonly getFlag: (name: string) => Effect.Effect<boolean | string | undefined, PiOperationsError>
  /** Selects the current model and reports whether Pi accepted it. */
  readonly setModel: (model: Model<Api>) => Effect.Effect<boolean, PiOperationsError>
  /** Reads the current thinking level. */
  readonly getThinkingLevel: () => Effect.Effect<PiThinkingLevel, PiOperationsError>
  /** Sets the current thinking level. */
  readonly setThinkingLevel: (level: PiThinkingLevel) => Effect.Effect<void, PiOperationsError>
  /** Registers a model provider with Pi. */
  readonly registerProvider: (
    provider: Provider | string,
    config?: ProviderConfig,
  ) => Effect.Effect<void, PiOperationsError>
  /** Removes a registered model provider by name. */
  readonly unregisterProvider: (name: string) => Effect.Effect<void, PiOperationsError>
  /** Event bus for extension-to-extension coordination. */
  readonly events: PiEventBus
}

type PiService = {
  readonly context: PiContext['Service']
  readonly sessionContext: PiSessionContext['Service']
  readonly commandContext: PiCommandContext['Service']
  readonly toolContext: PiToolContext['Service']
  readonly session: PiSession['Service']
  readonly messages: PiMessages['Service']
  readonly ui: PiUi['Service']
  readonly tools: PiTools['Service']
  readonly flags: PiFlags['Service']
  readonly process: PiProcess['Service']
  readonly events: PiEventBus
  readonly model: {
    readonly set: (model: Model<Api>) => Effect.Effect<boolean, PiOperationsError>
  }
}

/** Service tag for Pi operations. */
class PiOperations extends Context.Service<PiOperations, PiOperationsService>()('pi-effect/PiOperations') {}

/** Service tag for the facade that groups the available Pi services. */
class Pi extends Context.Service<Pi, PiService>()('pi-effect/Pi') {}

/** Stable services available to setup and every registered callback. */
type PiStableServices = PiMessages | PiTools | PiFlags | PiProcess

/** Services whose values or permissions depend on the current invocation. */
type PiInvocationServices = Pi | PiContext | PiSessionContext | PiCommandContext | PiToolContext | PiSession | PiUi

/** Union of stable and invocation-specific Pi service tags. */
type PiServices = PiStableServices | PiInvocationServices

export {
  combinePiAbortSignals,
  createPiFlagsService,
  createPiMessagesService,
  createPiProcessService,
  createPiSessionService,
  createPiToolsService,
  createPiUiService,
  type EffectToolDefinition,
  Pi,
  PiCommandContext,
  type PiCommandContextValue,
  type PiCompactOptions,
  type PiContent,
  PiContext,
  type PiContextUsage,
  type PiContextValue,
  type PiCustomFactory,
  type PiCustomMessage,
  type PiEventBus,
  PiFlags,
  type PiFlagsService,
  type PiInvocationServices,
  type PiInvocationSignals,
  PiMessages,
  type PiMessagesService,
  type PiMode,
  PiOperations,
  PiOperationsError,
  type PiOperationsService,
  PiProcess,
  type PiProcessService,
  type PiSendMessageOptions,
  type PiSendUserMessageOptions,
  type PiServices,
  PiSession,
  type PiSessionChangeOptions,
  type PiSessionChangeResult,
  PiSessionContext,
  type PiSessionContextValue,
  type PiSessionReplacement,
  type PiSessionService,
  type PiStableServices,
  type PiThinkingLevel,
  PiToolContext,
  type PiToolContextValue,
  PiToolError,
  type PiToolExecutionMode,
  type PiToolResult,
  PiTools,
  type PiToolsService,
  type PiToolUpdate,
  PiUi,
  type PiUiAdapter,
  type PiUiDialogOptions,
  type PiUiService,
  PiUiUnavailableError,
  type PiWidgetOptions,
  type PiWorkingIndicatorOptions,
  piCauseMessage,
  piOperationTry,
  piOperationTryPromise,
}
