import type {
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionFactory,
  ProjectTrustContext,
  SessionManager,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Effect, Layer } from 'effect'
import type { Static, TSchema } from 'typebox'
import {
  combinePiAbortSignals,
  createPiSessionService,
  PiCommandContext,
  type PiCommandContextValue,
  PiContext,
  type PiContextValue,
  PiSession,
  type PiSessionChangeOptions,
  PiSessionContext,
  type PiSessionContextValue,
  PiToolContext,
  type PiToolContextValue,
} from './context.ts'
import {
  PiOperationsError,
  PiRegistrationError,
  PiRuntimeDisposedError,
  PiToolError,
  piCauseMessage,
  piOperationTry,
  piOperationTryPromise,
} from './errors.ts'
import { createPiMessagesService, type PiCustomMessage, PiMessages } from './messages.ts'
import {
  Pi,
  type PiInvocationServices,
  PiOperations,
  type PiOperationsService,
  type PiServices,
  type PiStableServices,
} from './pi.ts'
import type { PiPlugin } from './plugin.ts'
import { createPiProcessService, PiProcess } from './process.ts'
import {
  createPiFlagsService,
  createPiRegistries,
  type PiEventCallback,
  type PiEventName,
  type PiFailurePolicy,
  PiFlags,
  type PiRegistrationContext,
} from './registries.ts'
import { createPiManagedRuntime, type PiManagedRuntime } from './runtime.ts'
import { createPiToolsService, type EffectToolDefinition, PiTools } from './tools.ts'
import {
  createPiUiAdapter,
  createPiUiService,
  emptyPiUiAdapter,
  PiUi,
  type PiUiAdapter,
  type PiUiService,
} from './ui.ts'

type PiToolUpdateHandler = {
  onUpdate(update: unknown): void
}['onUpdate']

type PiStableFacade = Pick<Pi['Service'], 'messages' | 'tools' | 'flags' | 'process' | 'events' | 'model'>

type PiReplacedSessionContext = Parameters<
  NonNullable<NonNullable<Parameters<ExtensionCommandContext['switchSession']>[1]>['withSession']>
>[0]

function createPiOperationsService(api: ExtensionAPI): PiOperationsService {
  return {
    exec: (
      command: string,
      args: Parameters<PiOperationsService['exec']>[1],
      options?: Parameters<PiOperationsService['exec']>[2],
    ) =>
      piOperationTryPromise('exec', (signal) =>
        api.exec(command, [...args], {
          ...options,
          signal: combinePiAbortSignals(options?.signal, signal),
        }),
      ),
    sendMessage: <TDetails>(
      message: PiCustomMessage<TDetails>,
      options?: Parameters<PiOperationsService['sendMessage']>[1],
    ) =>
      piOperationTry('sendMessage', () =>
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
      content: Parameters<PiOperationsService['sendUserMessage']>[0],
      options?: Parameters<PiOperationsService['sendUserMessage']>[1],
    ) =>
      piOperationTry('sendUserMessage', () =>
        api.sendUserMessage(typeof content === 'string' ? content : [...content], options),
      ),
    appendEntry: (customType: string, data?: Parameters<PiOperationsService['appendEntry']>[1]) =>
      piOperationTry('appendEntry', () => api.appendEntry(customType, data)),
    setSessionName: (name: string) => piOperationTry('setSessionName', () => api.setSessionName(name)),
    getSessionName: () => piOperationTry('getSessionName', () => api.getSessionName()),
    setLabel: (entryId: string, label: Parameters<PiOperationsService['setLabel']>[1]) =>
      piOperationTry('setLabel', () => api.setLabel(entryId, label)),
    getActiveTools: () => piOperationTry('getActiveTools', () => api.getActiveTools()),
    getAllTools: () => piOperationTry('getAllTools', () => api.getAllTools()),
    setActiveTools: (toolNames: readonly string[]) =>
      piOperationTry('setActiveTools', () => api.setActiveTools([...toolNames])),
    getFlag: (name: string) => piOperationTry('getFlag', () => api.getFlag(name)),
    setModel: (model: Parameters<PiOperationsService['setModel']>[0]) =>
      piOperationTryPromise('setModel', () => api.setModel(model)),
    getThinkingLevel: () => piOperationTry('getThinkingLevel', () => api.getThinkingLevel()),
    setThinkingLevel: (level: Parameters<PiOperationsService['setThinkingLevel']>[0]) =>
      piOperationTry('setThinkingLevel', () => api.setThinkingLevel(level)),
    registerProvider: (
      provider: Parameters<PiOperationsService['registerProvider']>[0],
      config?: Parameters<PiOperationsService['registerProvider']>[1],
    ) =>
      piOperationTry('registerProvider', () => {
        if (typeof provider === 'string') {
          api.registerProvider(provider, config ?? {})
        } else {
          api.registerProvider(provider)
        }
      }),
    unregisterProvider: (name: string) => piOperationTry('unregisterProvider', () => api.unregisterProvider(name)),
    events: {
      emit: (channel: string, data: Parameters<PiOperationsService['events']['emit']>[1]) =>
        piOperationTry('events.emit', () => api.events.emit(channel, data)),
      on: (channel: string, handler: Parameters<PiOperationsService['events']['on']>[1]) =>
        piOperationTry('events.on', () => piOperationTry('events.unsubscribe', api.events.on(channel, handler))),
      onScoped: (channel: string, handler: Parameters<PiOperationsService['events']['onScoped']>[1]) =>
        Effect.acquireRelease(
          piOperationTry('events.on', () => api.events.on(channel, handler)),
          (unsubscribe) => Effect.ignore(piOperationTry('events.unsubscribe', unsubscribe)),
        ).pipe(Effect.asVoid),
    },
  }
}

function baseContext(raw: ExtensionContext): PiContextValue {
  return {
    mode: raw.mode,
    hasUI: raw.hasUI,
    cwd: raw.cwd,
    signal: raw.signal,
    model: raw.model,
    thinkingLevel: raw.thinkingLevel,
    isIdle: () => piOperationTry('isIdle', () => raw.isIdle()),
    isProjectTrusted: () => piOperationTry('isProjectTrusted', () => raw.isProjectTrusted()),
    hasPendingMessages: () => piOperationTry('hasPendingMessages', () => raw.hasPendingMessages()),
    contextUsage: () => piOperationTry('contextUsage', () => raw.getContextUsage()),
    abort: () => piOperationTry('abort', () => raw.abort()),
    shutdown: () => piOperationTry('shutdown', () => raw.shutdown()),
    compact: (options: Parameters<PiContextValue['compact']>[0]) =>
      piOperationTry('compact', () => raw.compact(options)),
    systemPrompt: () => piOperationTry('systemPrompt', () => raw.getSystemPrompt()),
  }
}

function createFacade(
  stable: PiStableFacade,
  operations: PiOperationsService,
  context: PiContextValue,
  session: PiSessionContextValue,
  command: PiCommandContextValue,
  tool: PiToolContextValue,
  rawUi: PiUiAdapter,
): PiStableFacade & {
  context: PiContextValue
  sessionContext: PiSessionContextValue
  commandContext: PiCommandContextValue
  toolContext: PiToolContextValue
  session: ReturnType<typeof createPiSessionService>
  ui: PiUiService
} {
  const ui = createPiUiService(context, rawUi)
  return {
    ...stable,
    context,
    sessionContext: session,
    commandContext: command,
    toolContext: tool,
    session: createPiSessionService(operations, session),
    ui,
  }
}

function unavailableCommandContext(context: PiContextValue, session: PiSessionContextValue): PiCommandContextValue {
  const fail = <A>(): Effect.Effect<A, PiOperationsError> =>
    Effect.fail(new PiOperationsError({ operation: 'commandContext', message: 'Command context is unavailable.' }))
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

function unavailableToolContext(context: PiContextValue, session: PiSessionContextValue): PiToolContextValue {
  return {
    ...context,
    session,
    toolCallId: '',
    params: undefined,
    toolSignal: undefined,
    onUpdate: () => Effect.succeed(undefined),
    executionMode: 'parallel',
  }
}

type Invocation = {
  readonly context: PiContextValue
  readonly session: PiSessionContextValue
  readonly command: PiCommandContextValue
  readonly tool: PiToolContextValue
  readonly pi: ReturnType<typeof createFacade>
}

type InvocationRequirements = PiOperations | PiStableServices
/** Effect that creates an invocation value from the current Pi context. */
type InvocationEffect = Effect.Effect<Invocation, PiOperationsError, InvocationRequirements>

type Invoke<Services> = <A, E>(
  program: Effect.Effect<A, E, Services | PiServices>,
  invocation: InvocationEffect,
  signals?: readonly (AbortSignal | undefined)[],
) => Promise<A>

function provideInvocation<A, E, Requirements>(
  program: Effect.Effect<A, E, Requirements>,
  invocation: Invocation,
): Effect.Effect<A, E, Exclude<Requirements, PiInvocationServices>> {
  return program.pipe(
    Effect.provideService(Pi, invocation.pi),
    Effect.provideService(PiContext, invocation.context),
    Effect.provideService(PiSessionContext, invocation.session),
    Effect.provideService(PiCommandContext, invocation.command),
    Effect.provideService(PiToolContext, invocation.tool),
    Effect.provideService(PiSession, invocation.pi.session),
    Effect.provideService(PiUi, invocation.pi.ui),
  ) as Effect.Effect<A, E, Exclude<Requirements, PiInvocationServices>>
}

const getRuntimeServices = Effect.fnUntraced(function* (): Effect.fn.Return<
  { readonly operations: PiOperationsService; readonly stable: PiStableFacade },
  never,
  InvocationRequirements
> {
  const operations = yield* PiOperations
  return {
    operations,
    stable: {
      messages: yield* PiMessages,
      tools: yield* PiTools,
      flags: yield* PiFlags,
      process: yield* PiProcess,
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
  },
  invoke?: Invoke<Services>,
): Effect.fn.Return<Invocation, PiOperationsError, InvocationRequirements> {
  const { operations, stable } = yield* getRuntimeServices()
  const context = yield* piOperationTry('context', () => baseContext(raw))
  const manager = yield* piOperationTry('sessionManager', () => raw.sessionManager)
  const session = yield* sessionContextFromManager(manager)
  return yield* piOperationTry('invocation', () => {
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
): PiCommandContextValue {
  const { context, session } = invocation
  return {
    ...context,
    session,
    systemPromptOptions: () => piOperationTry('systemPromptOptions', () => raw.getSystemPromptOptions()),
    waitForIdle: () => piOperationTryPromise('waitForIdle', () => raw.waitForIdle()),
    newSession: (options: PiSessionChangeOptions | undefined) => {
      const setup = options?.setup
      return piOperationTryPromise('newSession', () =>
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
    fork: (entryId: string, options?: Parameters<PiCommandContextValue['fork']>[1]) => {
      const withSession = options?.withSession
      return piOperationTryPromise('fork', () =>
        raw.fork(entryId, {
          position: options?.position,
          withSession: withSession
            ? async (replacement: PiReplacedSessionContext) =>
                invoke(
                  Effect.gen(function* () {
                    const context = yield* PiCommandContext
                    const session = yield* PiSessionContext
                    return yield* withSession({ context, session })
                  }),
                  createInvocation(replacement, replacement, undefined, invoke),
                  [replacement.signal],
                )
            : undefined,
        }),
      )
    },
    navigateTree: (targetId: string, options?: Parameters<PiCommandContextValue['navigateTree']>[1]) =>
      piOperationTryPromise('navigateTree', () => raw.navigateTree(targetId, options)),
    switchSession: (sessionPath: string, options?: Parameters<PiCommandContextValue['switchSession']>[1]) => {
      const withSession = options?.withSession
      return piOperationTryPromise('switchSession', () =>
        raw.switchSession(sessionPath, {
          withSession: withSession
            ? async (replacement: PiReplacedSessionContext) =>
                invoke(
                  Effect.gen(function* () {
                    const context = yield* PiCommandContext
                    const session = yield* PiSessionContext
                    return yield* withSession({ context, session })
                  }),
                  createInvocation(replacement, replacement, undefined, invoke),
                  [replacement.signal],
                )
            : undefined,
        }),
      )
    },
    reload: () => piOperationTryPromise('reload', () => raw.reload()),
  }
}

const sessionContextFromManager = Effect.fnUntraced(function* (
  manager: ExtensionCommandContext['sessionManager'],
): Effect.fn.Return<PiSessionContextValue, PiOperationsError> {
  return yield* piOperationTry('sessionContext', () => ({
    cwd: manager.getCwd(),
    id: manager.getSessionId(),
    file: manager.getSessionFile(),
    directory: manager.getSessionDir(),
    leafId: manager.getLeafId(),
    leaf: manager.getLeafEntry(),
    entries: manager.getEntries(),
    tree: manager.getTree(),
    entry: (id: string) => piOperationTry('entry', () => manager.getEntry(id)),
    branch: (fromId?: string) => piOperationTry('branch', () => manager.getBranch(fromId)),
    contextEntries: () => piOperationTry('contextEntries', () => manager.buildContextEntries()),
    label: (entryId: string) => piOperationTry('label', () => manager.getLabel(entryId)),
    name: manager.getSessionName(),
  }))
})

function toolContext(
  context: PiContextValue,
  session: PiSessionContextValue,
  tool: {
    toolCallId: string
    params: unknown
    signal: AbortSignal | undefined
    onUpdate?: PiToolUpdateHandler
    executionMode?: 'sequential' | 'parallel'
  },
): PiToolContextValue {
  return {
    ...context,
    session,
    toolCallId: tool.toolCallId,
    params: tool.params,
    toolSignal: tool.signal,
    onUpdate: (update: Parameters<NonNullable<PiToolContextValue['onUpdate']>>[0]) => {
      if (!tool.onUpdate) return Effect.succeed(undefined)
      return Effect.try({
        try: () => tool.onUpdate?.(update),
        catch: (cause: unknown) =>
          new PiToolError({ tool: tool.toolCallId, operation: 'onUpdate', message: piCauseMessage(cause), cause }),
      })
    },
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
  operations: PiOperationsService,
  stable: PiStableFacade,
  raw: ProjectTrustContext,
): Invocation {
  const context: PiContextValue = {
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
    abort: () => piOperationTry('abort', () => undefined),
    shutdown: () => piOperationTry('shutdown', () => undefined),
    compact: () => piOperationTry('compact', () => undefined),
    systemPrompt: () => piOperationTry('systemPrompt', () => ''),
  }
  const session = emptySessionContext()
  const command = unavailableCommandContext(context, session)
  const tool = unavailableToolContext(context, session)
  const ui: PiUiAdapter = {
    ...emptyPiUiAdapter(raw.mode),
    select: (
      title: string,
      options: Parameters<PiUiAdapter['select']>[1],
      dialog?: Parameters<PiUiAdapter['select']>[2],
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
  invoke: Invoke<Services | PiServices>,
): Promise<unknown> {
  const program = Effect.suspend(() => handler(rawEvent))
  return invoke(program, invocation.effect, [invocation.signal]).catch((cause) => {
    if (policy === 'propagate') throw cause
    if (policy === 'failClosed') return neutralResult(name)
    return neutralResult(name)
  })
}

function bootstrapInvocation(operations: PiOperationsService, stable: PiStableFacade): InvocationEffect {
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
  operations: PiOperationsService,
  stable: PiStableFacade,
  runtime: PiManagedRuntime<RegistrationServices | PiStableServices | PiOperations, Failure>,
  run: Invoke<RegistrationServices | PiServices>,
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
            effect: piOperationTry('projectTrustContext', () => trustInvocation(operations, stable, context)),
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
        message: piCauseMessage(cause),
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
  operations: PiOperationsService,
  stable: PiStableFacade,
  runtime: PiManagedRuntime<RegistrationServices | PiStableServices | PiOperations, Failure>,
  run: Invoke<RegistrationServices | PiServices>,
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
  operations: PiOperationsService,
  runtime: PiManagedRuntime<RegistrationServices | PiStableServices | PiOperations, Failure>,
  setup: (
    registrations: PiRegistrationContext<RegistrationServices, Failure>,
  ) => Effect.Effect<void, Failure | PiRegistrationError, RegistrationServices | PiStableServices>,
): Promise<void> {
  const run: Invoke<RegistrationServices | PiServices> = async <A, E>(
    program: Effect.Effect<A, E, RegistrationServices | PiServices>,
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
      register: <Params extends TSchema, ToolServices extends RegistrationServices | PiServices, ToolFailure, Details>(
        definition: EffectToolDefinition<Params, ToolServices, ToolFailure, Details>,
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
  operations: PiOperationsService,
  operationsLayer: Layer.Layer<PiOperations, never, never>,
  stableLayer: Layer.Layer<PiStableServices, never, PiOperations>,
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
    const operationsLayer = Layer.succeed(PiOperations, operations)
    const stableLayer: Layer.Layer<PiStableServices, never, PiOperations> = Layer.mergeAll(
      Layer.effect(PiMessages, Effect.map(PiOperations, createPiMessagesService)),
      Layer.effect(PiTools, Effect.map(PiOperations, createPiToolsService)),
      Layer.effect(PiFlags, Effect.map(PiOperations, createPiFlagsService)),
      Layer.effect(PiProcess, Effect.map(PiOperations, createPiProcessService)),
    )
    await installPiRuntime(api, operations, operationsLayer, stableLayer, plugin)
  }
}

function toPiTool<
  Params extends TSchema,
  RuntimeServices,
  ToolServices extends RuntimeServices | PiServices,
  Failure,
  Details,
>(
  definition: EffectToolDefinition<Params, ToolServices, Failure, Details>,
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
      context: ExtensionContext,
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
        if (cause instanceof PiToolError) throw cause
        throw new PiToolError({ tool: definition.name, operation: 'execute', message: piCauseMessage(cause), cause })
      }
    },
  }
}

function emptyInvocationContext(): PiContextValue {
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

function emptySessionContext(): PiSessionContextValue {
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

export { createPiUiService, type InvocationEffect, installPiPlugin }
