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
import { Effect, Schema } from 'effect'
import type { TSchema } from 'typebox'
import { type PiExtensionError, PiRegistrationError } from './errors.ts'
import type { PiServices } from './services.ts'
import type { EffectToolDefinition } from './tools.ts'

type PiEventName = ExtensionEvent['type']
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

type PiEventResultMap = {
  [Name in PiEventName]: Name extends keyof PiEventResults ? PiEventResults[Name] : undefined
}
type PiEventResult<Name extends PiEventName> = PiEventResultMap[Name]
type PiEventHandler<Services, Failure, Name extends PiEventName> = (
  event: PiEventMap[Name],
) => Effect.Effect<PiEventResult<Name> | undefined, Failure, Services | PiServices>

type PiFailurePolicy = 'propagate' | 'neutral' | 'failClosed'
type PiEventOptions = {
  readonly failure?: PiFailurePolicy
}

type PiEventCallback<Services, Failure> = {
  run(event: unknown): Effect.Effect<unknown, Failure, Services | PiServices>
}['run']

interface PiEventRegistrationPort<Services, Failure> {
  readonly register: (name: PiEventName, handler: PiEventCallback<Services, Failure>, policy: PiFailurePolicy) => void
}

interface PiCommandRegistrationPort<Services, Failure> {
  readonly register: (name: string, definition: PiCommandDefinition<Services, Failure>) => void
}

interface PiCommandDefinition<Services, Failure> {
  readonly description?: string
  readonly getArgumentCompletions?: (
    argumentPrefix: string,
  ) => Effect.Effect<readonly AutocompleteItem[] | null, Failure, Services | PiServices>
  readonly handler: (args: string) => Effect.Effect<void, Failure, Services | PiServices>
}

interface PiShortcutRegistrationPort<Services, Failure> {
  readonly register: (shortcut: KeyId, definition: PiShortcutDefinition<Services, Failure>) => void
}

interface PiShortcutDefinition<Services, Failure> {
  readonly description?: string
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
type PiFlagDefinition = Schema.Schema.Type<typeof PiFlagDefinitionSchema>

interface PiRendererRegistrationPort {
  readonly registerMessage: (customType: string, renderer: MessageRenderer) => void
  readonly registerEntry: (customType: string, renderer: EntryRenderer) => void
}

interface PiFlagRegistrationPort {
  readonly register: (name: string, definition: PiFlagDefinition) => void
}

interface PiToolRegistrationPort<Services, Failure> {
  readonly register: <Params extends TSchema, Details>(
    definition: EffectToolDefinition<Params, Services | PiServices, Failure, Details>,
  ) => void
}

interface PiRendererDefinition {
  readonly customType: string
  readonly render: MessageRenderer | EntryRenderer
}

interface PiEventRegistry<Services, Failure = PiExtensionError> {
  readonly on: <Name extends PiEventName>(
    name: Name,
    handler: PiEventHandler<Services, Failure, Name>,
    options?: PiEventOptions,
  ) => Effect.Effect<void, PiRegistrationError>
}

interface PiCommandRegistry<Services, Failure = PiExtensionError> {
  readonly register: (
    name: string,
    definition: PiCommandDefinition<Services, Failure>,
  ) => Effect.Effect<void, PiRegistrationError>
}

interface PiShortcutRegistry<Services, Failure = PiExtensionError> {
  readonly register: (
    shortcut: KeyId,
    definition: PiShortcutDefinition<Services, Failure>,
  ) => Effect.Effect<void, PiRegistrationError>
}

interface PiFlagRegistry {
  readonly register: (name: string, definition: PiFlagDefinition) => Effect.Effect<void, PiRegistrationError>
}

interface PiToolRegistry<Services, Failure = PiExtensionError> {
  readonly register: <Params extends TSchema, Details>(
    definition: EffectToolDefinition<Params, Services | PiServices, Failure, Details>,
  ) => Effect.Effect<void, PiRegistrationError>
}

interface PiRendererRegistry {
  readonly message: (customType: string, renderer: MessageRenderer) => Effect.Effect<void, PiRegistrationError>
  readonly entry: (customType: string, renderer: EntryRenderer) => Effect.Effect<void, PiRegistrationError>
}

interface PiRegistrationContext<Services, Failure = PiExtensionError> {
  readonly events: PiEventRegistry<Services, Failure>
  readonly commands: PiCommandRegistry<Services, Failure>
  readonly shortcuts: PiShortcutRegistry<Services, Failure>
  readonly flags: PiFlagRegistry
  readonly tools: PiToolRegistry<Services, Failure>
  readonly renderers: PiRendererRegistry
}

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
    catch: (cause) =>
      new PiRegistrationError({
        registration,
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  })
})

function createPiRegistries<Services, Failure = PiExtensionError>(ports: {
  readonly events: PiEventRegistrationPort<Services, Failure>
  readonly commands: PiCommandRegistrationPort<Services, Failure>
  readonly shortcuts: PiShortcutRegistrationPort<Services, Failure>
  readonly flags: PiFlagRegistrationPort
  readonly tools: PiToolRegistrationPort<Services, Failure>
  readonly renderers: PiRendererRegistrationPort
}): PiRegistrationContext<Services, Failure> {
  const events: PiEventRegistry<Services, Failure> = {
    on: (name, handler, options) =>
      registerEffect(`event:${name}`, () =>
        ports.events.register(
          name,
          (event: PiEventMap[typeof name]) => handler(event),
          options?.failure ?? defaultPiFailurePolicy(name),
        ),
      ),
  }
  const commands: PiCommandRegistry<Services, Failure> = {
    register: (name, definition) => registerEffect(`command:${name}`, () => ports.commands.register(name, definition)),
  }
  const shortcuts: PiShortcutRegistry<Services, Failure> = {
    register: (shortcut, definition) =>
      registerEffect(`shortcut:${shortcut}`, () => ports.shortcuts.register(shortcut, definition)),
  }
  const flags: PiFlagRegistry = {
    register: (name, definition) =>
      registerEffect(`flag:${name}`, () =>
        ports.flags.register(name, Schema.decodeUnknownSync(PiFlagDefinitionSchema)(definition)),
      ),
  }
  const tools: PiToolRegistry<Services, Failure> = {
    register: (definition) => registerEffect(`tool:${definition.name}`, () => ports.tools.register(definition)),
  }
  const renderers: PiRendererRegistry = {
    message: (customType, renderer) =>
      registerEffect(`message-renderer:${customType}`, () => ports.renderers.registerMessage(customType, renderer)),
    entry: (customType, renderer) =>
      registerEffect(`entry-renderer:${customType}`, () => ports.renderers.registerEntry(customType, renderer)),
  }

  return { events, commands, shortcuts, flags, tools, renderers }
}

export {
  createPiRegistries,
  defaultPiFailurePolicy,
  type PiCommandDefinition,
  type PiCommandRegistrationPort,
  type PiCommandRegistry,
  type PiEventCallback,
  type PiEventHandler,
  type PiEventMap,
  type PiEventName,
  type PiEventOptions,
  type PiEventRegistrationPort,
  type PiEventRegistry,
  type PiEventResultMap,
  type PiFailurePolicy,
  type PiFlagDefinition,
  type PiFlagRegistrationPort,
  type PiFlagRegistry,
  type PiRegistrationContext,
  type PiRendererDefinition,
  type PiRendererRegistrationPort,
  type PiRendererRegistry,
  type PiShortcutDefinition,
  type PiShortcutRegistrationPort,
  type PiShortcutRegistry,
  type PiToolRegistrationPort,
  type PiToolRegistry,
}
