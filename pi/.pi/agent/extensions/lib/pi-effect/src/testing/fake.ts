import type {
  ExecResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  SessionManager,
  ToolDefinition,
  ToolInfo,
} from '@earendil-works/pi-coding-agent'
import type { AutocompleteItem } from '@earendil-works/pi-tui'

type FakeCallback = (event: unknown, context: unknown) => Promise<unknown> | unknown
type FakeCommand = {
  readonly handler: (args: string, context: ExtensionContext) => Promise<void>
  readonly getArgumentCompletions?: (prefix: string) => Promise<readonly AutocompleteItem[] | null>
  readonly description?: string
}

/** Fake extension host state and helpers for exercising registered Pi callbacks. */
type FakeExtension = {
  /** Fake Pi API passed to the extension factory. */
  readonly api: ExtensionAPI
  /** Event handlers registered by name. */
  readonly events: Map<string, FakeCallback[]>
  /** Commands registered by name. */
  readonly commands: Map<string, FakeCommand>
  /** Shortcut handlers registered by key. */
  readonly shortcuts: Map<string, (context: ExtensionContext) => Promise<void> | void>
  /** Flag defaults registered by name. */
  readonly flags: Map<string, { readonly value: boolean | string | undefined }>
  /** Tools registered by name. */
  readonly tools: Map<string, ToolDefinition>
  /** Message renderers registered by custom type. */
  readonly messageRenderers: Map<string, unknown>
  /** Entry renderers registered by custom type. */
  readonly entryRenderers: Map<string, unknown>
  /** Invokes all handlers registered for an event and returns their results. */
  readonly invokeEvent: (name: string, event: unknown, context?: ExtensionContext) => Promise<readonly unknown[]>
  /** Invokes a registered command. Rejects if the command name is unknown. */
  readonly invokeCommand: (name: string, args?: string, context?: ExtensionContext) => Promise<void>
  /** Invokes command completions, or returns `null` when no provider is registered. */
  readonly invokeCommandCompletions: (name: string, prefix?: string) => Promise<readonly AutocompleteItem[] | null>
  /** Executes a registered tool with the supplied invocation values. */
  readonly invokeTool: (
    name: string,
    toolCallId: string,
    params: unknown,
    context?: ExtensionContext,
    signal?: AbortSignal,
    onUpdate?: (update: unknown) => void,
  ) => Promise<unknown>
}

/**
 * Creates a fake Pi context in terminal UI mode with the supplied working directory.
 * The default working directory is `process.cwd()`.
 * @param cwd Working directory returned by the fake context.
 * @returns A fake extension context with available UI and empty session state.
 */
function createFakeExtensionContext(cwd = process.cwd()): ExtensionContext {
  const sessionManager = {
    getCwd: () => cwd,
    getSessionId: () => 'fake-session',
    getSessionFile: () => undefined,
    getSessionDir: () => cwd,
    getLeafId: () => null,
    getLeafEntry: () => undefined,
    getEntry: () => undefined,
    getBranch: () => [],
    buildContextEntries: () => [],
    getLabel: () => undefined,
    getEntries: () => [],
    getTree: () => [],
    getSessionName: () => undefined,
  } as unknown as SessionManager
  const ui = {
    select: async (): Promise<undefined> => undefined,
    confirm: async (): Promise<boolean> => false,
    input: async (): Promise<undefined> => undefined,
    notify: (): undefined => undefined,
    onTerminalInput: () => (): undefined => undefined,
    setStatus: (): undefined => undefined,
    setWorkingMessage: (): undefined => undefined,
    setWorkingVisible: (): undefined => undefined,
    setWorkingIndicator: (): undefined => undefined,
    setHiddenThinkingLabel: (): undefined => undefined,
    setWidget: (): undefined => undefined,
    setFooter: (): undefined => undefined,
    setHeader: (): undefined => undefined,
    setTitle: (): undefined => undefined,
    custom: async (): Promise<undefined> => undefined,
    pasteToEditor: (_text: string): undefined => undefined,
    setEditorText: (_text: string): undefined => undefined,
    getEditorText: (): string => '',
    editor: async (): Promise<undefined> => undefined,
    addAutocompleteProvider: (): undefined => undefined,
    setEditorComponent: (): undefined => undefined,
    getEditorComponent: (): undefined => undefined,
    theme: undefined,
    getAllThemes: (): never[] => [],
    getTheme: (): undefined => undefined,
    setTheme: (): { success: boolean } => ({ success: false }),
    getToolsExpanded: (): boolean => false,
    setToolsExpanded: (): undefined => undefined,
  }
  return {
    ui,
    mode: 'tui',
    hasUI: true,
    cwd,
    sessionManager,
    modelRegistry: {} as never,
    model: undefined,
    scopedModels: [],
    thinkingLevel: undefined,
    isIdle: () => true,
    isProjectTrusted: () => true,
    signal: undefined,
    abort: () => undefined,
    hasPendingMessages: () => false,
    shutdown: () => undefined,
    getContextUsage: () => undefined,
    compact: () => undefined,
    getSystemPrompt: () => '',
  } as unknown as ExtensionContext
}

/**
 * Creates a fake Pi API that records registrations and can invoke registered callbacks.
 * @returns Fake API state and callback invocation helpers.
 */
function createFakeExtensionApi(): FakeExtension {
  const events = new Map<string, FakeCallback[]>()
  const eventBus = new Map<string, Array<(data: unknown) => void>>()
  const commands = new Map<string, FakeCommand>()
  const shortcuts = new Map<string, (context: ExtensionContext) => Promise<void> | void>()
  const flags = new Map<string, { value: boolean | string | undefined }>()
  const tools = new Map<string, ToolDefinition>()
  const messageRenderers = new Map<string, unknown>()
  const entryRenderers = new Map<string, unknown>()
  const api = {
    on: (name: string, callback: FakeCallback): void => {
      const handlers = events.get(name) ?? []
      handlers.push(callback)
      events.set(name, handlers)
    },
    registerTool: (definition: ToolDefinition): void => {
      tools.set(definition.name, definition)
    },
    registerCommand: (name: string, definition: FakeCommand): void => {
      commands.set(name, definition)
    },
    registerShortcut: (
      name: string,
      definition: { readonly handler: (context: ExtensionContext) => Promise<void> | void },
    ): void => {
      shortcuts.set(name, definition.handler)
    },
    registerFlag: (name: string, definition: { readonly default?: boolean | string }): void => {
      flags.set(name, { value: definition.default })
    },
    registerMessageRenderer: (name: string, renderer: unknown): void => {
      messageRenderers.set(name, renderer)
    },
    registerEntryRenderer: (name: string, renderer: unknown): void => {
      entryRenderers.set(name, renderer)
    },
    sendMessage: (): void => undefined,
    sendUserMessage: (): void => undefined,
    appendEntry: (): void => undefined,
    setSessionName: (): void => undefined,
    getSessionName: (): string | undefined => undefined,
    setLabel: (): void => undefined,
    exec: async (): Promise<ExecResult> => ({ stdout: '', stderr: '', code: 0, killed: false }),
    getActiveTools: (): string[] => [],
    getAllTools: (): ToolInfo[] => [],
    setActiveTools: (): void => undefined,
    getFlag: (name: string): boolean | string | undefined => flags.get(name)?.value,
    setModel: async (): Promise<boolean> => true,
    getThinkingLevel: (): string => 'medium',
    setThinkingLevel: (): void => undefined,
    registerProvider: (): void => undefined,
    unregisterProvider: (): void => undefined,
    events: {
      emit: (channel: string, data: unknown): void => {
        for (const handler of eventBus.get(channel) ?? []) handler(data)
      },
      on: (channel: string, handler: (data: unknown) => void): (() => void) => {
        const handlers = eventBus.get(channel) ?? []
        handlers.push(handler)
        eventBus.set(channel, handlers)
        return () => {
          const current = eventBus.get(channel)
          if (!current) return
          const index = current.indexOf(handler)
          if (index < 0) return
          current.splice(index, 1)
          if (current.length === 0) eventBus.delete(channel)
        }
      },
    },
  }
  const extension: FakeExtension = {
    api: api as unknown as ExtensionAPI,
    events,
    commands,
    shortcuts,
    flags,
    tools,
    messageRenderers,
    entryRenderers,
    invokeEvent: async (name: string, event: unknown, context = createFakeExtensionContext()) => {
      const results: unknown[] = []
      for (const handler of events.get(name) ?? []) results.push(await handler(event, context))
      return results
    },
    invokeCommand: async (name: string, args = '', context = createFakeExtensionContext()) => {
      const command = commands.get(name)
      if (!command) throw new Error(`Unknown fake command: ${name}`)
      await command.handler(args, context)
    },
    invokeCommandCompletions: async (name: string, prefix = '') => {
      const command = commands.get(name)
      if (!command) throw new Error(`Unknown fake command: ${name}`)
      return command.getArgumentCompletions ? command.getArgumentCompletions(prefix) : null
    },
    invokeTool: async (
      name: string,
      toolCallId: string,
      params: unknown,
      context = createFakeExtensionContext(),
      signal?: AbortSignal,
      onUpdate?: (update: unknown) => void,
    ) => {
      const tool = tools.get(name)
      if (!tool) throw new Error(`Unknown fake tool: ${name}`)
      return tool.execute(toolCallId, params, signal, onUpdate, context)
    },
  }
  return extension
}

/**
 * Runs an extension factory against a fake Pi API and returns its captured registrations.
 * @param factory Extension factory to run.
 * @returns Fake API state after the factory registers its callbacks.
 */
async function installFakePlugin(factory: ExtensionFactory): Promise<FakeExtension> {
  const fake = createFakeExtensionApi()
  await factory(fake.api)
  return fake
}

export { createFakeExtensionApi, createFakeExtensionContext, type FakeExtension, installFakePlugin }
