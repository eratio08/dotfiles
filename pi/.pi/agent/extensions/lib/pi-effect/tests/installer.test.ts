import { expect, test } from 'bun:test'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Effect } from 'effect'
import { PiExtension } from '../src/plugin.ts'

function fakeContext(): ExtensionContext {
  const sessionManager = {
    getCwd: () => '/tmp',
    getSessionId: () => 'session',
    getSessionFile: () => undefined,
    getSessionDir: () => '/tmp',
    getLeafId: () => null,
    getLeafEntry: () => undefined,
    getEntry: () => undefined,
    getBranch: () => [],
    buildContextEntries: () => [],
    getLabel: () => undefined,
    getEntries: () => [],
    getTree: () => [],
    getSessionName: () => undefined,
  }
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
    mode: 'print',
    hasUI: false,
    cwd: '/tmp',
    sessionManager,
    modelRegistry: {} as never,
    model: undefined,
    scopedModels: [],
    thinkingLevel: undefined,
    isIdle: () => true,
    isProjectTrusted: () => false,
    signal: undefined,
    abort: () => undefined,
    hasPendingMessages: () => false,
    shutdown: () => undefined,
    getContextUsage: () => undefined,
    compact: () => undefined,
    getSystemPrompt: () => '',
  } as unknown as ExtensionContext
}

function fakeApi(
  callbacks: Map<string, (event: unknown, context: ExtensionContext) => Promise<unknown>>,
): ExtensionAPI {
  const api = {
    on: (name: string, callback: (event: unknown, context: ExtensionContext) => Promise<unknown>) => {
      callbacks.set(name, callback)
    },
    registerTool: () => undefined,
    registerCommand: () => undefined,
    registerShortcut: () => undefined,
    registerFlag: () => undefined,
    registerMessageRenderer: () => undefined,
    registerEntryRenderer: () => undefined,
    sendMessage: () => undefined,
    sendUserMessage: () => undefined,
    appendEntry: () => undefined,
    setSessionName: () => undefined,
    getSessionName: () => undefined,
    setLabel: () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0 }),
    getActiveTools: () => [],
    getAllTools: () => [],
    setActiveTools: () => undefined,
    getFlag: () => undefined,
    setModel: async () => true,
    getThinkingLevel: () => 'medium',
    setThinkingLevel: () => undefined,
    registerProvider: () => undefined,
    unregisterProvider: () => undefined,
    events: { emit: () => undefined, on: () => () => undefined },
  }
  return api as unknown as ExtensionAPI
}

test('PiExtension.install runs setup once and disposes on shutdown', async () => {
  //given
  let setupRuns = 0
  const plugin = PiExtension.define({
    id: 'tests/installer',
    effect: () =>
      Effect.sync(() => {
        setupRuns += 1
      }),
  })
  const callbacks = new Map<string, (event: unknown, context: ExtensionContext) => Promise<unknown>>()
  const factory = PiExtension.install(plugin)

  //when
  await factory(fakeApi(callbacks))
  await callbacks.get('session_shutdown')?.({ type: 'session_shutdown', reason: 'quit' }, fakeContext())

  //then
  expect(setupRuns).toBe(1)
})

export { fakeApi }
