import type {
  AgentToolUpdateCallback,
  BeforeAgentStartEventResult,
  BeforeProviderRequestEventResult,
  ContextEvent,
  EntryRenderer,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionEvent,
  ExtensionFactory,
  ExtensionToolContext,
  ExtensionUIContext,
  InputEventResult,
  MessageEndEvent,
  MessageRenderer,
  ProjectTrustContext,
  ProjectTrustEventResult,
  SessionManager,
  ToolCallEventResult,
  ToolDefinition,
  ToolResultEvent,
  UserBashEventResult,
} from '@earendil-works/pi-coding-agent'
import type { AutocompleteItem, KeyId } from '@earendil-works/pi-tui'
import { Effect, Layer, ManagedRuntime, Schema } from 'effect'
import type { Static, TSchema } from 'typebox'
import * as PiApi from './pi.ts'

/**
 * Error returned when code tries to run after the managed runtime starts shutting down.
 * It records the attempted operation and a readable failure message.
 */
class PiRuntimeDisposedError extends Schema.TaggedError<PiRuntimeDisposedError>()('PiRuntimeDisposedError', {
  operation: Schema.String,
  message: Schema.String,
}) {}

/**
 * Error returned when Pi rejects a command, event, tool, flag, shortcut, or renderer registration.
 * It records the registration name and may include the original cause.
 */
class PiRegistrationError extends Schema.TaggedError<PiRegistrationError>()('PiRegistrationError', {
  registration: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

/** Union of errors that the Pi Effect adapter can return to extension code. */
type PiExtensionError =
  | PiApi.PiOperationsError
  | PiApi.PiUiUnavailableError
  | PiRuntimeDisposedError
  | PiRegistrationError
  | PiApi.PiToolError

/** Name of a Pi extension event that can be registered. */
type PiEventName = ExtensionEvent['type']
/** Maps each event name to the matching Pi event payload. */
type PiEventMap = {
  [Name in PiEventName]: Extract<ExtensionEvent, { type: Name }>
}

type PiEventResults = {
  project_trust: ProjectTrustEventResult
  resources_discover: {
    readonly skillPaths?: string[]
    readonly promptPaths?: string[]
    readonly themePaths?: string[]
  }
  session_before_switch: { readonly cancel?: boolean }
  session_before_fork: { readonly cancel?: boolean; readonly skipConversationRestore?: boolean }
  session_before_compact: { readonly cancel?: boolean; readonly compaction?: unknown }
  session_before_tree: {
    readonly cancel?: boolean
    readonly summary?: { readonly summary: string; readonly details?: unknown; readonly usage?: unknown }
    readonly customInstructions?: string
    readonly replaceInstructions?: boolean
    readonly label?: string
  }
  context: { readonly messages?: ContextEvent['messages'] }
  before_provider_request: BeforeProviderRequestEventResult
  before_agent_start: BeforeAgentStartEventResult
  message_end: { readonly message?: MessageEndEvent['message'] }
  tool_call: ToolCallEventResult
  tool_result: {
    readonly content?: ToolResultEvent['content']
    readonly details?: unknown
    readonly isError?: boolean
    readonly usage?: unknown
  }
  user_bash: UserBashEventResult
  input: InputEventResult
}

/** Maps each event name to the result type accepted by its handler. */
type PiEventResultMap = {
  [Name in PiEventName]: Name extends keyof PiEventResults ? PiEventResults[Name] : undefined
}
type PiEventResult<Name extends PiEventName> = PiEventResultMap[Name]
/** Effect handler for one event, with its event-specific input and result types. */
type PiEventHandler<Services, Failure, Name extends PiEventName> = (
  event: PiEventMap[Name],
) =>
  | Effect.Effect<PiEventResult<Name> | undefined, Failure, Services | PiApi.PiServices>
  | Effect.Effect<void, Failure, Services | PiApi.PiServices>

/** Policy for handling a failed event handler: return the failure, keep the event neutral, or reject the action. */
type PiFailurePolicy = 'propagate' | 'neutral' | 'failClosed'
/** Optional event registration settings. */
type PiEventOptions = {
  /** Overrides `defaultPiFailurePolicy` for a failed event handler. */
  readonly failure?: PiFailurePolicy
}

/** Runtime-neutral callback shape used by the Pi event registrar. */
type PiEventCallback<Services, Failure> = {
  run(event: unknown): Effect.Effect<unknown, Failure, Services | PiApi.PiServices>
}['run']

/** Pi event registrar. */
type PiEventRegistrar<Services, Failure> = {
  /** Registers a Pi event callback with its selected failure policy. */
  readonly register: (name: PiEventName, handler: PiEventCallback<Services, Failure>, policy: PiFailurePolicy) => void
}

/** Pi command registrar. */
type PiCommandRegistrar<Services, Failure> = {
  /** Registers a command with Pi. */
  readonly register: (name: string, definition: PiCommandDefinition<Services, Failure>) => void
}

/** Command description and Effect handlers supplied during registration. */
type PiCommandDefinition<Services, Failure> = {
  /** Help text shown for the command. */
  readonly description?: string
  /** Returns completions for the current argument prefix, or `null` when none apply. */
  readonly getArgumentCompletions?: (
    argumentPrefix: string,
  ) => Effect.Effect<readonly AutocompleteItem[] | null, Failure, Services | PiApi.PiServices>
  /** Runs the command with the argument text supplied by Pi. */
  readonly handler: (args: string) => Effect.Effect<void, Failure, Services | PiApi.PiServices>
}

/** Pi keyboard shortcut registrar. */
type PiShortcutRegistrar<Services, Failure> = {
  /** Registers a keyboard shortcut with Pi. */
  readonly register: (shortcut: KeyId, definition: PiShortcutDefinition<Services, Failure>) => void
}

/** Description and Effect handler supplied for a keyboard shortcut. */
type PiShortcutDefinition<Services, Failure> = {
  /** Help text shown for the shortcut. */
  readonly description?: string
  /** Runs when the shortcut is pressed. */
  readonly handler: () => Effect.Effect<void, Failure, Services | PiApi.PiServices>
}

const PiFlagDefinitionSchema = Schema.Union([
  Schema.Struct({
    description: Schema.optional(Schema.String),
    type: Schema.Literal('boolean'),
    default: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    description: Schema.optional(Schema.String),
    type: Schema.Literal('string'),
    default: Schema.optional(Schema.String),
  }),
] as const)
/** Boolean or string flag definition, with an optional description and default value. */
type PiFlagDefinition = Schema.Schema.Type<typeof PiFlagDefinitionSchema>

/** Pi custom renderer registrar. */
type PiRendererRegistrar = {
  /** Registers a renderer for custom message content. */
  readonly registerMessage: (customType: string, renderer: MessageRenderer) => void
  /** Registers a renderer for custom session entries. */
  readonly registerEntry: (customType: string, renderer: EntryRenderer) => void
}

/** Pi flag registrar. */
type PiFlagRegistrar = {
  /** Registers a flag definition with Pi. */
  readonly register: (name: string, definition: PiFlagDefinition) => void
}

/** Pi Effect tool registrar. */
type PiToolRegistrar<Services> = {
  /** Registers an Effect tool definition with Pi. */
  readonly register: <Params extends TSchema, ToolServices extends Services | PiApi.PiServices, ToolFailure, Details>(
    definition: PiApi.EffectToolDefinition<Params, ToolServices, ToolFailure, Details>,
  ) => void
}

/** Renderer registration data shared by message and entry renderers. */
type PiRendererDefinition = {
  /** Custom content type handled by the renderer. */
  readonly customType: string
  /** Renderer selected for the custom content type. */
  readonly render: MessageRenderer | EntryRenderer
}

/** Effect API for registering handlers for Pi extension events. */
type PiEventRegistry<Services, Failure = PiExtensionError> = {
  /** Registers a typed event handler and returns an Effect that fails if registration fails. */
  readonly on: <Name extends PiEventName>(
    name: Name,
    handler: PiEventHandler<Services, Failure, Name>,
    options?: PiEventOptions,
  ) => Effect.Effect<void, PiRegistrationError>
}

/** Effect API for registering Pi commands. */
type PiCommandRegistry<Services, Failure = PiExtensionError> = {
  /** Registers a command and returns an Effect that fails if registration fails. */
  readonly register: (
    name: string,
    definition: PiCommandDefinition<Services, Failure>,
  ) => Effect.Effect<void, PiRegistrationError>
}

/** Effect API for registering keyboard shortcuts. */
type PiShortcutRegistry<Services, Failure = PiExtensionError> = {
  /** Registers a shortcut and returns an Effect that fails if registration fails. */
  readonly register: (
    shortcut: KeyId,
    definition: PiShortcutDefinition<Services, Failure>,
  ) => Effect.Effect<void, PiRegistrationError>
}

/** Effect API for registering boolean and string flags. */
type PiFlagRegistry = {
  /** Registers a validated flag definition and returns an Effect that fails if registration fails. */
  readonly register: (name: string, definition: PiFlagDefinition) => Effect.Effect<void, PiRegistrationError>
}

/** Effect API for registering tools that run as Effects. */
type PiToolRegistry<Services> = {
  /** Registers a tool and returns an Effect that fails if registration fails. */
  readonly register: <Params extends TSchema, ToolServices extends Services | PiApi.PiServices, ToolFailure, Details>(
    definition: PiApi.EffectToolDefinition<Params, ToolServices, ToolFailure, Details>,
  ) => Effect.Effect<void, PiRegistrationError>
}

/** Effect API for registering custom message and session-entry renderers. */
type PiRendererRegistry = {
  /** Registers a renderer for the given custom message type. */
  readonly message: (customType: string, renderer: MessageRenderer) => Effect.Effect<void, PiRegistrationError>
  /** Registers a renderer for the given custom session-entry type. */
  readonly entry: (customType: string, renderer: EntryRenderer) => Effect.Effect<void, PiRegistrationError>
}

/** Registries available to a plugin setup Effect. */
type PiRegistrationContext<Services, Failure = PiExtensionError> = {
  /** Event handlers registered by this plugin. */
  readonly events: PiEventRegistry<Services, Failure>
  /** Commands registered by this plugin. */
  readonly commands: PiCommandRegistry<Services, Failure>
  /** Keyboard shortcuts registered by this plugin. */
  readonly shortcuts: PiShortcutRegistry<Services, Failure>
  /** Flags registered by this plugin. */
  readonly flags: PiFlagRegistry
  /** Effect tools registered by this plugin. */
  readonly tools: PiToolRegistry<Services>
  /** Custom message and session-entry renderers registered by this plugin. */
  readonly renderers: PiRendererRegistry
}

/**
 * Returns the adapter's default failure policy for an event name.
 * Tool-call failures reject the action, observation and transform failures use neutral results, and other failures propagate.
 * @param name Event name used to choose the policy.
 * @returns The default event failure policy.
 */
function defaultPiFailurePolicy(name: PiEventName): PiFailurePolicy {
  switch (name) {
    case 'project_trust':
    case 'input':
      return 'neutral'
    case 'tool_call':
      return 'failClosed'
    case 'session_before_switch':
    case 'session_before_fork':
    case 'session_before_compact':
    case 'session_before_tree':
      return 'neutral'
    case 'context':
    case 'before_provider_request':
    case 'before_provider_headers':
    case 'after_provider_response':
    case 'before_agent_start':
    case 'message_end':
    case 'tool_result':
    case 'user_bash':
      return 'neutral'
    default:
      return 'propagate'
  }
}

const registerEffect = Effect.fnUntraced(function* (
  registration: string,
  register: () => void,
): Effect.fn.Return<void, PiRegistrationError> {
  return yield* Effect.try({
    try: register,
    catch: (cause: unknown) =>
      new PiRegistrationError({
        registration,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  })
})

/**
 * Builds the Effect-based registration context from Pi registrars.
 * Registration failures become `PiRegistrationError` values.
 * @param registrars Pi functions used to register each kind of extension callback.
 * @returns Registries for the plugin setup Effect.
 */
function createPiRegistries<Services, Failure = PiExtensionError>(registrars: {
  readonly events: PiEventRegistrar<Services, Failure>
  readonly commands: PiCommandRegistrar<Services, Failure>
  readonly shortcuts: PiShortcutRegistrar<Services, Failure>
  readonly flags: PiFlagRegistrar
  readonly tools: PiToolRegistrar<Services>
  readonly renderers: PiRendererRegistrar
}): PiRegistrationContext<Services, Failure> {
  const events: PiEventRegistry<Services, Failure> = {
    on: <Name extends PiEventName>(
      name: Name,
      handler: PiEventHandler<Services, Failure, Name>,
      options?: PiEventOptions,
    ) =>
      registerEffect(`event:${name}`, () =>
        registrars.events.register(
          name,
          (event: PiEventMap[typeof name]) => handler(event),
          options?.failure ?? defaultPiFailurePolicy(name),
        ),
      ),
  }
  const commands: PiCommandRegistry<Services, Failure> = {
    register: (name: string, definition: Parameters<PiCommandRegistry<Services, Failure>['register']>[1]) =>
      registerEffect(`command:${name}`, () => registrars.commands.register(name, definition)),
  }
  const shortcuts: PiShortcutRegistry<Services, Failure> = {
    register: (shortcut: KeyId, definition: Parameters<PiShortcutRegistry<Services, Failure>['register']>[1]) =>
      registerEffect(`shortcut:${shortcut}`, () => registrars.shortcuts.register(shortcut, definition)),
  }
  const flags: PiFlagRegistry = {
    register: (name: string, definition: Parameters<PiFlagRegistry['register']>[1]) =>
      registerEffect(`flag:${name}`, () =>
        registrars.flags.register(name, Schema.decodeUnknownSync(PiFlagDefinitionSchema)(definition)),
      ),
  }
  const tools: PiToolRegistry<Services> = {
    register: <Params extends TSchema, ToolServices extends Services | PiApi.PiServices, ToolFailure, Details>(
      definition: PiApi.EffectToolDefinition<Params, ToolServices, ToolFailure, Details>,
    ) => registerEffect(`tool:${definition.name}`, () => registrars.tools.register(definition)),
  }
  const renderers: PiRendererRegistry = {
    message: (customType: string, renderer: Parameters<PiRendererRegistry['message']>[1]) =>
      registerEffect(`message-renderer:${customType}`, () =>
        registrars.renderers.registerMessage(customType, renderer),
      ),
    entry: (customType: string, renderer: Parameters<PiRendererRegistry['entry']>[1]) =>
      registerEffect(`entry-renderer:${customType}`, () => registrars.renderers.registerEntry(customType, renderer)),
  }

  return { events, commands, shortcuts, flags, tools, renderers }
}

type PiPluginWithLayer<Services, Failure = PiExtensionError> = {
  readonly id: string
  readonly layer: Layer.Layer<Services, Failure, PiApi.PiOperations | PiApi.PiStableServices>
  readonly effect: (
    context: PiRegistrationContext<Services, Failure>,
  ) => Effect.Effect<void, Failure | PiRegistrationError, Services | PiApi.PiStableServices>
}

type PiPluginWithoutLayer<Failure = PiExtensionError> = {
  readonly id: string
  readonly layer?: undefined
  readonly effect: (
    context: PiRegistrationContext<never, Failure>,
  ) => Effect.Effect<void, Failure | PiRegistrationError, PiApi.PiStableServices>
}

/** Plugin definition accepted by `PiExtension.define` and `PiExtension.install`. */
type PiPluginDefinition<Services, Failure = PiExtensionError> =
  | PiPluginWithLayer<Services, Failure>
  | PiPluginWithoutLayer<Failure>

/** Plugin setup program and its optional service layer. Use `PiPluginDefinition` for the same union type. */
type PiPlugin<Services, Failure = PiExtensionError> =
  | PiPluginWithLayer<Services, Failure>
  | PiPluginWithoutLayer<Failure>

function definePlugin<Services, Failure = PiExtensionError>(
  definition: PiPluginWithLayer<Services, Failure>,
): PiPluginWithLayer<Services, Failure>
function definePlugin<Failure = PiExtensionError>(
  definition: PiPluginWithoutLayer<Failure>,
): PiPluginWithoutLayer<Failure>
function definePlugin<Services, Failure = PiExtensionError>(
  definition: PiPluginWithLayer<Services, Failure> | PiPluginWithoutLayer<Failure>,
): PiPlugin<Services, Failure> {
  return definition
}

/** Entry point for defining a Pi Effect plugin and installing it as a Pi extension. */
const PiExtension: {
  define: typeof definePlugin
  install<Services, Failure = PiExtensionError>(plugin: PiPlugin<Services, Failure>): ExtensionFactory
} = {
  /**
   * Adds contextual types to a plugin definition and preserves its layer service types.
   * @param definition Plugin definition to type.
   * @returns The same definition with its inferred service and failure types.
   */
  define: definePlugin,
  /** Creates the Pi extension factory that owns the plugin runtime and installs its registrations.
   * @param plugin Plugin definition with its setup Effect and optional service layer.
   * @returns An extension factory that Pi can load.
   */
  install<Services, Failure = PiExtensionError>(plugin: PiPlugin<Services, Failure>): ExtensionFactory {
    return installPiPlugin(plugin)
  },
}

/** Layer used to provide the services managed by a Pi runtime. */
type PiRuntimeLayer<Services, LayerError = never> = Layer.Layer<Services, LayerError, never>

/** Managed Effect runtime with abort-signal support and an explicit shutdown phase. */
type PiManagedRuntime<Services, _LayerError = never> = {
  /** Runs a program unless shutdown has begun and combines its abort signals.
   * Rejects with `PiRuntimeDisposedError` after `beginShutdown`.
   */
  readonly run: <A, E>(
    program: Effect.Effect<A, E, Services>,
    signals?: readonly (AbortSignal | undefined)[],
  ) => Promise<A>
  /** Runs a shutdown program without checking the closing flag.
   * Use this for cleanup work before calling `dispose`.
   */
  readonly runShutdown: <A, E>(
    program: Effect.Effect<A, E, Services>,
    signals?: readonly (AbortSignal | undefined)[],
  ) => Promise<A>
  /** Prevents later calls to `run` while allowing `runShutdown` calls. */
  readonly beginShutdown: () => void
  /** Begins shutdown and disposes the managed runtime once. */
  readonly dispose: () => Promise<void>
  /** Reports whether shutdown has begun. */
  readonly isClosing: () => boolean
}

/**
 * Creates a managed runtime for a layer that has no unsatisfied service requirements.
 * @param layer Layer that provides the runtime services.
 * @returns Runtime operations for running programs and managing shutdown.
 */
function createPiManagedRuntime<Services, LayerError>(
  layer: PiRuntimeLayer<Services, LayerError>,
): PiManagedRuntime<Services, LayerError> {
  const managed = ManagedRuntime.make(layer)
  let closing = false
  let disposal: Promise<void> | undefined

  const beginShutdown = (): void => {
    closing = true
  }

  const dispose = (): Promise<void> => {
    if (disposal) return disposal
    beginShutdown()
    disposal = managed.dispose()
    return disposal
  }

  const runManaged = <A, E>(
    program: Effect.Effect<A, E, Services>,
    signals: readonly (AbortSignal | undefined)[] = [],
  ): Promise<A> => {
    const signal = PiApi.combinePiAbortSignals(...signals)
    return managed.runPromise(program, signal === undefined ? undefined : { signal })
  }

  const run = <A, E>(
    program: Effect.Effect<A, E, Services>,
    signals: readonly (AbortSignal | undefined)[] = [],
  ): Promise<A> => {
    if (closing) {
      return Promise.reject(
        new PiRuntimeDisposedError({
          operation: 'run',
          message: 'The Pi Effect runtime has been disposed.',
        }),
      )
    }
    return runManaged(program, signals)
  }

  return {
    run,
    runShutdown: runManaged,
    beginShutdown,
    dispose,
    isClosing: () => closing,
  }
}

/**
 * Adapts Pi's extension UI context to the UI interface used by the Effect services.
 * @param ui Pi UI context to adapt.
 * @returns UI adapter backed by `ui`.
 */
function createPiUiAdapter(ui: ExtensionUIContext): PiApi.PiUiAdapter {
  return {
    select: (
      title: string,
      options: Parameters<PiApi.PiUiAdapter['select']>[1],
      dialog?: Parameters<PiApi.PiUiAdapter['select']>[2],
    ) => ui.select(title, [...options], dialog),
    confirm: (
      title: string,
      message: Parameters<PiApi.PiUiAdapter['confirm']>[1],
      dialog?: Parameters<PiApi.PiUiAdapter['confirm']>[2],
    ) => ui.confirm(title, message, dialog),
    input: (
      title: string,
      placeholder?: Parameters<PiApi.PiUiAdapter['input']>[1],
      dialog?: Parameters<PiApi.PiUiAdapter['input']>[2],
    ) => ui.input(title, placeholder, dialog),
    notify: (message: string, type?: Parameters<PiApi.PiUiAdapter['notify']>[1]) => ui.notify(message, type),
    onTerminalInput: (handler: Parameters<PiApi.PiUiAdapter['onTerminalInput']>[0]) => ui.onTerminalInput(handler),
    setStatus: (key: string, text: Parameters<PiApi.PiUiAdapter['setStatus']>[1]) => ui.setStatus(key, text),
    setWorkingMessage: (message: string | undefined) => ui.setWorkingMessage(message),
    setWorkingVisible: (visible: boolean) => ui.setWorkingVisible(visible),
    setWorkingIndicator: (options: Parameters<PiApi.PiUiAdapter['setWorkingIndicator']>[0]) =>
      ui.setWorkingIndicator(
        options ? { ...options, frames: options.frames ? [...options.frames] : undefined } : undefined,
      ),
    setWidget: (
      key: string,
      content: Parameters<PiApi.PiUiAdapter['setWidget']>[1],
      options?: Parameters<PiApi.PiUiAdapter['setWidget']>[2],
    ) =>
      typeof content === 'function'
        ? ui.setWidget(key, content, options)
        : ui.setWidget(key, content ? [...content] : undefined, options),
    setFooter: (factory: Parameters<PiApi.PiUiAdapter['setFooter']>[0]) => ui.setFooter(factory),
    setHeader: (factory: Parameters<PiApi.PiUiAdapter['setHeader']>[0]) => ui.setHeader(factory),
    setTitle: (title: string) => ui.setTitle(title),
    custom: <A>(factory: PiApi.PiCustomFactory<A>, options?: Parameters<PiApi.PiUiAdapter['custom']>[1]) =>
      PiApi.piOperationTryPromise('custom', () => ui.custom(factory, options)),
    pasteToEditor: (text: string) => ui.pasteToEditor(text),
    setEditorText: (text: string) => ui.setEditorText(text),
    getEditorText: () => ui.getEditorText(),
    editor: (title: string, prefill?: Parameters<PiApi.PiUiAdapter['editor']>[1]) => ui.editor(title, prefill),
    addAutocompleteProvider: (factory: Parameters<PiApi.PiUiAdapter['addAutocompleteProvider']>[0]) =>
      ui.addAutocompleteProvider(factory),
    setEditorComponent: (factory: Parameters<PiApi.PiUiAdapter['setEditorComponent']>[0]) =>
      ui.setEditorComponent(factory),
    getEditorComponent: () => ui.getEditorComponent(),
    theme: ui.theme,
    getAllThemes: () => ui.getAllThemes(),
    getTheme: (name: string) => ui.getTheme(name),
    setTheme: (theme: Parameters<PiApi.PiUiAdapter['setTheme']>[0]) => ui.setTheme(theme),
    getToolsExpanded: () => ui.getToolsExpanded(),
    setToolsExpanded: (expanded: boolean) => ui.setToolsExpanded(expanded),
  }
}

/**
 * Creates a no-op UI adapter for an invocation without UI.
 * Its `custom` operation fails with `PiUiUnavailableError`.
 * @param mode Invocation mode reported by `PiUiUnavailableError`.
 */
function emptyPiUiAdapter(mode: PiApi.PiMode = 'print'): PiApi.PiUiAdapter {
  return {
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    notify: () => undefined,
    onTerminalInput: () => () => undefined,
    setStatus: () => undefined,
    setWorkingMessage: () => undefined,
    setWorkingVisible: () => undefined,
    setWorkingIndicator: () => undefined,
    setWidget: () => undefined,
    setFooter: () => undefined,
    setHeader: () => undefined,
    setTitle: () => undefined,
    custom: <_A>() =>
      Effect.fail(
        new PiApi.PiUiUnavailableError({
          operation: 'custom',
          mode,
          message: `UI is unavailable for ${mode}.`,
        }),
      ),
    pasteToEditor: () => undefined,
    setEditorText: () => undefined,
    getEditorText: () => '',
    editor: async () => undefined,
    addAutocompleteProvider: () => undefined,
    setEditorComponent: () => undefined,
    getEditorComponent: () => undefined,
    theme: undefined,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => undefined,
  }
}

/** Pi renderer type for custom message content. */
type PiMessageRenderer = MessageRenderer
/** Pi renderer type for custom session entries. */
type PiEntryRenderer = EntryRenderer

type PiToolUpdateHandler = {
  onUpdate(update: unknown): void
}['onUpdate']

type PiStableFacade = Pick<PiApi.Pi['Service'], 'messages' | 'tools' | 'flags' | 'process' | 'events' | 'model'>

type PiReplacedSessionContext = Parameters<
  NonNullable<NonNullable<Parameters<ExtensionCommandContext['switchSession']>[1]>['withSession']>
>[0]

function createPiOperationsService(api: ExtensionAPI): PiApi.PiOperationsService {
  return {
    exec: (
      command: string,
      args: Parameters<PiApi.PiOperationsService['exec']>[1],
      options?: Parameters<PiApi.PiOperationsService['exec']>[2],
    ) =>
      PiApi.piOperationTryPromise('exec', (signal) =>
        api.exec(command, [...args], {
          ...options,
          signal: PiApi.combinePiAbortSignals(options?.signal, signal),
        }),
      ),
    sendMessage: <TDetails>(
      message: PiApi.PiCustomMessage<TDetails>,
      options?: Parameters<PiApi.PiOperationsService['sendMessage']>[1],
    ) =>
      PiApi.piOperationTry('sendMessage', () =>
        api.sendMessage(
          {
            ...message,
            content: typeof message.content === 'string' ? message.content : [...message.content],
            display: message.display ?? false,
          },
          options,
        ),
      ),
    sendUserMessage: (
      content: Parameters<PiApi.PiOperationsService['sendUserMessage']>[0],
      options?: Parameters<PiApi.PiOperationsService['sendUserMessage']>[1],
    ) =>
      PiApi.piOperationTry('sendUserMessage', () =>
        api.sendUserMessage(typeof content === 'string' ? content : [...content], options),
      ),
    appendEntry: (customType: string, data?: Parameters<PiApi.PiOperationsService['appendEntry']>[1]) =>
      PiApi.piOperationTry('appendEntry', () => api.appendEntry(customType, data)),
    setSessionName: (name: string) => PiApi.piOperationTry('setSessionName', () => api.setSessionName(name)),
    getSessionName: () => PiApi.piOperationTry('getSessionName', () => api.getSessionName()),
    setLabel: (entryId: string, label: Parameters<PiApi.PiOperationsService['setLabel']>[1]) =>
      PiApi.piOperationTry('setLabel', () => api.setLabel(entryId, label)),
    getActiveTools: () => PiApi.piOperationTry('getActiveTools', () => api.getActiveTools()),
    getAllTools: () => PiApi.piOperationTry('getAllTools', () => api.getAllTools()),
    setActiveTools: (toolNames: readonly string[]) =>
      PiApi.piOperationTry('setActiveTools', () => api.setActiveTools([...toolNames])),
    getFlag: (name: string) => PiApi.piOperationTry('getFlag', () => api.getFlag(name)),
    setModel: (model: Parameters<PiApi.PiOperationsService['setModel']>[0]) =>
      PiApi.piOperationTryPromise('setModel', () => api.setModel(model)),
    getThinkingLevel: () => PiApi.piOperationTry('getThinkingLevel', () => api.getThinkingLevel()),
    setThinkingLevel: (level: Parameters<PiApi.PiOperationsService['setThinkingLevel']>[0]) =>
      PiApi.piOperationTry('setThinkingLevel', () => api.setThinkingLevel(level)),
    registerProvider: (
      provider: Parameters<PiApi.PiOperationsService['registerProvider']>[0],
      config?: Parameters<PiApi.PiOperationsService['registerProvider']>[1],
    ) =>
      PiApi.piOperationTry('registerProvider', () => {
        if (typeof provider === 'string') {
          api.registerProvider(provider, config ?? {})
        } else {
          api.registerProvider(provider)
        }
      }),
    unregisterProvider: (name: string) =>
      PiApi.piOperationTry('unregisterProvider', () => api.unregisterProvider(name)),
    events: {
      emit: (channel: string, data: Parameters<PiApi.PiOperationsService['events']['emit']>[1]) =>
        PiApi.piOperationTry('events.emit', () => api.events.emit(channel, data)),
      on: (channel: string, handler: Parameters<PiApi.PiOperationsService['events']['on']>[1]) =>
        PiApi.piOperationTry('events.on', () =>
          PiApi.piOperationTry('events.unsubscribe', api.events.on(channel, handler)),
        ),
      onScoped: (channel: string, handler: Parameters<PiApi.PiOperationsService['events']['onScoped']>[1]) =>
        Effect.acquireRelease(
          PiApi.piOperationTry('events.on', () => api.events.on(channel, handler)),
          (unsubscribe) => Effect.ignore(PiApi.piOperationTry('events.unsubscribe', unsubscribe)),
        ).pipe(Effect.asVoid),
    },
  }
}

function baseContext(raw: ExtensionContext): PiApi.PiContext {
  return {
    mode: raw.mode,
    hasUI: raw.hasUI,
    cwd: raw.cwd,
    signal: raw.signal,
    model: raw.model,
    thinkingLevel: raw.thinkingLevel,
    isIdle: () => PiApi.piOperationTry('isIdle', () => raw.isIdle()),
    isProjectTrusted: () => PiApi.piOperationTry('isProjectTrusted', () => raw.isProjectTrusted()),
    hasPendingMessages: () => PiApi.piOperationTry('hasPendingMessages', () => raw.hasPendingMessages()),
    contextUsage: () => PiApi.piOperationTry('contextUsage', () => raw.getContextUsage()),
    abort: () => PiApi.piOperationTry('abort', () => raw.abort()),
    shutdown: () => PiApi.piOperationTry('shutdown', () => raw.shutdown()),
    compact: (options: Parameters<PiApi.PiContext['compact']>[0]) =>
      PiApi.piOperationTry('compact', () => raw.compact(options)),
    systemPrompt: () => PiApi.piOperationTry('systemPrompt', () => raw.getSystemPrompt()),
  }
}

function createFacade(
  stable: PiStableFacade,
  operations: PiApi.PiOperationsService,
  context: PiApi.PiContext,
  session: PiApi.PiSessionContext,
  command: PiApi.PiCommandContext,
  tool: PiApi.PiToolContext,
  rawUi: PiApi.PiUiAdapter,
): PiStableFacade & {
  context: PiApi.PiContext
  sessionContext: PiApi.PiSessionContext
  commandContext: PiApi.PiCommandContext
  toolContext: PiApi.PiToolContext
  session: ReturnType<typeof PiApi.createPiSessionService>
  ui: PiApi.PiUiService
} {
  const ui = PiApi.createPiUiService(context, rawUi)
  return {
    ...stable,
    context,
    sessionContext: session,
    commandContext: command,
    toolContext: tool,
    session: PiApi.createPiSessionService(operations, session),
    ui,
  }
}

function unavailableCommandContext(context: PiApi.PiContext, session: PiApi.PiSessionContext): PiApi.PiCommandContext {
  const fail = <A>(): Effect.Effect<A, PiApi.PiOperationsError> =>
    Effect.fail(
      new PiApi.PiOperationsError({ operation: 'commandContext', message: 'Command context is unavailable.' }),
    )
  return {
    ...context,
    session,
    systemPromptOptions: () => Effect.succeed({ cwd: context.cwd }),
    waitForIdle: () => fail(),
    newSession: () => fail(),
    fork: () => fail(),
    navigateTree: () => fail(),
    switchSession: () => fail(),
    reload: () => fail(),
  }
}

function unavailableToolContext(context: PiApi.PiContext, session: PiApi.PiSessionContext): PiApi.PiToolContext {
  return {
    ...context,
    session,
    toolCallId: '',
    params: undefined,
    toolSignal: undefined,
    onUpdate: () => Effect.succeed(undefined),
    tools: [],
    executeTool: (name) =>
      Effect.fail(
        new PiApi.PiToolError({
          tool: name,
          operation: 'executeTool',
          message: 'Nested tool calls are unavailable in this invocation.',
        }),
      ),
    executionMode: 'parallel',
  }
}

type Invocation = {
  readonly context: PiApi.PiContext
  readonly session: PiApi.PiSessionContext
  readonly command: PiApi.PiCommandContext
  readonly tool: PiApi.PiToolContext
  readonly pi: ReturnType<typeof createFacade>
}

type InvocationRequirements = PiApi.PiOperations | PiApi.PiStableServices
/** Effect that creates an invocation value from the current Pi context. */
type InvocationEffect = Effect.Effect<Invocation, PiApi.PiOperationsError, InvocationRequirements>

type Invoke<Services> = <A, E>(
  program: Effect.Effect<A, E, Services | PiApi.PiServices>,
  invocation: InvocationEffect,
  signals?: readonly (AbortSignal | undefined)[],
) => Promise<A>

function provideInvocation<A, E, Requirements>(
  program: Effect.Effect<A, E, Requirements>,
  invocation: Invocation,
): Effect.Effect<A, E, Exclude<Requirements, PiApi.PiInvocationServices>> {
  return program.pipe(
    Effect.provideService(PiApi.Pi, invocation.pi),
    Effect.provideService(PiApi.PiContext, invocation.context),
    Effect.provideService(PiApi.PiSessionContext, invocation.session),
    Effect.provideService(PiApi.PiCommandContext, invocation.command),
    Effect.provideService(PiApi.PiToolContext, invocation.tool),
    Effect.provideService(PiApi.PiSession, invocation.pi.session),
    Effect.provideService(PiApi.PiUi, invocation.pi.ui),
  ) as Effect.Effect<A, E, Exclude<Requirements, PiApi.PiInvocationServices>>
}

const getRuntimeServices = Effect.fnUntraced(function* (): Effect.fn.Return<
  { readonly operations: PiApi.PiOperationsService; readonly stable: PiStableFacade },
  never,
  InvocationRequirements
> {
  const operations = yield* PiApi.PiOperations
  return {
    operations,
    stable: {
      messages: yield* PiApi.PiMessages,
      tools: yield* PiApi.PiTools,
      flags: yield* PiApi.PiFlags,
      process: yield* PiApi.PiProcess,
      events: operations.events,
      model: { set: operations.setModel },
    },
  }
})

const createInvocation = Effect.fnUntraced(function* <Services>(
  raw: ExtensionContext,
  command?: ExtensionCommandContext,
  tool?: {
    toolCallId: string
    params: unknown
    signal: AbortSignal | undefined
    onUpdate?: PiToolUpdateHandler
    executionMode?: 'sequential' | 'parallel'
    nativeContext: ExtensionToolContext
  },
  invoke?: Invoke<Services>,
): Effect.fn.Return<Invocation, PiApi.PiOperationsError, InvocationRequirements> {
  const { operations, stable } = yield* getRuntimeServices()
  const context = yield* PiApi.piOperationTry('context', () => baseContext(raw))
  const manager = yield* PiApi.piOperationTry('sessionManager', () => raw.sessionManager)
  const session = yield* sessionContextFromManager(manager)
  return yield* PiApi.piOperationTry('invocation', () => {
    const runNested: Invoke<Services> =
      invoke ??
      (async <A, _E>(): Promise<A> =>
        Promise.reject(
          new PiRuntimeDisposedError({ operation: 'nested', message: 'Nested invocation is unavailable.' }),
        ))
    const commandValue = command
      ? commandContext(command, { context, session }, runNested)
      : unavailableCommandContext(context, session)
    const toolValue = tool ? toolContext(context, session, tool) : unavailableToolContext(context, session)
    return {
      context,
      session,
      command: commandValue,
      tool: toolValue,
      pi: createFacade(stable, operations, context, session, commandValue, toolValue, createPiUiAdapter(raw.ui)),
    }
  })
})

function commandContext<Services>(
  raw: ExtensionCommandContext,
  invocation: Pick<Invocation, 'context' | 'session'>,
  invoke: Invoke<Services>,
): PiApi.PiCommandContext {
  const { context, session } = invocation
  return {
    ...context,
    session,
    systemPromptOptions: () => PiApi.piOperationTry('systemPromptOptions', () => raw.getSystemPromptOptions()),
    waitForIdle: () => PiApi.piOperationTryPromise('waitForIdle', () => raw.waitForIdle()),
    newSession: (options: PiApi.PiSessionChangeOptions | undefined) => {
      const setup = options?.setup
      return PiApi.piOperationTryPromise('newSession', () =>
        raw.newSession({
          parentSession: options?.parentSession,
          setup: setup
            ? async (manager: SessionManager) =>
                invoke(
                  Effect.flatMap(sessionContextFromManager(manager), (session) => setup(session)),
                  createInvocation(raw, raw, undefined, invoke),
                  [raw.signal],
                )
            : undefined,
        }),
      )
    },
    fork: (entryId: string, options?: Parameters<PiApi.PiCommandContext['fork']>[1]) => {
      const withSession = options?.withSession
      return PiApi.piOperationTryPromise('fork', () =>
        raw.fork(entryId, {
          position: options?.position,
          withSession: withSession
            ? async (replacement: PiReplacedSessionContext) =>
                invoke(
                  Effect.gen(function* () {
                    const context = yield* PiApi.PiCommandContext
                    const session = yield* PiApi.PiSessionContext
                    return yield* withSession({ context, session })
                  }),
                  createInvocation(replacement, replacement, undefined, invoke),
                  [replacement.signal],
                )
            : undefined,
        }),
      )
    },
    navigateTree: (targetId: string, options?: Parameters<PiApi.PiCommandContext['navigateTree']>[1]) =>
      PiApi.piOperationTryPromise('navigateTree', () => raw.navigateTree(targetId, options)),
    switchSession: (sessionPath: string, options?: Parameters<PiApi.PiCommandContext['switchSession']>[1]) => {
      const withSession = options?.withSession
      return PiApi.piOperationTryPromise('switchSession', () =>
        raw.switchSession(sessionPath, {
          withSession: withSession
            ? async (replacement: PiReplacedSessionContext) =>
                invoke(
                  Effect.gen(function* () {
                    const context = yield* PiApi.PiCommandContext
                    const session = yield* PiApi.PiSessionContext
                    return yield* withSession({ context, session })
                  }),
                  createInvocation(replacement, replacement, undefined, invoke),
                  [replacement.signal],
                )
            : undefined,
        }),
      )
    },
    reload: () => PiApi.piOperationTryPromise('reload', () => raw.reload()),
  }
}

const sessionContextFromManager = Effect.fnUntraced(function* (
  manager: ExtensionCommandContext['sessionManager'],
): Effect.fn.Return<PiApi.PiSessionContext, PiApi.PiOperationsError> {
  return yield* PiApi.piOperationTry('sessionContext', () => ({
    cwd: manager.getCwd(),
    id: manager.getSessionId(),
    file: manager.getSessionFile(),
    directory: manager.getSessionDir(),
    leafId: manager.getLeafId(),
    leaf: manager.getLeafEntry(),
    entries: manager.getEntries(),
    tree: manager.getTree(),
    entry: (id: string) => PiApi.piOperationTry('entry', () => manager.getEntry(id)),
    branch: (fromId?: string) => PiApi.piOperationTry('branch', () => manager.getBranch(fromId)),
    contextEntries: () => PiApi.piOperationTry('contextEntries', () => manager.buildContextEntries()),
    label: (entryId: string) => PiApi.piOperationTry('label', () => manager.getLabel(entryId)),
    name: manager.getSessionName(),
  }))
})

function toolContext(
  context: PiApi.PiContext,
  session: PiApi.PiSessionContext,
  tool: {
    toolCallId: string
    params: unknown
    signal: AbortSignal | undefined
    onUpdate?: PiToolUpdateHandler
    executionMode?: 'sequential' | 'parallel'
    nativeContext: ExtensionToolContext
  },
): PiApi.PiToolContext {
  return {
    ...context,
    session,
    toolCallId: tool.toolCallId,
    params: tool.params,
    toolSignal: tool.signal,
    onUpdate: (update: Parameters<NonNullable<PiApi.PiToolContext['onUpdate']>>[0]) => {
      if (!tool.onUpdate) return Effect.succeed(undefined)
      return Effect.try({
        try: () => tool.onUpdate?.(update),
        catch: (cause: unknown) =>
          new PiApi.PiToolError({
            tool: tool.toolCallId,
            operation: 'onUpdate',
            message: PiApi.piCauseMessage(cause),
            cause,
          }),
      })
    },
    tools: tool.nativeContext.tools,
    executeTool: (name, args, options) =>
      Effect.tryPromise({
        try: () => tool.nativeContext.executeTool(name, args, options),
        catch: (cause: unknown) =>
          new PiApi.PiToolError({
            tool: name,
            operation: 'executeTool',
            message: PiApi.piCauseMessage(cause),
            cause,
          }),
      }),
    executionMode: tool.executionMode ?? 'parallel',
  }
}

function neutralResult(name: PiEventName): unknown {
  switch (name) {
    case 'project_trust':
      return { trusted: 'undecided' as const }
    case 'input':
      return { action: 'continue' as const }
    case 'tool_call':
      return { block: true, reason: 'The tool-call handler failed.' }
    case 'session_before_switch':
    case 'session_before_fork':
    case 'session_before_compact':
    case 'session_before_tree':
      return {}
    default:
      return undefined
  }
}

function trustInvocation(
  operations: PiApi.PiOperationsService,
  stable: PiStableFacade,
  raw: ProjectTrustContext,
): Invocation {
  const context: PiApi.PiContext = {
    mode: raw.mode,
    hasUI: raw.hasUI,
    cwd: raw.cwd,
    signal: undefined,
    model: undefined,
    thinkingLevel: undefined,
    isIdle: () => Effect.succeed(true),
    isProjectTrusted: () => Effect.succeed(false),
    hasPendingMessages: () => Effect.succeed(false),
    contextUsage: () => Effect.succeed(undefined),
    abort: () => PiApi.piOperationTry('abort', () => undefined),
    shutdown: () => PiApi.piOperationTry('shutdown', () => undefined),
    compact: () => PiApi.piOperationTry('compact', () => undefined),
    systemPrompt: () => PiApi.piOperationTry('systemPrompt', () => ''),
  }
  const session = emptySessionContext()
  const command = unavailableCommandContext(context, session)
  const tool = unavailableToolContext(context, session)
  const ui: PiApi.PiUiAdapter = {
    ...emptyPiUiAdapter(raw.mode),
    select: (
      title: string,
      options: Parameters<PiApi.PiUiAdapter['select']>[1],
      dialog?: Parameters<PiApi.PiUiAdapter['select']>[2],
    ) => raw.ui.select(title, [...options], dialog),
    confirm: raw.ui.confirm,
    input: raw.ui.input,
    notify: raw.ui.notify,
  }
  return { context, session, command, tool, pi: createFacade(stable, operations, context, session, command, tool, ui) }
}

type PiRuntimeEventContext = ExtensionContext | ProjectTrustContext

type PiRuntimeEventInvocation = {
  effect: InvocationEffect
  signal: AbortSignal | undefined
}

type PiRuntimeEventOn = {
  (name: 'session_shutdown', callback: (event: unknown, context: ExtensionContext) => Promise<unknown>): void
  (name: PiEventName, callback: (event: unknown, context: PiRuntimeEventContext | undefined) => Promise<unknown>): void
}

function registerEventHandler<Services, Failure>(
  name: PiEventName,
  handler: PiEventCallback<Services, Failure>,
  policy: PiFailurePolicy,
  rawEvent: unknown,
  invocation: PiRuntimeEventInvocation,
  invoke: Invoke<Services | PiApi.PiServices>,
): Promise<unknown> {
  const program = Effect.suspend(() => handler(rawEvent))
  return invoke(program, invocation.effect, [invocation.signal]).catch((cause) => {
    if (policy === 'propagate') throw cause
    if (policy === 'failClosed') return neutralResult(name)
    return neutralResult(name)
  })
}

function bootstrapInvocation(operations: PiApi.PiOperationsService, stable: PiStableFacade): InvocationEffect {
  const context = emptyInvocationContext()
  const session = emptySessionContext()
  const command = unavailableCommandContext(context, session)
  const tool = unavailableToolContext(context, session)
  return Effect.succeed({
    context,
    session,
    command,
    tool,
    pi: createFacade(stable, operations, context, session, command, tool, emptyPiUiAdapter(context.mode)),
  })
}

type PiRuntimeEventRegistrar<RegistrationServices, Failure> = {
  readonly events: {
    readonly register: (
      name: PiEventName,
      handler: PiEventCallback<RegistrationServices, Failure>,
      policy: PiFailurePolicy,
    ) => void
  }
  readonly registerShutdownHandler: Effect.Effect<void, PiRegistrationError>
}

type PiRuntimeCommandRegistrar<RegistrationServices, Failure> = {
  readonly register: (
    name: string,
    definition: Parameters<PiRegistrationContext<RegistrationServices, Failure>['commands']['register']>[1],
  ) => void
}

function createPiRuntimeEventRegistrar<RegistrationServices, Failure>(
  api: ExtensionAPI,
  operations: PiApi.PiOperationsService,
  stable: PiStableFacade,
  runtime: PiManagedRuntime<RegistrationServices | PiApi.PiStableServices | PiApi.PiOperations, Failure>,
  run: Invoke<RegistrationServices | PiApi.PiServices>,
): PiRuntimeEventRegistrar<RegistrationServices, Failure> {
  const shutdownHandlers: Array<PiEventCallback<RegistrationServices, Failure>> = []
  let shutdownPromise: Promise<void> | undefined
  const rawOn = api.on as PiRuntimeEventOn
  const eventInvocation = (context: PiRuntimeEventContext | undefined): PiRuntimeEventInvocation =>
    context === undefined
      ? { effect: bootstrapInvocation(operations, stable), signal: undefined }
      : 'sessionManager' in context
        ? {
            effect: createInvocation(context, undefined, undefined, run),
            signal: context.signal,
          }
        : {
            effect: PiApi.piOperationTry('projectTrustContext', () => trustInvocation(operations, stable, context)),
            signal: undefined,
          }
  const registerShutdownHandler: Effect.Effect<void, PiRegistrationError> = Effect.try({
    try: () =>
      rawOn('session_shutdown', async (event, context) => {
        if (shutdownPromise) return shutdownPromise
        runtime.beginShutdown()
        shutdownPromise = (async () => {
          try {
            for (const registered of shutdownHandlers) {
              const invocation = createInvocation(context, undefined, undefined, run)
              await runtime.runShutdown(
                invocation.pipe(
                  Effect.flatMap((current) =>
                    provideInvocation(
                      Effect.suspend(() => registered(event)),
                      current,
                    ),
                  ),
                ),
                [context.signal],
              )
            }
          } finally {
            await runtime.dispose()
          }
        })()
        return shutdownPromise
      }),
    catch: (cause: unknown) =>
      new PiRegistrationError({
        registration: 'event:session_shutdown',
        message: PiApi.piCauseMessage(cause),
        cause,
      }),
  })
  const events = {
    register: (
      name: PiEventName,
      handler: PiEventCallback<RegistrationServices, Failure>,
      policy: PiFailurePolicy,
    ): void => {
      if (name === 'session_shutdown') {
        shutdownHandlers.push(handler)
        return
      }
      rawOn(name, (event, context) => registerEventHandler(name, handler, policy, event, eventInvocation(context), run))
    },
  }

  return { events, registerShutdownHandler }
}

function createPiRuntimeCommandRegistrar<RegistrationServices, Failure>(
  api: ExtensionAPI,
  operations: PiApi.PiOperationsService,
  stable: PiStableFacade,
  runtime: PiManagedRuntime<RegistrationServices | PiApi.PiStableServices | PiApi.PiOperations, Failure>,
  run: Invoke<RegistrationServices | PiApi.PiServices>,
): PiRuntimeCommandRegistrar<RegistrationServices, Failure> {
  return {
    register: (
      name: string,
      definition: Parameters<PiRegistrationContext<RegistrationServices, Failure>['commands']['register']>[1],
    ): void => {
      const getArgumentCompletions = definition.getArgumentCompletions
      api.registerCommand(name, {
        description: definition.description,
        getArgumentCompletions: getArgumentCompletions
          ? (prefix: string) => {
              if (runtime.isClosing()) return Promise.resolve(null)
              return run(
                Effect.suspend(() => getArgumentCompletions(prefix)),
                bootstrapInvocation(operations, stable),
                [],
              ).then((items) => (items === null ? null : [...items]))
            }
          : undefined,
        handler: (args: string, context: ExtensionCommandContext) => {
          if (runtime.isClosing()) return Promise.resolve()
          return run(
            Effect.suspend(() => definition.handler(args)),
            createInvocation(context, context, undefined, run),
            [context.signal],
          )
        },
      })
    },
  }
}

async function installPiRuntimeRegistrations<RegistrationServices, Failure>(
  api: ExtensionAPI,
  operations: PiApi.PiOperationsService,
  runtime: PiManagedRuntime<RegistrationServices | PiApi.PiStableServices | PiApi.PiOperations, Failure>,
  setup: (
    registrations: PiRegistrationContext<RegistrationServices, Failure>,
  ) => Effect.Effect<void, Failure | PiRegistrationError, RegistrationServices | PiApi.PiStableServices>,
): Promise<void> {
  const run: Invoke<RegistrationServices | PiApi.PiServices> = async <A, E>(
    program: Effect.Effect<A, E, RegistrationServices | PiApi.PiServices>,
    invocation: InvocationEffect,
    signals: readonly (AbortSignal | undefined)[] = [],
  ): Promise<A> =>
    runtime.run(invocation.pipe(Effect.flatMap((current) => provideInvocation(program, current))), signals)
  const { stable } = await runtime.run(getRuntimeServices())
  const { events, registerShutdownHandler } = createPiRuntimeEventRegistrar(api, operations, stable, runtime, run)
  const registries = createPiRegistries<RegistrationServices, Failure>({
    events,
    commands: createPiRuntimeCommandRegistrar(api, operations, stable, runtime, run),
    shortcuts: {
      register: (
        shortcut: Parameters<PiRegistrationContext<RegistrationServices, Failure>['shortcuts']['register']>[0],
        definition: Parameters<PiRegistrationContext<RegistrationServices, Failure>['shortcuts']['register']>[1],
      ) =>
        api.registerShortcut(shortcut, {
          description: definition.description,
          handler: (context: ExtensionContext) => {
            if (runtime.isClosing()) return Promise.resolve()
            return run(
              Effect.suspend(() => definition.handler()),
              createInvocation(context, undefined, undefined, run),
              [context.signal],
            )
          },
        }),
    },
    flags: {
      register: (
        name: string,
        definition: Parameters<PiRegistrationContext<RegistrationServices, Failure>['flags']['register']>[1],
      ) => api.registerFlag(name, definition),
    },
    tools: {
      register: <
        Params extends TSchema,
        ToolServices extends RegistrationServices | PiApi.PiServices,
        ToolFailure,
        Details,
      >(
        definition: PiApi.EffectToolDefinition<Params, ToolServices, ToolFailure, Details>,
      ) => api.registerTool(toPiTool(definition, run)),
    },
    renderers: {
      registerMessage: (
        customType: string,
        renderer: Parameters<PiRegistrationContext<RegistrationServices, Failure>['renderers']['message']>[1],
      ) => api.registerMessageRenderer(customType, renderer),
      registerEntry: (
        customType: string,
        renderer: Parameters<PiRegistrationContext<RegistrationServices, Failure>['renderers']['entry']>[1],
      ) => api.registerEntryRenderer(customType, renderer),
    },
  })

  try {
    await runtime.run(registerShutdownHandler.pipe(Effect.flatMap(() => Effect.suspend(() => setup(registries)))))
  } catch (cause) {
    await runtime.dispose()
    throw cause
  }
}

async function installPiRuntime<Services, Failure>(
  api: ExtensionAPI,
  operations: PiApi.PiOperationsService,
  operationsLayer: Layer.Layer<PiApi.PiOperations, never, never>,
  stableLayer: Layer.Layer<PiApi.PiStableServices, never, PiApi.PiOperations>,
  plugin: PiPlugin<Services, Failure>,
): Promise<void> {
  const baseLayer = stableLayer.pipe(Layer.provideMerge(operationsLayer))

  if (plugin.layer !== undefined) {
    const pluginLayer = plugin.layer.pipe(Layer.provide(baseLayer))
    const runtime = createPiManagedRuntime(Layer.merge(pluginLayer, baseLayer))
    await installPiRuntimeRegistrations(api, operations, runtime, (registrations) => plugin.effect(registrations))
  } else {
    const runtime = createPiManagedRuntime(baseLayer)
    await installPiRuntimeRegistrations<never, Failure>(api, operations, runtime, (registrations) =>
      plugin.effect(registrations),
    )
  }
}

/**
 * Creates a Pi extension factory that provides Pi services and installs the plugin runtime.
 * @param plugin Plugin definition to install.
 * @returns Extension factory that Pi can load.
 */
function installPiPlugin<Services, Failure>(plugin: PiPlugin<Services, Failure>): ExtensionFactory {
  return async (api: ExtensionAPI) => {
    const operations = createPiOperationsService(api)
    const operationsLayer = Layer.succeed(PiApi.PiOperations, operations)
    const stableLayer: Layer.Layer<PiApi.PiStableServices, never, PiApi.PiOperations> = Layer.mergeAll(
      Layer.effect(PiApi.PiMessages, Effect.map(PiApi.PiOperations, PiApi.createPiMessagesService)),
      Layer.effect(PiApi.PiTools, Effect.map(PiApi.PiOperations, PiApi.createPiToolsService)),
      Layer.effect(PiApi.PiFlags, Effect.map(PiApi.PiOperations, PiApi.createPiFlagsService)),
      Layer.effect(PiApi.PiProcess, Effect.map(PiApi.PiOperations, PiApi.createPiProcessService)),
    )
    await installPiRuntime(api, operations, operationsLayer, stableLayer, plugin)
  }
}

function toPiTool<
  Params extends TSchema,
  RuntimeServices,
  ToolServices extends RuntimeServices | PiApi.PiServices,
  Failure,
  Details,
>(
  definition: PiApi.EffectToolDefinition<Params, ToolServices, Failure, Details>,
  run: Invoke<RuntimeServices>,
): ToolDefinition<Params, Details> {
  return {
    ...definition,
    promptGuidelines: [...definition.promptGuidelines],
    execute: async (
      toolCallId: string,
      params: Static<Params>,
      signal: AbortSignal | undefined,
      onUpdate: AgentToolUpdateCallback<Details> | undefined,
      context: ExtensionToolContext,
    ) => {
      const invocation = createInvocation(
        context,
        undefined,
        {
          toolCallId,
          params,
          signal,
          onUpdate,
          executionMode: definition.executionMode,
          nativeContext: context,
        },
        run,
      )
      try {
        return await run(
          Effect.suspend(() => definition.execute(params)),
          invocation,
          [signal, context.signal],
        )
      } catch (cause) {
        if (cause instanceof PiApi.PiToolError) throw cause
        throw new PiApi.PiToolError({
          tool: definition.name,
          operation: 'execute',
          message: PiApi.piCauseMessage(cause),
          cause,
        })
      }
    },
  }
}

function emptyInvocationContext(): PiApi.PiContext {
  return {
    mode: 'print',
    hasUI: false,
    cwd: '',
    signal: undefined,
    model: undefined,
    thinkingLevel: undefined,
    isIdle: () => Effect.succeed(true),
    isProjectTrusted: () => Effect.succeed(false),
    hasPendingMessages: () => Effect.succeed(false),
    contextUsage: () => Effect.succeed(undefined),
    abort: () => Effect.succeed(undefined),
    shutdown: () => Effect.succeed(undefined),
    compact: () => Effect.succeed(undefined),
    systemPrompt: () => Effect.succeed(''),
  }
}

function emptySessionContext(): PiApi.PiSessionContext {
  return {
    cwd: '',
    id: '',
    file: undefined,
    directory: '',
    leafId: null,
    leaf: undefined,
    entries: [],
    tree: [],
    entry: () => Effect.succeed(undefined),
    branch: () => Effect.succeed([]),
    contextEntries: () => Effect.succeed([]),
    label: () => Effect.succeed(undefined),
    name: undefined,
  }
}

export {
  createPiManagedRuntime,
  createPiRegistries,
  createPiUiAdapter,
  defaultPiFailurePolicy,
  emptyPiUiAdapter,
  type InvocationEffect,
  installPiPlugin,
  type PiCommandDefinition,
  type PiCommandRegistrar,
  type PiCommandRegistry,
  type PiEntryRenderer,
  type PiEventCallback,
  type PiEventHandler,
  type PiEventMap,
  type PiEventName,
  type PiEventOptions,
  type PiEventRegistrar,
  type PiEventRegistry,
  type PiEventResultMap,
  PiExtension,
  type PiExtensionError,
  type PiFailurePolicy,
  type PiFlagDefinition,
  type PiFlagRegistrar,
  type PiFlagRegistry,
  type PiManagedRuntime,
  type PiMessageRenderer,
  type PiPlugin,
  type PiPluginDefinition,
  type PiRegistrationContext,
  PiRegistrationError,
  type PiRendererDefinition,
  type PiRendererRegistrar,
  type PiRendererRegistry,
  PiRuntimeDisposedError,
  type PiRuntimeLayer,
  type PiShortcutDefinition,
  type PiShortcutRegistrar,
  type PiShortcutRegistry,
  type PiToolRegistrar,
  type PiToolRegistry,
}
