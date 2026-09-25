import type { Api, ImageContent, Model, Provider, TextContent } from '@earendil-works/pi-ai'
import type {
  BuildSystemPromptOptions,
  ExecOptions,
  ExecResult,
  ExtensionAPI,
  KeybindingsManager,
  ProviderConfig,
  SessionEntry,
  SessionTreeNode,
  Theme,
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
import { Context, type Effect, type Option, type Scope } from 'effect'
import type { PiExtensionError, PiHostError, PiToolError, PiUiUnavailableError } from './errors.ts'

/** Pi execution mode for the current extension invocation. */
type PiMode = 'tui' | 'rpc' | 'json' | 'print'
type PiThinkingLevel = Parameters<ExtensionAPI['setThinkingLevel']>[0]
/** Text or multimodal content accepted by Pi message operations. */
type PiContent = string | readonly (TextContent | ImageContent)[]
/** Tool execution mode reported by the Pi host. */
type PiToolExecutionMode = ToolExecutionMode

/** Token usage and percentage for the current context window. */
type PiContextUsage = {
  /** Current token count, or `null` when Pi cannot provide it. */
  readonly tokens: number | null
  /** Maximum token count for the current context window. */
  readonly contextWindow: number
  /** Current usage percentage, or `null` when Pi cannot provide it. */
  readonly percent: number | null
}

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
  readonly entry: (id: string) => Effect.Effect<SessionEntry | undefined, PiHostError>
  /** Reads the branch for `fromId`, or the current leaf when `fromId` is omitted. */
  readonly branch: (fromId?: string) => Effect.Effect<readonly SessionEntry[], PiHostError>
  /** Reads the entries used to build the current model context. */
  readonly contextEntries: () => Effect.Effect<readonly SessionEntry[], PiHostError>
  /** Reads the label assigned to a session entry. */
  readonly label: (entryId: string) => Effect.Effect<string | undefined, PiHostError>
  /** Current session name, if one is set. */
  readonly name: string | undefined
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
  readonly isIdle: () => Effect.Effect<boolean, PiHostError>
  /** Checks whether the project is trusted. */
  readonly isProjectTrusted: () => Effect.Effect<boolean, PiHostError>
  /** Checks whether messages are waiting to be processed. */
  readonly hasPendingMessages: () => Effect.Effect<boolean, PiHostError>
  /** Reads context-window usage, if Pi can provide it. */
  readonly contextUsage: () => Effect.Effect<PiContextUsage | undefined, PiHostError>
  /** Requests that Pi abort the current agent operation. */
  readonly abort: () => Effect.Effect<void, PiHostError>
  /** Requests that Pi shut down the current process. */
  readonly shutdown: () => Effect.Effect<void, PiHostError>
  /** Requests context compaction with optional custom instructions. */
  readonly compact: (options?: PiCompactOptions) => Effect.Effect<void, PiHostError>
  /** Reads the system prompt for the current invocation. */
  readonly systemPrompt: () => Effect.Effect<string, PiHostError>
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
  readonly systemPromptOptions: () => Effect.Effect<BuildSystemPromptOptions, PiHostError>
  /** Waits for the agent to become idle. */
  readonly waitForIdle: () => Effect.Effect<void, PiHostError>
  /** Creates a new session. */
  readonly newSession: (options?: PiSessionChangeOptions) => Effect.Effect<PiSessionChangeResult, PiHostError>
  /** Forks the session from the specified entry. */
  readonly fork: (
    entryId: string,
    options?: PiSessionChangeOptions,
  ) => Effect.Effect<PiSessionChangeResult, PiHostError>
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
  ) => Effect.Effect<PiSessionChangeResult, PiHostError>
  /** Switches to the session at the given path. */
  readonly switchSession: (
    sessionPath: string,
    options?: PiSessionChangeOptions,
  ) => Effect.Effect<PiSessionChangeResult, PiHostError>
  /** Reloads the current session. */
  readonly reload: () => Effect.Effect<void, PiHostError>
}

/** Progress update sent from an Effect tool to Pi. */
type PiToolUpdate<TDetails = unknown> = {
  /** Text content displayed for this update. */
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  /** Structured data attached to the update. */
  readonly details?: TDetails
}

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

/** Typed Effect wrapper for Pi's extension event bus. */
type PiHostEventBus = {
  /** Emits data on a named event channel. */
  readonly emit: (channel: string, data: unknown) => Effect.Effect<void, PiHostError>
  /** Subscribes to a channel and returns an Effect that resolves to an unsubscribe Effect. */
  readonly on: (
    channel: string,
    handler: (data: unknown) => void,
  ) => Effect.Effect<Effect.Effect<void, PiHostError>, PiHostError>
  /** Subscribes to a channel until the current Effect scope closes. */
  readonly onScoped: (
    channel: string,
    handler: (data: unknown) => void,
  ) => Effect.Effect<void, PiHostError, Scope.Scope>
}

/** Low-level Pi host operations used to build the higher-level services. */
type PiHostOperations = {
  /** Runs a process through Pi and returns its execution result. */
  readonly exec: (
    command: string,
    args: readonly string[],
    options?: ExecOptions,
  ) => Effect.Effect<ExecResult, PiHostError>
  /** Sends a custom message to the current session. */
  readonly sendMessage: <TDetails>(
    message: PiCustomMessage<TDetails>,
    options?: PiSendMessageOptions,
  ) => Effect.Effect<void, PiHostError>
  /** Sends a user message to the current session. */
  readonly sendUserMessage: (content: PiContent, options?: PiSendUserMessageOptions) => Effect.Effect<void, PiHostError>
  /** Appends custom data to the session history. */
  readonly appendEntry: <TData>(customType: string, data?: TData) => Effect.Effect<void, PiHostError>
  /** Sets the current session name. */
  readonly setSessionName: (name: string) => Effect.Effect<void, PiHostError>
  /** Reads the current session name, if one is set. */
  readonly getSessionName: () => Effect.Effect<string | undefined, PiHostError>
  /** Sets or clears the label for a session entry. */
  readonly setLabel: (entryId: string, label: string | undefined) => Effect.Effect<void, PiHostError>
  /** Reads the active tool names. */
  readonly getActiveTools: () => Effect.Effect<readonly string[], PiHostError>
  /** Reads metadata for all tools known to Pi. */
  readonly getAllTools: () => Effect.Effect<readonly ToolInfo[], PiHostError>
  /** Replaces the active tool list. */
  readonly setActiveTools: (toolNames: readonly string[]) => Effect.Effect<void, PiHostError>
  /** Reads a named boolean or string flag. */
  readonly getFlag: (name: string) => Effect.Effect<boolean | string | undefined, PiHostError>
  /** Selects the current model and reports whether Pi accepted it. */
  readonly setModel: (model: Model<Api>) => Effect.Effect<boolean, PiHostError>
  /** Reads the current thinking level. */
  readonly getThinkingLevel: () => Effect.Effect<PiThinkingLevel, PiHostError>
  /** Sets the current thinking level. */
  readonly setThinkingLevel: (level: PiThinkingLevel) => Effect.Effect<void, PiHostError>
  /** Registers a model provider with Pi. */
  readonly registerProvider: (provider: Provider | string, config?: ProviderConfig) => Effect.Effect<void, PiHostError>
  /** Removes a registered model provider by name. */
  readonly unregisterProvider: (name: string) => Effect.Effect<void, PiHostError>
  /** Event bus for extension-to-extension coordination. */
  readonly events: PiHostEventBus
}

/** Effect operations for reading and updating the current session. */
type PiSessionService = {
  /** Appends custom data to the session history. */
  readonly appendEntry: <TData>(customType: string, data?: TData) => Effect.Effect<void, PiHostError>
  /** Sets the current session name. */
  readonly setName: (name: string) => Effect.Effect<void, PiHostError>
  /** Reads the current session name, if one is set. */
  readonly getName: () => Effect.Effect<string | undefined, PiHostError>
  /** Sets or clears the label for a session entry. */
  readonly setLabel: (entryId: string, label: string | undefined) => Effect.Effect<void, PiHostError>
  /** Reads a session entry by its identifier. */
  readonly entry: (id: string) => Effect.Effect<SessionEntry | undefined, PiHostError>
  /** Reads the branch for `fromId`, or the current leaf when `fromId` is omitted. */
  readonly branch: (fromId?: string) => Effect.Effect<readonly SessionEntry[], PiHostError>
  /** Reads all entries in the current session. */
  readonly entries: () => Effect.Effect<readonly SessionEntry[], PiHostError>
  /** Reads the session tree used for navigation. */
  readonly tree: () => Effect.Effect<readonly SessionTreeNode[], PiHostError>
  /** Reads entries included in the current model context. */
  readonly contextEntries: () => Effect.Effect<readonly SessionEntry[], PiHostError>
}

/** Effect operations for sending custom and user messages to Pi. */
type PiMessagesService = {
  /** Sends a custom message to the current session. */
  readonly sendMessage: <TDetails>(
    message: PiCustomMessage<TDetails>,
    options?: PiSendMessageOptions,
  ) => Effect.Effect<void, PiHostError>
  /** Sends a user message to the current session. */
  readonly sendUserMessage: (content: PiContent, options?: PiSendUserMessageOptions) => Effect.Effect<void, PiHostError>
}

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

type PiComponentWithDispose = Component & { dispose?: () => void }
type PiWidgetFactory = (tui: TUI, theme: Theme) => PiComponentWithDispose
type PiFooterFactory = (tui: TUI, theme: Theme, footerData: unknown) => PiComponentWithDispose
type PiHeaderFactory = (tui: TUI, theme: Theme) => PiComponentWithDispose
/** Pi theme type accepted by UI service operations. */
type PiTheme = Theme
/** Pi terminal user interface (TUI) type used by custom components. */
type PiTui = TUI

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
  ) => Effect.Effect<string | undefined, PiUiUnavailableError | PiHostError>
  /** Opens a confirmation dialog and returns the user's choice.
   * Fails with `PiUiUnavailableError` when UI is unavailable.
   */
  readonly confirm: (
    title: string,
    message: string,
    dialog?: PiUiDialogOptions,
  ) => Effect.Effect<boolean, PiUiUnavailableError | PiHostError>
  /** Opens a text-input dialog and returns its value, or `undefined` when cancelled.
   * Fails with `PiUiUnavailableError` when UI is unavailable.
   */
  readonly input: (
    title: string,
    placeholder?: string,
    dialog?: PiUiDialogOptions,
  ) => Effect.Effect<string | undefined, PiUiUnavailableError | PiHostError>
  /** Shows a notification when UI is available; otherwise does nothing. */
  readonly notify: (message: string, type?: 'info' | 'warning' | 'error') => Effect.Effect<void, PiHostError>
  /** Registers a terminal-input handler and returns an unsubscribe function.
   * Fails with `PiUiUnavailableError` when UI is unavailable or the mode is not `tui`.
   */
  readonly onTerminalInput: (
    handler: (data: string) => { consume?: boolean; data?: string } | undefined,
  ) => Effect.Effect<() => void, PiHostError | PiUiUnavailableError>
  /** Sets or clears a status item when UI is available. */
  readonly setStatus: (key: string, text: string | undefined) => Effect.Effect<void, PiHostError>
  /** Sets the working message when UI is available. */
  readonly setWorkingMessage: (message?: string) => Effect.Effect<void, PiHostError>
  /** Shows or hides the working indicator when UI is available. */
  readonly setWorkingVisible: (visible: boolean) => Effect.Effect<void, PiHostError>
  /** Sets the working indicator animation when UI is available. */
  readonly setWorkingIndicator: (options?: PiWorkingIndicatorOptions) => Effect.Effect<void, PiHostError>
  /** Sets or clears a widget when UI is available. */
  readonly setWidget: (
    key: string,
    content: readonly string[] | PiWidgetFactory | undefined,
    options?: PiWidgetOptions,
  ) => Effect.Effect<void, PiHostError>
  /** Sets or clears a custom footer when UI is available. */
  readonly setFooter: (factory: PiFooterFactory | undefined) => Effect.Effect<void, PiHostError>
  /** Sets or clears a custom header when UI is available. */
  readonly setHeader: (factory: PiHeaderFactory | undefined) => Effect.Effect<void, PiHostError>
  /** Sets the terminal title when UI is available. */
  readonly setTitle: (title: string) => Effect.Effect<void, PiHostError>
  /** Opens a custom terminal UI component and returns an `Option` result.
   * The result is `Some` when the component calls `done`.
   * Fails with `PiUiUnavailableError` when UI is unavailable or the mode is not `tui`.
   */
  readonly custom: <A>(
    factory: PiCustomFactory<A>,
    options?: { readonly overlay?: boolean; readonly overlayOptions?: OverlayOptions },
  ) => Effect.Effect<Option.Option<A>, PiUiUnavailableError | PiHostError>
  /** Pastes text into the editor when UI is available. */
  readonly pasteToEditor: (text: string) => Effect.Effect<void, PiHostError>
  /** Replaces the editor text when UI is available. */
  readonly setEditorText: (text: string) => Effect.Effect<void, PiHostError>
  /** Reads the current editor text. */
  readonly getEditorText: () => Effect.Effect<string, PiHostError>
  /** Opens the full editor and returns its text, or `undefined` when cancelled.
   * Fails with `PiUiUnavailableError` when UI is unavailable or the mode is not `tui`.
   */
  readonly editor: (
    title: string,
    prefill?: string,
  ) => Effect.Effect<string | undefined, PiUiUnavailableError | PiHostError>
  /** Adds or wraps an autocomplete provider. */
  readonly addAutocompleteProvider: (
    factory: (current: AutocompleteProvider) => AutocompleteProvider,
  ) => Effect.Effect<void, PiHostError>
  /** Sets the custom terminal UI editor component.
   * Fails with `PiUiUnavailableError` when UI is unavailable or the mode is not `tui`.
   */
  readonly setEditorComponent: (
    factory: ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) | undefined,
  ) => Effect.Effect<void, PiUiUnavailableError | PiHostError>
  /** Reads the custom terminal UI editor component factory, if one is set. */
  readonly getEditorComponent: () => Effect.Effect<
    ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) | undefined,
    PiHostError
  >
  /** Reads the active theme, if Pi has one. */
  readonly theme: () => Effect.Effect<Theme | undefined, PiHostError>
  /** Lists available themes and their optional file paths. */
  readonly getAllThemes: () => Effect.Effect<
    readonly { readonly name: string; readonly path: string | undefined }[],
    PiHostError
  >
  /** Reads a theme by name, if it is available. */
  readonly getTheme: (name: string) => Effect.Effect<Theme | undefined, PiHostError>
  /** Selects a theme by name or theme value and reports success or an error. */
  readonly setTheme: (
    theme: string | Theme,
  ) => Effect.Effect<{ readonly success: boolean; readonly error?: string }, PiHostError>
  /** Reads the expanded state without wrapping the value in an Effect. */
  readonly getToolsExpandedValue: () => boolean
  /** Reads whether Pi expands tool output. */
  readonly getToolsExpanded: () => Effect.Effect<boolean, PiHostError>
  /** Sets whether Pi expands tool output. */
  readonly setToolsExpanded: (expanded: boolean) => Effect.Effect<void, PiHostError>
}

/** Effect operations for reading and replacing the active tool list. */
type PiToolsService = {
  /** Reads the active tool names. */
  readonly active: () => Effect.Effect<readonly string[], PiHostError>
  /** Reads metadata for all tools known to Pi. */
  readonly all: () => Effect.Effect<readonly ToolInfo[], PiHostError>
  /** Replaces the active tool list. */
  readonly replaceActive: (toolNames: readonly string[]) => Effect.Effect<void, PiHostError>
}

/** Effect operation for reading a boolean or string Pi flag. */
type PiFlagsService = {
  /** Reads a flag by name, or returns `undefined` when it is not set. */
  readonly get: (name: string) => Effect.Effect<boolean | string | undefined, PiHostError>
}

/** Effect operation for running a process through Pi. */
type PiProcessService = {
  /** Runs a process and returns its output and exit status. */
  readonly exec: (
    command: string,
    args: readonly string[],
    options?: ExecOptions,
  ) => Effect.Effect<ExecResult, PiHostError>
}

/** Facade that groups every service available to an extension. */
type PiService = {
  /** Invocation context service. */
  readonly context: PiContext['Service']
  /** Session snapshot service. */
  readonly sessionContext: PiSessionContext['Service']
  /** Command context and session operations. */
  readonly commandContext: PiCommandContext['Service']
  /** Current tool-call context. */
  readonly toolContext: PiToolContext['Service']
  /** Session read and update operations. */
  readonly session: PiSession['Service']
  /** Message-sending operations. */
  readonly messages: PiMessages['Service']
  /** UI operations. */
  readonly ui: PiUi['Service']
  /** Active-tool operations. */
  readonly tools: PiTools['Service']
  /** Flag-read operations. */
  readonly flags: PiFlags['Service']
  /** Process execution operations. */
  readonly process: PiProcess['Service']
  /** Extension event bus. */
  readonly events: PiHostEventBus
  /** Model operations. */
  readonly model: {
    /** Selects the current model and reports whether Pi accepted it. */
    readonly set: (model: Model<Api>) => Effect.Effect<boolean, PiHostError>
  }
}

/** Service tag for low-level operations supplied by the Pi host. */
class PiHostService extends Context.Service<PiHostService, PiHostOperations>()('pi-effect/PiHostService') {}
/** Service tag for shared Pi invocation context. */
class PiContext extends Context.Service<PiContext, PiContextValue>()('pi-effect/PiContext') {}
/** Service tag for the current session snapshot and read operations. */
class PiSessionContext extends Context.Service<PiSessionContext, PiSessionContextValue>()(
  'pi-effect/PiSessionContext',
) {}
/** Service tag for command context and session-changing operations. */
class PiCommandContext extends Context.Service<PiCommandContext, PiCommandContextValue>()(
  'pi-effect/PiCommandContext',
) {}
/** Service tag for the current tool-call context. */
class PiToolContext extends Context.Service<PiToolContext, PiToolContextValue>()('pi-effect/PiToolContext') {}
/** Service tag for session reads and updates. */
class PiSession extends Context.Service<PiSession, PiSessionService>()('pi-effect/PiSession') {}
/** Service tag for sending messages to Pi. */
class PiMessages extends Context.Service<PiMessages, PiMessagesService>()('pi-effect/PiMessages') {}
/** Service tag for Pi UI operations. */
class PiUi extends Context.Service<PiUi, PiUiService>()('pi-effect/PiUi') {}
/** Service tag for reading and replacing active tools. */
class PiTools extends Context.Service<PiTools, PiToolsService>()('pi-effect/PiTools') {}
/** Service tag for reading Pi flags. */
class PiFlags extends Context.Service<PiFlags, PiFlagsService>()('pi-effect/PiFlags') {}
/** Service tag for running processes through Pi. */
class PiProcess extends Context.Service<PiProcess, PiProcessService>()('pi-effect/PiProcess') {}
/** Service tag for the facade that groups the available Pi services. */
class Pi extends Context.Service<Pi, PiService>()('pi-effect/Pi') {}

/** Stable services available to setup and every registered callback. */
type PiStableServices = PiMessages | PiTools | PiFlags | PiProcess

/** Services whose values or permissions depend on the current invocation. */
type PiInvocationServices = Pi | PiContext | PiSessionContext | PiCommandContext | PiToolContext | PiSession | PiUi

/** Union of stable and invocation-specific Pi service tags. */
type PiServices = PiStableServices | PiInvocationServices

export {
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
  PiFlags,
  type PiFlagsService,
  type PiHostEventBus,
  type PiHostOperations,
  PiHostService,
  type PiInvocationServices,
  PiMessages,
  type PiMessagesService,
  type PiMode,
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
  type PiTheme,
  PiToolContext,
  type PiToolContextValue,
  type PiToolExecutionMode,
  PiTools,
  type PiToolsService,
  type PiToolUpdate,
  type PiTui,
  PiUi,
  type PiUiDialogOptions,
  type PiUiService,
  type PiWidgetOptions,
  type PiWorkingIndicatorOptions,
}
