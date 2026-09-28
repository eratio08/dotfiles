import type {
  BeforeAgentStartEventResult,
  BeforeProviderRequestEventResult,
  ContextEvent,
  EntryRenderer,
  ExtensionEvent,
  InputEventResult,
  MessageEndEvent,
  MessageRenderer,
  ProjectTrustEventResult,
  ToolCallEventResult,
  ToolResultEvent,
  UserBashEventResult,
} from '@earendil-works/pi-coding-agent'
import type { AutocompleteItem, KeyId } from '@earendil-works/pi-tui'
import { Context, Effect, Schema } from 'effect'
import type { TSchema } from 'typebox'
import { type PiExtensionError, type PiOperationsError, PiRegistrationError } from './errors.ts'
import type { PiOperationsService, PiServices } from './pi.ts'
import type { EffectToolDefinition } from './tools.ts'

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
  | Effect.Effect<PiEventResult<Name> | undefined, Failure, Services | PiServices>
  | Effect.Effect<void, Failure, Services | PiServices>

/** Policy for handling a failed event handler: return the failure, keep the event neutral, or reject the action. */
type PiFailurePolicy = 'propagate' | 'neutral' | 'failClosed'
/** Optional event registration settings. */
type PiEventOptions = {
  /** Overrides `defaultPiFailurePolicy` for a failed event handler. */
  readonly failure?: PiFailurePolicy
}

/** Runtime-neutral callback shape used by the Pi event registrar. */
type PiEventCallback<Services, Failure> = {
  run(event: unknown): Effect.Effect<unknown, Failure, Services | PiServices>
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
  ) => Effect.Effect<readonly AutocompleteItem[] | null, Failure, Services | PiServices>
  /** Runs the command with the argument text supplied by Pi. */
  readonly handler: (args: string) => Effect.Effect<void, Failure, Services | PiServices>
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
  readonly handler: () => Effect.Effect<void, Failure, Services | PiServices>
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
  readonly register: <Params extends TSchema, ToolServices extends Services | PiServices, ToolFailure, Details>(
    definition: EffectToolDefinition<Params, ToolServices, ToolFailure, Details>,
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

/** Effect API for registering tools that run as Effects. */
type PiToolRegistry<Services> = {
  /** Registers a tool and returns an Effect that fails if registration fails. */
  readonly register: <Params extends TSchema, ToolServices extends Services | PiServices, ToolFailure, Details>(
    definition: EffectToolDefinition<Params, ToolServices, ToolFailure, Details>,
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
    register: <Params extends TSchema, ToolServices extends Services | PiServices, ToolFailure, Details>(
      definition: EffectToolDefinition<Params, ToolServices, ToolFailure, Details>,
    ) => registerEffect(`tool:${definition.name}`, () => registrars.tools.register(definition)),
  }
  const renderers: PiRendererRegistry = {
    message: (customType: string, renderer: Parameters<PiRendererRegistry['message']>[1]) =>
      registerEffect(`message-renderer:${customType}`, () => registrars.renderers.registerMessage(customType, renderer)),
    entry: (customType: string, renderer: Parameters<PiRendererRegistry['entry']>[1]) =>
      registerEffect(`entry-renderer:${customType}`, () => registrars.renderers.registerEntry(customType, renderer)),
  }

  return { events, commands, shortcuts, flags, tools, renderers }
}

export {
  createPiFlagsService,
  createPiRegistries,
  defaultPiFailurePolicy,
  type PiCommandDefinition,
  type PiCommandRegistrar,
  type PiCommandRegistry,
  type PiEventCallback,
  type PiEventHandler,
  type PiEventMap,
  type PiEventName,
  type PiEventOptions,
  type PiEventRegistrar,
  type PiEventRegistry,
  type PiEventResultMap,
  type PiFailurePolicy,
  type PiFlagDefinition,
  type PiFlagRegistrar,
  type PiFlagRegistry,
  PiFlags,
  type PiFlagsService,
  type PiRegistrationContext,
  type PiRendererDefinition,
  type PiRendererRegistrar,
  type PiRendererRegistry,
  type PiShortcutDefinition,
  type PiShortcutRegistrar,
  type PiShortcutRegistry,
  type PiToolRegistrar,
  type PiToolRegistry,
}
