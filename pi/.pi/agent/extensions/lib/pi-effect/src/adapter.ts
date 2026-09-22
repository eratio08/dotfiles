import type {
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionFactory,
  ExtensionUIContext,
  ProjectTrustContext,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Effect, Layer, Option } from 'effect'
import type { Static, TSchema } from 'typebox'
import {
  PiHostError,
  type PiRegistrationError,
  PiRuntimeDisposedError,
  PiToolError,
  PiUiUnavailableError,
  piCauseMessage,
} from './errors.ts'
import type { PiPlugin } from './plugin.ts'
import {
  createPiRegistries,
  type PiEventCallback,
  type PiEventName,
  type PiFailurePolicy,
  type PiRegistrationContext,
} from './registries.ts'
import { createPiManagedRuntime, type PiManagedRuntime } from './runtime.ts'
import { createPiToolsService } from './services/active-tools.ts'
import { createPiFlagsService } from './services/flags.ts'
import { createPiMessagesService } from './services/messages.ts'
import { createPiProcessService } from './services/process.ts'
import { createPiSessionService } from './services/session.ts'
import {
  Pi,
  PiCommandContext,
  type PiCommandContextValue,
  PiContext,
  type PiContextValue,
  type PiCustomFactory,
  PiFlags,
  PiHost,
  type PiHostValue,
  PiMessages,
  PiProcess,
  type PiServices,
  PiSession,
  PiSessionContext,
  type PiSessionContextValue,
  type PiStableServices,
  PiToolContext,
  type PiToolContextValue,
  PiTools,
  PiUi,
  type PiUiService,
} from './services.ts'
import type { EffectToolDefinition } from './tools.ts'

type EffectSuccess<T> = T extends Effect.Effect<infer A, infer _E, infer _R> ? A : never

type PiToolUpdateHandler = {
  onUpdate(update: unknown): void
}['onUpdate']

type PiUiPort = {
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
  readonly custom: <A>(factory: PiCustomFactory<A>, options?: Parameters<PiUiService['custom']>[1]) => Promise<A>
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

type PiStableFacade = Pick<Pi['Service'], 'messages' | 'tools' | 'flags' | 'process' | 'events' | 'model'>

const stableFacades = new WeakMap<PiHostValue, PiStableFacade>()

function hostTry<A>(operation: string, evaluate: () => A): Effect.Effect<A, PiHostError> {
  return Effect.try({
    try: evaluate,
    catch: (cause) => new PiHostError({ operation, message: piCauseMessage(cause), cause }),
  })
}

function hostTryPromise<A>(operation: string, evaluate: () => Promise<A>): Effect.Effect<A, PiHostError> {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new PiHostError({ operation, message: piCauseMessage(cause), cause }),
  })
}

function createPiHostValue(api: ExtensionAPI): PiHostValue {
  return {
    exec: (command, args, options) => hostTryPromise('exec', () => api.exec(command, [...args], options)),
    sendMessage: (message, options) =>
      hostTry('sendMessage', () =>
        api.sendMessage(
          {
            ...message,
            content: typeof message.content === 'string' ? message.content : [...message.content],
            display: message.display ?? false,
          },
          options,
        ),
      ),
    sendUserMessage: (content, options) =>
      hostTry('sendUserMessage', () =>
        api.sendUserMessage(typeof content === 'string' ? content : [...content], options),
      ),
    appendEntry: (customType, data) => hostTry('appendEntry', () => api.appendEntry(customType, data)),
    setSessionName: (name) => hostTry('setSessionName', () => api.setSessionName(name)),
    getSessionName: () => hostTry('getSessionName', () => api.getSessionName()),
    setLabel: (entryId, label) => hostTry('setLabel', () => api.setLabel(entryId, label)),
    getActiveTools: () => hostTry('getActiveTools', () => api.getActiveTools()),
    getAllTools: () => hostTry('getAllTools', () => api.getAllTools()),
    setActiveTools: (toolNames) => hostTry('setActiveTools', () => api.setActiveTools([...toolNames])),
    getFlag: (name) => hostTry('getFlag', () => api.getFlag(name)),
    setModel: (model) => hostTryPromise('setModel', () => api.setModel(model)),
    getThinkingLevel: () => hostTry('getThinkingLevel', () => api.getThinkingLevel()),
    setThinkingLevel: (level) => hostTry('setThinkingLevel', () => api.setThinkingLevel(level)),
    registerProvider: (provider, config) =>
      hostTry('registerProvider', () => {
        if (typeof provider === 'string') {
          api.registerProvider(provider, config ?? {})
        } else {
          api.registerProvider(provider)
        }
      }),
    unregisterProvider: (name) => hostTry('unregisterProvider', () => api.unregisterProvider(name)),
    events: {
      emit: (channel, data) => api.events.emit(channel, data),
      on: (channel, handler) => api.events.on(channel, handler),
    },
  }
}

function createUiPort(ui: ExtensionUIContext): PiUiPort {
  return {
    select: (title, options, dialog) => ui.select(title, [...options], dialog),
    confirm: (title, message, dialog) => ui.confirm(title, message, dialog),
    input: (title, placeholder, dialog) => ui.input(title, placeholder, dialog),
    notify: (message, type) => ui.notify(message, type),
    onTerminalInput: (handler) => ui.onTerminalInput(handler),
    setStatus: (key, text) => ui.setStatus(key, text),
    setWorkingMessage: (message) => ui.setWorkingMessage(message),
    setWorkingVisible: (visible) => ui.setWorkingVisible(visible),
    setWorkingIndicator: (options) =>
      ui.setWorkingIndicator(
        options ? { ...options, frames: options.frames ? [...options.frames] : undefined } : undefined,
      ),
    setWidget: (key, content, options) =>
      typeof content === 'function'
        ? ui.setWidget(key, content, options)
        : ui.setWidget(key, content ? [...content] : undefined, options),
    setFooter: (factory) => ui.setFooter(factory),
    setHeader: (factory) => ui.setHeader(factory),
    setTitle: (title) => ui.setTitle(title),
    custom: (factory, options) => ui.custom(factory, options),
    pasteToEditor: (text) => ui.pasteToEditor(text),
    setEditorText: (text) => ui.setEditorText(text),
    getEditorText: () => ui.getEditorText(),
    editor: (title, prefill) => ui.editor(title, prefill),
    addAutocompleteProvider: (factory) => ui.addAutocompleteProvider(factory),
    setEditorComponent: (factory) => ui.setEditorComponent(factory),
    getEditorComponent: () => ui.getEditorComponent(),
    theme: ui.theme,
    getAllThemes: () => ui.getAllThemes(),
    getTheme: (name) => ui.getTheme(name),
    setTheme: (theme) => ui.setTheme(theme),
    getToolsExpanded: () => ui.getToolsExpanded(),
    setToolsExpanded: (expanded) => ui.setToolsExpanded(expanded),
  }
}

function emptyUiPort(): PiUiPort {
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
    custom: async <_A>() => Promise.reject(new Error('UI is unavailable.')),
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

function baseContext(raw: ExtensionContext): PiContextValue {
  return {
    mode: raw.mode,
    hasUI: raw.hasUI,
    cwd: raw.cwd,
    signal: raw.signal,
    model: raw.model,
    thinkingLevel: raw.thinkingLevel,
    isIdle: () => raw.isIdle(),
    isProjectTrusted: () => raw.isProjectTrusted(),
    hasPendingMessages: () => raw.hasPendingMessages(),
    contextUsage: () => raw.getContextUsage(),
    abort: () => hostTry('abort', () => raw.abort()),
    shutdown: () => hostTry('shutdown', () => raw.shutdown()),
    compact: (options) => hostTry('compact', () => raw.compact(options)),
    systemPrompt: () => hostTry('systemPrompt', () => raw.getSystemPrompt()),
  }
}

function sessionContext(raw: ExtensionContext): PiSessionContextValue {
  const manager = raw.sessionManager
  return {
    cwd: manager.getCwd(),
    id: manager.getSessionId(),
    file: manager.getSessionFile(),
    directory: manager.getSessionDir(),
    leafId: manager.getLeafId(),
    leaf: manager.getLeafEntry(),
    entries: manager.getEntries(),
    tree: manager.getTree(),
    entry: (id) => manager.getEntry(id),
    branch: (fromId) => manager.getBranch(fromId),
    contextEntries: () => manager.buildContextEntries(),
    label: (entryId) => manager.getLabel(entryId),
    name: manager.getSessionName(),
  }
}

function createPiUiService(context: PiContextValue, ui: PiUiPort): PiUiService {
  const unavailable = (operation: string): Effect.Effect<never, PiUiUnavailableError> =>
    Effect.fail(
      new PiUiUnavailableError({ operation, mode: context.mode, message: `UI is unavailable for ${context.mode}.` }),
    )
  const requireUI = <A>(
    operation: string,
    effect: Effect.Effect<A, PiHostError>,
  ): Effect.Effect<A, PiUiUnavailableError | PiHostError> => (context.hasUI ? effect : unavailable(operation))
  const requireTui = <A>(
    operation: string,
    effect: Effect.Effect<A, PiHostError>,
  ): Effect.Effect<A, PiUiUnavailableError | PiHostError> =>
    context.mode === 'tui' && context.hasUI ? effect : unavailable(operation)
  const sync = <A>(operation: string, evaluate: () => A): Effect.Effect<A, PiHostError> => hostTry(operation, evaluate)
  const promise = <A>(operation: string, evaluate: () => Promise<A>): Effect.Effect<A, PiHostError> =>
    hostTryPromise(operation, evaluate)
  const dialogOptions = (dialog?: Parameters<PiUiPort['select']>[2]): Parameters<PiUiPort['select']>[2] => ({
    ...dialog,
    signal: dialog?.signal ?? context.signal,
  })

  return {
    select: (title, options, dialog) =>
      requireUI(
        'select',
        promise('select', () => ui.select(title, options, dialogOptions(dialog))),
      ),
    confirm: (title, message, dialog) =>
      requireUI(
        'confirm',
        promise('confirm', () => ui.confirm(title, message, dialogOptions(dialog))),
      ),
    input: (title, placeholder, dialog) =>
      requireUI(
        'input',
        promise('input', () => ui.input(title, placeholder, dialogOptions(dialog))),
      ),
    notify: (message, type) =>
      context.hasUI ? sync('notify', () => ui.notify(message, type)) : Effect.succeed(undefined),
    onTerminalInput: (handler) =>
      requireTui(
        'onTerminalInput',
        sync('onTerminalInput', () => ui.onTerminalInput(handler)),
      ),
    setStatus: (key, text) =>
      context.hasUI ? sync('setStatus', () => ui.setStatus(key, text)) : Effect.succeed(undefined),
    setWorkingMessage: (message) =>
      context.hasUI ? sync('setWorkingMessage', () => ui.setWorkingMessage(message)) : Effect.succeed(undefined),
    setWorkingVisible: (visible) =>
      context.hasUI ? sync('setWorkingVisible', () => ui.setWorkingVisible(visible)) : Effect.succeed(undefined),
    setWorkingIndicator: (options) =>
      context.hasUI ? sync('setWorkingIndicator', () => ui.setWorkingIndicator(options)) : Effect.succeed(undefined),
    setWidget: (key, content, options) =>
      context.hasUI ? sync('setWidget', () => ui.setWidget(key, content, options)) : Effect.succeed(undefined),
    setFooter: (factory) =>
      context.hasUI ? sync('setFooter', () => ui.setFooter(factory)) : Effect.succeed(undefined),
    setHeader: (factory) =>
      context.hasUI ? sync('setHeader', () => ui.setHeader(factory)) : Effect.succeed(undefined),
    setTitle: (title) => (context.hasUI ? sync('setTitle', () => ui.setTitle(title)) : Effect.succeed(undefined)),
    custom: (factory, options) =>
      requireTui('custom', promise('custom', () => ui.custom(factory, options)).pipe(Effect.map(Option.some))),
    pasteToEditor: (text) =>
      context.hasUI ? sync('pasteToEditor', () => ui.pasteToEditor(text)) : Effect.succeed(undefined),
    setEditorText: (text) =>
      context.hasUI ? sync('setEditorText', () => ui.setEditorText(text)) : Effect.succeed(undefined),
    getEditorText: () => sync('getEditorText', () => ui.getEditorText()),
    editor: (title, prefill) =>
      requireTui(
        'editor',
        promise('editor', () => ui.editor(title, prefill)),
      ),
    addAutocompleteProvider: (factory) =>
      context.hasUI
        ? sync('addAutocompleteProvider', () => ui.addAutocompleteProvider(factory))
        : Effect.succeed(undefined),
    setEditorComponent: (factory) =>
      requireTui(
        'setEditorComponent',
        sync('setEditorComponent', () => ui.setEditorComponent(factory)),
      ),
    getEditorComponent: () => sync('getEditorComponent', () => ui.getEditorComponent()),
    theme: () => sync('theme', () => ui.theme),
    getAllThemes: () => sync('getAllThemes', () => ui.getAllThemes()),
    getTheme: (name) => sync('getTheme', () => ui.getTheme(name)),
    setTheme: (theme) => sync('setTheme', () => ui.setTheme(theme)),
    getToolsExpanded: () => sync('getToolsExpanded', () => ui.getToolsExpanded()),
    setToolsExpanded: (expanded) => sync('setToolsExpanded', () => ui.setToolsExpanded(expanded)),
  }
}

function createStableFacade(host: PiHostValue): PiStableFacade {
  const existing = stableFacades.get(host)
  if (existing) return existing
  const stable: PiStableFacade = {
    messages: createPiMessagesService(host),
    tools: createPiToolsService(host),
    flags: createPiFlagsService(host),
    process: createPiProcessService(host),
    events: host.events,
    model: { set: host.setModel },
  }
  stableFacades.set(host, stable)
  return stable
}

function createFacade(
  host: PiHostValue,
  context: PiContextValue,
  session: PiSessionContextValue,
  command: PiCommandContextValue,
  tool: PiToolContextValue,
  rawUi: PiUiPort,
) {
  const stable = createStableFacade(host)
  const ui = createPiUiService(context, rawUi)
  return {
    ...stable,
    context,
    sessionContext: session,
    commandContext: command,
    toolContext: tool,
    session: createPiSessionService(host, session),
    ui,
  }
}

function unavailableCommandContext(context: PiContextValue, session: PiSessionContextValue): PiCommandContextValue {
  const fail = <A>(): Effect.Effect<A, PiHostError> =>
    Effect.fail(new PiHostError({ operation: 'commandContext', message: 'Command context is unavailable.' }))
  return {
    ...context,
    session,
    systemPromptOptions: () => ({ cwd: context.cwd }),
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

type Invoke<Services> = <A, E>(
  program: Effect.Effect<A, E, Services>,
  invocation: Invocation,
  signals?: readonly (AbortSignal | undefined)[],
) => Promise<A>

function provideInvocation<A, E, Requirements>(program: Effect.Effect<A, E, Requirements>, invocation: Invocation) {
  return program.pipe(
    Effect.provideService(Pi, invocation.pi),
    Effect.provideService(PiContext, invocation.context),
    Effect.provideService(PiSessionContext, invocation.session),
    Effect.provideService(PiCommandContext, invocation.command),
    Effect.provideService(PiToolContext, invocation.tool),
    Effect.provideService(PiSession, invocation.pi.session),
    Effect.provideService(PiUi, invocation.pi.ui),
  )
}

function createInvocation<Services>(
  raw: ExtensionContext,
  host: PiHostValue,
  command?: ExtensionCommandContext,
  tool?: {
    toolCallId: string
    params: unknown
    signal: AbortSignal | undefined
    onUpdate?: PiToolUpdateHandler
    executionMode?: 'sequential' | 'parallel'
  },
  invoke?: Invoke<Services>,
): Invocation {
  const context = baseContext(raw)
  const session = sessionContext(raw)
  const runNested: Invoke<Services> =
    invoke ??
    (async () =>
      Promise.reject(new PiRuntimeDisposedError({ operation: 'nested', message: 'Nested invocation is unavailable.' })))
  const commandValue = command ? commandContext(host, command, runNested) : unavailableCommandContext(context, session)
  const toolValue = tool ? toolContext(context, session, tool) : unavailableToolContext(context, session)
  return {
    context,
    session,
    command: commandValue,
    tool: toolValue,
    pi: createFacade(host, context, session, commandValue, toolValue, createUiPort(raw.ui)),
  }
}

function commandContext<Services>(
  host: PiHostValue,
  raw: ExtensionCommandContext,
  invoke: Invoke<Services>,
): PiCommandContextValue {
  const context = baseContext(raw)
  const session = sessionContext(raw)
  return {
    ...context,
    session,
    systemPromptOptions: () => raw.getSystemPromptOptions(),
    waitForIdle: () =>
      Effect.tryPromise({
        try: () => raw.waitForIdle(),
        catch: (cause) => new PiHostError({ operation: 'waitForIdle', message: piCauseMessage(cause), cause }),
      }),
    newSession: (options) => {
      const setup = options?.setup
      return Effect.tryPromise({
        try: () =>
          raw.newSession({
            parentSession: options?.parentSession,
            setup: setup
              ? async (manager) =>
                  invoke(
                    setup(sessionContextFromManager(manager)),
                    createInvocation(raw, host, raw, undefined, invoke),
                    [raw.signal],
                  )
              : undefined,
          }),
        catch: (cause) => new PiHostError({ operation: 'newSession', message: piCauseMessage(cause), cause }),
      })
    },
    fork: (entryId, options) => {
      const withSession = options?.withSession
      return Effect.tryPromise({
        try: () =>
          raw.fork(entryId, {
            position: options?.position,
            withSession: withSession
              ? async (replacement) =>
                  invoke(
                    withSession({
                      context: commandContext(host, replacement, invoke),
                      session: sessionContext(replacement),
                    }),
                    createInvocation(replacement, host, replacement, undefined, invoke),
                    [replacement.signal],
                  )
              : undefined,
          }),
        catch: (cause) => new PiHostError({ operation: 'fork', message: piCauseMessage(cause), cause }),
      })
    },
    navigateTree: (targetId, options) =>
      Effect.tryPromise({
        try: () => raw.navigateTree(targetId, options),
        catch: (cause) => new PiHostError({ operation: 'navigateTree', message: piCauseMessage(cause), cause }),
      }),
    switchSession: (sessionPath, options) => {
      const withSession = options?.withSession
      return Effect.tryPromise({
        try: () =>
          raw.switchSession(sessionPath, {
            withSession: withSession
              ? async (replacement) =>
                  invoke(
                    withSession({
                      context: commandContext(host, replacement, invoke),
                      session: sessionContext(replacement),
                    }),
                    createInvocation(replacement, host, replacement, undefined, invoke),
                    [replacement.signal],
                  )
              : undefined,
          }),
        catch: (cause) => new PiHostError({ operation: 'switchSession', message: piCauseMessage(cause), cause }),
      })
    },
    reload: () =>
      Effect.tryPromise({
        try: () => raw.reload(),
        catch: (cause) => new PiHostError({ operation: 'reload', message: piCauseMessage(cause), cause }),
      }),
  }
}

function sessionContextFromManager(manager: ExtensionCommandContext['sessionManager']): PiSessionContextValue {
  return {
    cwd: manager.getCwd(),
    id: manager.getSessionId(),
    file: manager.getSessionFile(),
    directory: manager.getSessionDir(),
    leafId: manager.getLeafId(),
    leaf: manager.getLeafEntry(),
    entries: manager.getEntries(),
    tree: manager.getTree(),
    entry: (id) => manager.getEntry(id),
    branch: (fromId) => manager.getBranch(fromId),
    contextEntries: () => manager.buildContextEntries(),
    label: (entryId) => manager.getLabel(entryId),
    name: manager.getSessionName(),
  }
}

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
    onUpdate: (update) => {
      if (!tool.onUpdate) return Effect.succeed(undefined)
      return Effect.try({
        try: () => tool.onUpdate?.(update),
        catch: (cause) =>
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

function trustInvocation(host: PiHostValue, raw: ProjectTrustContext): Invocation {
  const context: PiContextValue = {
    mode: raw.mode,
    hasUI: raw.hasUI,
    cwd: raw.cwd,
    signal: undefined,
    model: undefined,
    thinkingLevel: undefined,
    isIdle: () => true,
    isProjectTrusted: () => false,
    hasPendingMessages: () => false,
    contextUsage: () => undefined,
    abort: () => hostTry('abort', () => undefined),
    shutdown: () => hostTry('shutdown', () => undefined),
    compact: () => hostTry('compact', () => undefined),
    systemPrompt: () => hostTry('systemPrompt', () => ''),
  }
  const session = emptySessionContext()
  const command = unavailableCommandContext(context, session)
  const tool = unavailableToolContext(context, session)
  const ui: PiUiPort = {
    ...emptyUiPort(),
    select: (title, options, dialog) => raw.ui.select(title, [...options], dialog),
    confirm: raw.ui.confirm,
    input: raw.ui.input,
    notify: raw.ui.notify,
  }
  return { context, session, command, tool, pi: createFacade(host, context, session, command, tool, ui) }
}

function registerEventHandler<Services, Failure>(
  _runtime: PiManagedRuntime<Services | PiStableServices, Failure>,
  name: PiEventName,
  handler: PiEventCallback<Services, Failure>,
  policy: PiFailurePolicy,
  rawEvent: unknown,
  invocation: Invocation,
  invoke: Invoke<Services | PiServices>,
): Promise<unknown> {
  const program = Effect.suspend(() => handler(rawEvent))
  const signal = invocation.context.signal
  return invoke(program, invocation, [signal]).catch((cause) => {
    if (policy === 'propagate') throw cause
    if (policy === 'failClosed') return neutralResult(name)
    return neutralResult(name)
  })
}

function bootstrapInvocation(host: PiHostValue): Invocation {
  const context = emptyInvocationContext()
  const session = emptySessionContext()
  const command = unavailableCommandContext(context, session)
  const tool = unavailableToolContext(context, session)
  return { context, session, command, tool, pi: createFacade(host, context, session, command, tool, emptyUiPort()) }
}

async function installPiRuntime<Services, Failure>(
  api: ExtensionAPI,
  host: PiHostValue,
  hostLayer: Layer.Layer<PiHost, never, never>,
  stableLayer: Layer.Layer<PiStableServices, never, never>,
  plugin: PiPlugin<Services, Failure>,
): Promise<void> {
  const baseLayer = stableLayer
  const installRuntime = async <RegistrationServices>(
    runtime: PiManagedRuntime<RegistrationServices | PiStableServices, Failure>,
    effect: (
      registrations: PiRegistrationContext<RegistrationServices, Failure>,
    ) => Effect.Effect<void, Failure | PiRegistrationError, RegistrationServices | PiStableServices>,
  ): Promise<void> => {
    const shutdownHandlers: Array<PiEventCallback<RegistrationServices, Failure>> = []
    let shutdownPromise: Promise<void> | undefined
    let invoke: Invoke<RegistrationServices | PiServices>
    const run: Invoke<RegistrationServices | PiServices> = async (program, invocation, signals = []) => {
      const provided = provideInvocation(program, invocation)
      return runtime.run(provided, signals)
    }
    invoke = run
    type HostEventContext = ExtensionContext | ProjectTrustContext
    type HostOn = {
      (name: 'session_shutdown', callback: (event: unknown, context: ExtensionContext) => Promise<unknown>): void
      (name: PiEventName, callback: (event: unknown, context: HostEventContext | undefined) => Promise<unknown>): void
    }
    const rawOn = api.on as HostOn
    const eventInvocation = (context: HostEventContext | undefined): Invocation =>
      context === undefined
        ? bootstrapInvocation(host)
        : 'sessionManager' in context
          ? createInvocation(context, host, undefined, undefined, invoke)
          : trustInvocation(host, context)
    rawOn('session_shutdown', async (event, context) => {
      if (shutdownPromise) return shutdownPromise
      runtime.beginShutdown()
      shutdownPromise = (async () => {
        try {
          for (const registered of shutdownHandlers) {
            const invocation = createInvocation(context, host, undefined, undefined, invoke)
            await runtime.runShutdown(
              provideInvocation(
                Effect.suspend(() => registered(event)),
                invocation,
              ),
              [context.signal],
            )
          }
        } finally {
          await runtime.dispose()
        }
      })()
      return shutdownPromise
    })

    const registries = createPiRegistries<RegistrationServices, Failure>({
      events: {
        register: (name, handler, policy) => {
          if (name === 'session_shutdown') {
            shutdownHandlers.push(handler)
            return
          }
          rawOn(name, (event, context) =>
            registerEventHandler(runtime, name, handler, policy, event, eventInvocation(context), invoke),
          )
        },
      },
      commands: {
        register: (name, definition) => {
          const getArgumentCompletions = definition.getArgumentCompletions
          api.registerCommand(name, {
            description: definition.description,
            getArgumentCompletions: getArgumentCompletions
              ? (prefix) => {
                  if (runtime.isClosing()) return Promise.resolve(null)
                  return run(
                    Effect.suspend(() => getArgumentCompletions(prefix)),
                    bootstrapInvocation(host),
                    [],
                  ).then((items) => (items === null ? null : [...items]))
                }
              : undefined,
            handler: (args, context) => {
              if (runtime.isClosing()) return Promise.resolve()
              return run(
                Effect.suspend(() => definition.handler(args)),
                createInvocation(context, host, context, undefined, invoke),
                [context.signal],
              )
            },
          })
        },
      },
      shortcuts: {
        register: (shortcut, definition) =>
          api.registerShortcut(shortcut, {
            description: definition.description,
            handler: (context) => {
              if (runtime.isClosing()) return Promise.resolve()
              return run(
                Effect.suspend(() => definition.handler()),
                createInvocation(context, host, undefined, undefined, invoke),
                [context.signal],
              )
            },
          }),
      },
      flags: { register: (name, definition) => api.registerFlag(name, definition) },
      tools: {
        register: (definition) => api.registerTool(toPiTool(definition, host, run, invoke)),
      },
      renderers: {
        registerMessage: (customType, renderer) => api.registerMessageRenderer(customType, renderer),
        registerEntry: (customType, renderer) => api.registerEntryRenderer(customType, renderer),
      },
    })

    try {
      await runtime.run(Effect.suspend(() => effect(registries)))
    } catch (cause) {
      await runtime.dispose()
      throw cause
    }
  }

  if (plugin.layer !== undefined) {
    const pluginDependencies = Layer.merge(hostLayer, baseLayer)
    const pluginLayer = plugin.layer.pipe(Layer.provide(pluginDependencies))
    const runtime = createPiManagedRuntime(Layer.merge(pluginLayer, baseLayer))
    await installRuntime(runtime, (registrations) => plugin.effect(registrations))
  } else {
    const runtime = createPiManagedRuntime(baseLayer)
    await installRuntime<never>(runtime, (registrations) => plugin.effect(registrations))
  }
}

function installPiPlugin<Services, Failure>(plugin: PiPlugin<Services, Failure>): ExtensionFactory {
  return async (api) => {
    const host = createPiHostValue(api)
    const hostLayer = Layer.succeed(PiHost, host)
    const stable = createStableFacade(host)
    const stableLayer: Layer.Layer<PiStableServices, never, never> = Layer.mergeAll(
      Layer.succeed(PiMessages, stable.messages),
      Layer.succeed(PiTools, stable.tools),
      Layer.succeed(PiFlags, stable.flags),
      Layer.succeed(PiProcess, stable.process),
    )
    await installPiRuntime(api, host, hostLayer, stableLayer, plugin)
  }
}

function toPiTool<Params extends TSchema, Services, Failure, Details>(
  definition: EffectToolDefinition<Params, Services | PiServices, Failure, Details>,
  host: PiHostValue,
  run: Invoke<Services | PiServices>,
  invoke: Invoke<Services | PiServices>,
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
        host,
        undefined,
        {
          toolCallId,
          params,
          signal,
          onUpdate,
          executionMode: definition.executionMode,
        },
        invoke,
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
    isIdle: () => true,
    isProjectTrusted: () => false,
    hasPendingMessages: () => false,
    contextUsage: () => undefined,
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
    entry: () => undefined,
    branch: () => [],
    contextEntries: () => [],
    label: () => undefined,
    name: undefined,
  }
}

export { createPiUiService, installPiPlugin }
