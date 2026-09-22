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

type FakeExtension = {
  readonly api: ExtensionAPI
  readonly events: Map<string, FakeCallback[]>
  readonly commands: Map<string, FakeCommand>
  readonly shortcuts: Map<string, (context: ExtensionContext) => Promise<void> | void>
  readonly flags: Map<string, { readonly value: boolean | string | undefined }>
  readonly tools: Map<string, ToolDefinition>
  readonly messageRenderers: Map<string, unknown>
  readonly entryRenderers: Map<string, unknown>
  readonly invokeEvent: (name: string, event: unknown, context?: ExtensionContext) => Promise<readonly unknown[]>
  readonly invokeCommand: (name: string, args?: string, context?: ExtensionContext) => Promise<void>
  readonly invokeCommandCompletions: (name: string, prefix?: string) => Promise<readonly AutocompleteItem[] | null>
  readonly invokeTool: (
    name: string,
    toolCallId: string,
    params: unknown,
    context?: ExtensionContext,
    signal?: AbortSignal,
    onUpdate?: (update: unknown) => void,
  ) => Promise<unknown>
}

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
    select: async () => undefined,
    confirm: async () => false,
    input: async () => undefined,
    notify: () => undefined,
    onTerminalInput: () => () => undefined,
    setStatus: () => undefined,
    setWorkingMessage: () => undefined,
    setWorkingVisible: () => undefined,
    setWorkingIndicator: () => undefined,
    setHiddenThinkingLabel: () => undefined,
    setWidget: () => undefined,
    setFooter: () => undefined,
    setHeader: () => undefined,
    setTitle: () => undefined,
    custom: async () => undefined,
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

function createFakeExtensionApi(): FakeExtension {
  const events = new Map<string, FakeCallback[]>()
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
    events: { emit: (): void => undefined, on: (): (() => void) => () => undefined },
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
    invokeEvent: async (name, event, context = createFakeExtensionContext()) => {
      const results: unknown[] = []
      for (const handler of events.get(name) ?? []) results.push(await handler(event, context))
      return results
    },
    invokeCommand: async (name, args = '', context = createFakeExtensionContext()) => {
      const command = commands.get(name)
      if (!command) throw new Error(`Unknown fake command: ${name}`)
      await command.handler(args, context)
    },
    invokeCommandCompletions: async (name, prefix = '') => {
      const command = commands.get(name)
      if (!command) throw new Error(`Unknown fake command: ${name}`)
      return command.getArgumentCompletions ? command.getArgumentCompletions(prefix) : null
    },
    invokeTool: async (name, toolCallId, params, context = createFakeExtensionContext(), signal, onUpdate) => {
      const tool = tools.get(name)
      if (!tool) throw new Error(`Unknown fake tool: ${name}`)
      return tool.execute(toolCallId, params, signal, onUpdate, context)
    },
  }
  return extension
}

async function installFakePlugin(factory: ExtensionFactory): Promise<FakeExtension> {
  const fake = createFakeExtensionApi()
  await factory(fake.api)
  return fake
}

export { createFakeExtensionApi, createFakeExtensionContext, type FakeExtension, installFakePlugin }
