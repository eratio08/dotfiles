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

type PiMode = 'tui' | 'rpc' | 'json' | 'print'
type PiThinkingLevel = Parameters<ExtensionAPI['setThinkingLevel']>[0]
type PiContent = string | readonly (TextContent | ImageContent)[]
type PiToolExecutionMode = ToolExecutionMode

type PiContextUsage = {
  readonly tokens: number | null
  readonly contextWindow: number
  readonly percent: number | null
}

type PiCustomMessage<TDetails = unknown> = {
  readonly customType: string
  readonly content: PiContent
  readonly display?: boolean
  readonly details?: TDetails
}

type PiSendMessageOptions = {
  readonly triggerTurn?: boolean
  readonly deliverAs?: 'steer' | 'followUp' | 'nextTurn'
}

type PiSendUserMessageOptions = {
  readonly deliverAs?: 'steer' | 'followUp'
}

type PiSessionContextValue = {
  readonly cwd: string
  readonly id: string
  readonly file: string | undefined
  readonly directory: string
  readonly leafId: string | null
  readonly leaf: SessionEntry | undefined
  readonly entries: readonly SessionEntry[]
  readonly tree: readonly SessionTreeNode[]
  readonly entry: (id: string) => Effect.Effect<SessionEntry | undefined, PiHostError>
  readonly branch: (fromId?: string) => Effect.Effect<readonly SessionEntry[], PiHostError>
  readonly contextEntries: () => Effect.Effect<readonly SessionEntry[], PiHostError>
  readonly label: (entryId: string) => Effect.Effect<string | undefined, PiHostError>
  readonly name: string | undefined
}

type PiContextValue = {
  readonly mode: PiMode
  readonly hasUI: boolean
  readonly cwd: string
  readonly signal: AbortSignal | undefined
  readonly model: Model<Api> | undefined
  readonly thinkingLevel: PiThinkingLevel | undefined
  readonly isIdle: () => Effect.Effect<boolean, PiHostError>
  readonly isProjectTrusted: () => Effect.Effect<boolean, PiHostError>
  readonly hasPendingMessages: () => Effect.Effect<boolean, PiHostError>
  readonly contextUsage: () => Effect.Effect<PiContextUsage | undefined, PiHostError>
  readonly abort: () => Effect.Effect<void, PiHostError>
  readonly shutdown: () => Effect.Effect<void, PiHostError>
  readonly compact: (options?: PiCompactOptions) => Effect.Effect<void, PiHostError>
  readonly systemPrompt: () => Effect.Effect<string, PiHostError>
}

type PiCompactOptions = {
  readonly customInstructions?: string
}

type PiSessionChangeResult = {
  readonly cancelled: boolean
}

type PiSessionReplacement = {
  readonly context: PiCommandContextValue
  readonly session: PiSessionContextValue
}

type PiSessionChangeOptions = {
  readonly parentSession?: string
  readonly position?: 'before' | 'at'
  readonly setup?: (session: PiSessionContextValue) => Effect.Effect<void, PiExtensionError>
  readonly withSession?: (replacement: PiSessionReplacement) => Effect.Effect<void, PiExtensionError>
}

type PiCommandContextValue = PiContextValue & {
  readonly session: PiSessionContextValue
  readonly systemPromptOptions: () => Effect.Effect<BuildSystemPromptOptions, PiHostError>
  readonly waitForIdle: () => Effect.Effect<void, PiHostError>
  readonly newSession: (options?: PiSessionChangeOptions) => Effect.Effect<PiSessionChangeResult, PiHostError>
  readonly fork: (
    entryId: string,
    options?: PiSessionChangeOptions,
  ) => Effect.Effect<PiSessionChangeResult, PiHostError>
  readonly navigateTree: (
    targetId: string,
    options?: {
      readonly summarize?: boolean
      readonly customInstructions?: string
      readonly replaceInstructions?: boolean
      readonly label?: string
    },
  ) => Effect.Effect<PiSessionChangeResult, PiHostError>
  readonly switchSession: (
    sessionPath: string,
    options?: PiSessionChangeOptions,
  ) => Effect.Effect<PiSessionChangeResult, PiHostError>
  readonly reload: () => Effect.Effect<void, PiHostError>
}

type PiToolUpdate<TDetails = unknown> = {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  readonly details?: TDetails
}

type PiToolContextValue = PiContextValue & {
  readonly session: PiSessionContextValue
  readonly toolCallId: string
  readonly params: unknown
  readonly toolSignal: AbortSignal | undefined
  readonly onUpdate: (update: PiToolUpdate) => Effect.Effect<void, PiToolError>
  readonly executionMode: PiToolExecutionMode
}

type PiHostEventBus = {
  readonly emit: (channel: string, data: unknown) => Effect.Effect<void, PiHostError>
  readonly on: (
    channel: string,
    handler: (data: unknown) => void,
  ) => Effect.Effect<Effect.Effect<void, PiHostError>, PiHostError>
  readonly onScoped: (
    channel: string,
    handler: (data: unknown) => void,
  ) => Effect.Effect<void, PiHostError, Scope.Scope>
}

type PiHostValue = {
  readonly exec: (
    command: string,
    args: readonly string[],
    options?: ExecOptions,
  ) => Effect.Effect<ExecResult, PiHostError>
  readonly sendMessage: <TDetails>(
    message: PiCustomMessage<TDetails>,
    options?: PiSendMessageOptions,
  ) => Effect.Effect<void, PiHostError>
  readonly sendUserMessage: (content: PiContent, options?: PiSendUserMessageOptions) => Effect.Effect<void, PiHostError>
  readonly appendEntry: <TData>(customType: string, data?: TData) => Effect.Effect<void, PiHostError>
  readonly setSessionName: (name: string) => Effect.Effect<void, PiHostError>
  readonly getSessionName: () => Effect.Effect<string | undefined, PiHostError>
  readonly setLabel: (entryId: string, label: string | undefined) => Effect.Effect<void, PiHostError>
  readonly getActiveTools: () => Effect.Effect<readonly string[], PiHostError>
  readonly getAllTools: () => Effect.Effect<readonly ToolInfo[], PiHostError>
  readonly setActiveTools: (toolNames: readonly string[]) => Effect.Effect<void, PiHostError>
  readonly getFlag: (name: string) => Effect.Effect<boolean | string | undefined, PiHostError>
  readonly setModel: (model: Model<Api>) => Effect.Effect<boolean, PiHostError>
  readonly getThinkingLevel: () => Effect.Effect<PiThinkingLevel, PiHostError>
  readonly setThinkingLevel: (level: PiThinkingLevel) => Effect.Effect<void, PiHostError>
  readonly registerProvider: (provider: Provider | string, config?: ProviderConfig) => Effect.Effect<void, PiHostError>
  readonly unregisterProvider: (name: string) => Effect.Effect<void, PiHostError>
  readonly events: PiHostEventBus
}

type PiSessionService = {
  readonly appendEntry: <TData>(customType: string, data?: TData) => Effect.Effect<void, PiHostError>
  readonly setName: (name: string) => Effect.Effect<void, PiHostError>
  readonly getName: () => Effect.Effect<string | undefined, PiHostError>
  readonly setLabel: (entryId: string, label: string | undefined) => Effect.Effect<void, PiHostError>
  readonly entry: (id: string) => Effect.Effect<SessionEntry | undefined, PiHostError>
  readonly branch: (fromId?: string) => Effect.Effect<readonly SessionEntry[], PiHostError>
  readonly entries: () => Effect.Effect<readonly SessionEntry[], PiHostError>
  readonly tree: () => Effect.Effect<readonly SessionTreeNode[], PiHostError>
  readonly contextEntries: () => Effect.Effect<readonly SessionEntry[], PiHostError>
}

type PiMessagesService = {
  readonly sendMessage: <TDetails>(
    message: PiCustomMessage<TDetails>,
    options?: PiSendMessageOptions,
  ) => Effect.Effect<void, PiHostError>
  readonly sendUserMessage: (content: PiContent, options?: PiSendUserMessageOptions) => Effect.Effect<void, PiHostError>
}

type PiUiDialogOptions = {
  readonly signal?: AbortSignal
  readonly timeout?: number
}

type PiWidgetOptions = {
  readonly placement?: 'aboveEditor' | 'belowEditor'
}

type PiWorkingIndicatorOptions = {
  readonly frames?: readonly string[]
  readonly intervalMs?: number
}

type PiComponentWithDispose = Component & { dispose?: () => void }
type PiWidgetFactory = (tui: TUI, theme: Theme) => PiComponentWithDispose
type PiFooterFactory = (tui: TUI, theme: Theme, footerData: unknown) => PiComponentWithDispose
type PiHeaderFactory = (tui: TUI, theme: Theme) => PiComponentWithDispose
type PiTheme = Theme
type PiTui = TUI

type PiCustomFactory<A> = (
  tui: TUI,
  theme: Theme,
  keybindings: KeybindingsManager,
  done: (result: A) => void,
) => PiComponentWithDispose | Promise<PiComponentWithDispose>

type PiUiService = {
  readonly select: (
    title: string,
    options: readonly string[],
    dialog?: PiUiDialogOptions,
  ) => Effect.Effect<string | undefined, PiUiUnavailableError | PiHostError>
  readonly confirm: (
    title: string,
    message: string,
    dialog?: PiUiDialogOptions,
  ) => Effect.Effect<boolean, PiUiUnavailableError | PiHostError>
  readonly input: (
    title: string,
    placeholder?: string,
    dialog?: PiUiDialogOptions,
  ) => Effect.Effect<string | undefined, PiUiUnavailableError | PiHostError>
  readonly notify: (message: string, type?: 'info' | 'warning' | 'error') => Effect.Effect<void, PiHostError>
  readonly onTerminalInput: (
    handler: (data: string) => { consume?: boolean; data?: string } | undefined,
  ) => Effect.Effect<() => void, PiHostError | PiUiUnavailableError>
  readonly setStatus: (key: string, text: string | undefined) => Effect.Effect<void, PiHostError>
  readonly setWorkingMessage: (message?: string) => Effect.Effect<void, PiHostError>
  readonly setWorkingVisible: (visible: boolean) => Effect.Effect<void, PiHostError>
  readonly setWorkingIndicator: (options?: PiWorkingIndicatorOptions) => Effect.Effect<void, PiHostError>
  readonly setWidget: (
    key: string,
    content: readonly string[] | PiWidgetFactory | undefined,
    options?: PiWidgetOptions,
  ) => Effect.Effect<void, PiHostError>
  readonly setFooter: (factory: PiFooterFactory | undefined) => Effect.Effect<void, PiHostError>
  readonly setHeader: (factory: PiHeaderFactory | undefined) => Effect.Effect<void, PiHostError>
  readonly setTitle: (title: string) => Effect.Effect<void, PiHostError>
  readonly custom: <A>(
    factory: PiCustomFactory<A>,
    options?: { readonly overlay?: boolean; readonly overlayOptions?: OverlayOptions },
  ) => Effect.Effect<Option.Option<A>, PiUiUnavailableError | PiHostError>
  readonly pasteToEditor: (text: string) => Effect.Effect<void, PiHostError>
  readonly setEditorText: (text: string) => Effect.Effect<void, PiHostError>
  readonly getEditorText: () => Effect.Effect<string, PiHostError>
  readonly editor: (
    title: string,
    prefill?: string,
  ) => Effect.Effect<string | undefined, PiUiUnavailableError | PiHostError>
  readonly addAutocompleteProvider: (
    factory: (current: AutocompleteProvider) => AutocompleteProvider,
  ) => Effect.Effect<void, PiHostError>
  readonly setEditorComponent: (
    factory: ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) | undefined,
  ) => Effect.Effect<void, PiUiUnavailableError | PiHostError>
  readonly getEditorComponent: () => Effect.Effect<
    ((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => EditorComponent) | undefined,
    PiHostError
  >
  readonly theme: () => Effect.Effect<Theme | undefined, PiHostError>
  readonly getAllThemes: () => Effect.Effect<
    readonly { readonly name: string; readonly path: string | undefined }[],
    PiHostError
  >
  readonly getTheme: (name: string) => Effect.Effect<Theme | undefined, PiHostError>
  readonly setTheme: (
    theme: string | Theme,
  ) => Effect.Effect<{ readonly success: boolean; readonly error?: string }, PiHostError>
  readonly getToolsExpandedValue: () => boolean
  readonly getToolsExpanded: () => Effect.Effect<boolean, PiHostError>
  readonly setToolsExpanded: (expanded: boolean) => Effect.Effect<void, PiHostError>
}

type PiToolsService = {
  readonly active: () => Effect.Effect<readonly string[], PiHostError>
  readonly all: () => Effect.Effect<readonly ToolInfo[], PiHostError>
  readonly replaceActive: (toolNames: readonly string[]) => Effect.Effect<void, PiHostError>
}

type PiFlagsService = {
  readonly get: (name: string) => Effect.Effect<boolean | string | undefined, PiHostError>
}

type PiProcessService = {
  readonly exec: (
    command: string,
    args: readonly string[],
    options?: ExecOptions,
  ) => Effect.Effect<ExecResult, PiHostError>
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
  readonly events: PiHostEventBus
  readonly model: {
    readonly set: (model: Model<Api>) => Effect.Effect<boolean, PiHostError>
  }
}

class PiHost extends Context.Service<PiHost, PiHostValue>()('pi-effect/PiHost') {}
class PiContext extends Context.Service<PiContext, PiContextValue>()('pi-effect/PiContext') {}
class PiSessionContext extends Context.Service<PiSessionContext, PiSessionContextValue>()(
  'pi-effect/PiSessionContext',
) {}
class PiCommandContext extends Context.Service<PiCommandContext, PiCommandContextValue>()(
  'pi-effect/PiCommandContext',
) {}
class PiToolContext extends Context.Service<PiToolContext, PiToolContextValue>()('pi-effect/PiToolContext') {}
class PiSession extends Context.Service<PiSession, PiSessionService>()('pi-effect/PiSession') {}
class PiMessages extends Context.Service<PiMessages, PiMessagesService>()('pi-effect/PiMessages') {}
class PiUi extends Context.Service<PiUi, PiUiService>()('pi-effect/PiUi') {}
class PiTools extends Context.Service<PiTools, PiToolsService>()('pi-effect/PiTools') {}
class PiFlags extends Context.Service<PiFlags, PiFlagsService>()('pi-effect/PiFlags') {}
class PiProcess extends Context.Service<PiProcess, PiProcessService>()('pi-effect/PiProcess') {}
class Pi extends Context.Service<Pi, PiService>()('pi-effect/Pi') {}

type PiStableServices = PiMessages | PiTools | PiFlags | PiProcess

type PiInvocationServices = Pi | PiContext | PiSessionContext | PiCommandContext | PiToolContext | PiSession | PiUi

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
  PiHost,
  type PiHostEventBus,
  type PiHostValue,
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
