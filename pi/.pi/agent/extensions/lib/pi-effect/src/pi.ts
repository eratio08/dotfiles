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
import type { PiOperationsError } from './errors.ts'
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
  readonly events: PiEventBus
  /** Model operations. */
  readonly model: {
    /** Selects the current model and reports whether Pi accepted it. */
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
  PiMessages,
  type PiMessagesService,
  type PiMode,
  PiOperations,
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
