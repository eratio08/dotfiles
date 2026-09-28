import type { Api, Model, Provider } from '@earendil-works/pi-ai'
import type { ExecOptions, ExecResult, ProviderConfig, ToolInfo } from '@earendil-works/pi-coding-agent'
import { Context, type Effect, type Scope } from 'effect'
import {
  PiCommandContext,
  type PiCommandContextValue,
  type PiCompactOptions,
  PiContext,
  type PiContextUsage,
  type PiContextValue,
  type PiMode,
  PiSession,
  type PiSessionChangeOptions,
  type PiSessionChangeResult,
  PiSessionContext,
  type PiSessionContextValue,
  type PiSessionReplacement,
  type PiThinkingLevel,
  PiToolContext,
  type PiToolContextValue,
  type PiToolExecutionMode,
  type PiToolUpdate,
} from './context.ts'
import type { PiHostError } from './errors.ts'
import {
  type PiContent,
  type PiCustomMessage,
  PiMessages,
  type PiMessagesService,
  type PiSendMessageOptions,
  type PiSendUserMessageOptions,
} from './messages.ts'
import { PiProcess, type PiProcessService } from './process.ts'
import { PiFlags, type PiFlagsService } from './registries.ts'
import { PiTools, type PiToolsService } from './tools.ts'
import {
  type PiCustomFactory,
  PiUi,
  type PiUiDialogOptions,
  type PiUiService,
  type PiWidgetOptions,
  type PiWorkingIndicatorOptions,
} from './ui.ts'

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
  type PiStableServices,
  PiToolContext,
  type PiToolContextValue,
  type PiToolExecutionMode,
  PiTools,
  type PiToolsService,
  type PiToolUpdate,
  PiUi,
  type PiUiDialogOptions,
  type PiUiService,
  type PiWidgetOptions,
  type PiWorkingIndicatorOptions,
}
