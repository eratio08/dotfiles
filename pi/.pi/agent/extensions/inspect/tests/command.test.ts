import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { type ExtensionAPI, type ExtensionCommandContext, SessionManager } from '@earendil-works/pi-coding-agent'
import inspectExtension from '../index.ts'

type CommandHandler = (args: string, context: ExtensionCommandContext) => Promise<void>
type Notice = { message: string; type?: 'info' | 'warning' | 'error' }
type Widget = {
  key: string
  content: string[] | undefined
  placement?: 'aboveEditor' | 'belowEditor'
}
type CommandHarness = {
  handler: CommandHandler
  context: ExtensionCommandContext
  notices: Notice[]
  widgets: Widget[]
  openedUrls: string[]
  shutdown: () => Promise<void>
}

function createHarness(directory: string, sessionManager: SessionManager, browserError?: Error): CommandHarness {
  const notices: Notice[] = []
  const widgets: CommandHarness['widgets'] = []
  const openedUrls: string[] = []
  let commandHandler: CommandHandler | undefined
  let registeredCommandName: string | undefined
  let shutdownHandler: ((context: ExtensionCommandContext) => Promise<void>) | undefined
  const api = {
    on: (
      _event: string,
      handler: (event: unknown, context: ExtensionCommandContext) => Promise<void>,
    ): (() => void) => {
      shutdownHandler = async (context: ExtensionCommandContext): Promise<void> => {
        await handler({ type: 'session_shutdown' }, context)
      }
      return () => {}
    },
    registerCommand: (name: string, options: { handler: CommandHandler }): void => {
      registeredCommandName = name
      commandHandler = options.handler
    },
    getActiveTools: (): string[] => [],
    getAllTools: (): never[] => [],
  } as unknown as ExtensionAPI

  inspectExtension(api, async (url: string): Promise<void> => {
    openedUrls.push(url)
    if (browserError) throw browserError
  })

  if (!commandHandler || registeredCommandName !== 'inspect') throw new Error('Inspect command was not registered.')

  const context = {
    mode: 'tui',
    hasUI: true,
    cwd: directory,
    sessionManager,
    signal: undefined,
    getContextUsage: () => undefined,
    getSystemPrompt: () => 'Test system prompt',
    getSystemPromptOptions: () => ({ cwd: directory }),
    ui: {
      notify: (message: string, type?: Notice['type']): void => {
        notices.push({ message, type })
      },
      setWidget: (key: string, content: string[] | undefined, options?: { placement?: Widget['placement'] }): void => {
        widgets.push({ key, content, ...(options?.placement ? { placement: options.placement } : {}) })
      },
    },
  } as unknown as ExtensionCommandContext

  return {
    handler: commandHandler,
    context,
    notices,
    widgets,
    openedUrls,
    shutdown: async (): Promise<void> => {
      await shutdownHandler?.(context)
    },
  }
}

test('should serve the active branch and keep the running indicator given the current session', async () => {
  //given
  const directory = await mkdtemp(join(tmpdir(), 'context-metering-'))
  const manager = SessionManager.inMemory(directory)
  const rootId = manager.appendMessage({ role: 'user', content: 'branch-root', timestamp: 1 })
  manager.appendMessage({ role: 'user', content: 'abandoned-branch-entry', timestamp: 2 })
  manager.branch(rootId)
  manager.appendMessage({ role: 'user', content: 'active-branch-entry', timestamp: 3 })
  const entriesBefore = manager.getEntries().map((entry) => entry.id)
  const branchBefore = manager.getBranch().map((entry) => entry.id)
  const leafBefore = manager.getLeafId()
  const harness = createHarness(directory, manager)

  try {
    //when
    await harness.handler('', harness.context)

    //then
    assert.deepEqual(harness.widgets, [
      { key: 'inspect', content: ['Generating Inspect report…'], placement: 'aboveEditor' },
      {
        key: 'inspect',
        content: ['Inspect server running · /inspect again to stop'],
        placement: 'aboveEditor',
      },
    ])
    const output = harness.notices.find((notice) => notice.type === 'info')
    const reportUrl = harness.openedUrls[0]
    assert.ok(output)
    assert.ok(reportUrl)
    assert.ok(output.message.includes(reportUrl))
    assert.match(reportUrl, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]{36}$/)
    const response = await fetch(reportUrl)
    assert.equal(response.status, 200)
    const html = await response.text()
    assert.deepEqual(await readdir(directory), [])
    assert.match(html, /active-branch-entry/)
    assert.match(html, /Pi Inspect/)
    assert.doesNotMatch(html, /abandoned-branch-entry/)
    assert.deepEqual(
      manager.getEntries().map((entry) => entry.id),
      entriesBefore,
    )
    assert.deepEqual(
      manager.getBranch().map((entry) => entry.id),
      branchBefore,
    )
    assert.equal(manager.getLeafId(), leafBefore)
  } finally {
    await harness.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})

test('should show Pi context usage beside the reconstructed estimate given a current request', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'context-metering-'))
  const manager = SessionManager.inMemory(directory)
  manager.appendMessage({ role: 'user', content: 'window-test', timestamp: 1 })
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'response' }],
    api: 'test',
    provider: 'test-provider',
    model: 'test-model',
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 2,
  })
  const harness = createHarness(directory, manager)
  Object.assign(harness.context, {
    model: { provider: 'test-provider', id: 'test-model', contextWindow: 100 },
    getContextUsage: () => ({ tokens: 72, contextWindow: 100, percent: 72 }),
  })

  try {
    await harness.handler('', harness.context)
    const reportUrl = harness.openedUrls[0]
    assert.ok(reportUrl)
    const response = await fetch(reportUrl)
    const html = await response.text()
    assert.equal(response.status, 200)
    assert.match(html, /Pi context estimate/)
    assert.match(html, /72% of 100 tokens/)
    assert.match(html, /Reconstructed request estimate/)
  } finally {
    await harness.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})

test('should serve the requested saved branch given a session file and leaf ID', async () => {
  //given
  const directory = await mkdtemp(join(tmpdir(), 'context-metering-'))
  const sessionPath = join(directory, 'saved session.jsonl')
  const session = [
    '{"type":"session","version":3,"id":"saved-session","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/project"}',
    '{"type":"message","id":"00000001","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":"saved-root","timestamp":1767225601000}}',
    '{"type":"message","id":"00000002","parentId":"00000001","timestamp":"2026-01-01T00:00:02.000Z","message":{"role":"user","content":"selected-saved-branch","timestamp":1767225602000}}',
    '{"type":"message","id":"00000003","parentId":"00000001","timestamp":"2026-01-01T00:00:03.000Z","message":{"role":"user","content":"other-saved-branch","timestamp":1767225603000}}',
  ].join('\n')
  await writeFile(sessionPath, session)
  const sessionBefore = await readFile(sessionPath, 'utf8')
  const harness = createHarness(directory, SessionManager.inMemory(directory))

  try {
    //when
    await harness.handler(`"${sessionPath}" --leaf 00000002`, harness.context)

    //then
    const reportUrl = harness.openedUrls[0]
    assert.ok(reportUrl)
    const response = await fetch(reportUrl)
    const html = await response.text()
    assert.equal(response.status, 200)
    assert.match(html, /selected-saved-branch/)
    assert.doesNotMatch(html, /other-saved-branch/)
    assert.deepEqual(await readdir(directory), ['saved session.jsonl'])
    assert.equal(await readFile(sessionPath, 'utf8'), sessionBefore)
  } finally {
    await harness.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})

test('should keep serving and show its URL given a browser launch failure', async () => {
  //given
  const directory = await mkdtemp(join(tmpdir(), 'context-metering-'))
  const manager = SessionManager.inMemory(directory)
  manager.appendMessage({ role: 'user', content: 'browser-open-test', timestamp: 1 })
  const harness = createHarness(directory, manager, new Error('Browser launch failed.'))

  try {
    //when
    await harness.handler('', harness.context)

    //then
    const warning = harness.notices.find(
      (notice) => notice.type === 'warning' && notice.message.includes('browser could not open it'),
    )
    const reportUrl = harness.openedUrls[0]
    assert.ok(warning)
    assert.ok(reportUrl)
    assert.ok(warning.message.includes(reportUrl))
    assert.ok(warning.message.includes('browser could not open it: Browser launch failed.'))
    assert.deepEqual(harness.widgets, [
      { key: 'inspect', content: ['Generating Inspect report…'], placement: 'aboveEditor' },
      {
        key: 'inspect',
        content: ['Inspect server running · /inspect again to stop'],
        placement: 'aboveEditor',
      },
    ])
    assert.deepEqual(await readdir(directory), [])
    assert.match(await (await fetch(reportUrl)).text(), /browser-open-test/)
  } finally {
    await harness.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})

test('should stop the report server and clear its widget given a repeated command', async () => {
  //given
  const directory = await mkdtemp(join(tmpdir(), 'context-metering-'))
  const manager = SessionManager.inMemory(directory)
  manager.appendMessage({ role: 'user', content: 'stop-server-test', timestamp: 1 })
  const harness = createHarness(directory, manager)
  await harness.handler('', harness.context)
  const reportUrl = harness.openedUrls[0]
  assert.ok(reportUrl)

  try {
    //when
    await harness.handler('', harness.context)

    //then
    assert.equal(harness.widgets.at(-1)?.content, undefined)
    assert.ok(harness.notices.some((notice) => notice.message === 'Inspect server stopped.'))
    await assert.rejects(fetch(reportUrl))
    assert.deepEqual(await readdir(directory), [])
  } finally {
    await harness.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})

test('should close the report server and clear its widget on session shutdown given a running server', async () => {
  //given
  const directory = await mkdtemp(join(tmpdir(), 'context-metering-'))
  const manager = SessionManager.inMemory(directory)
  manager.appendMessage({ role: 'user', content: 'shutdown-server-test', timestamp: 1 })
  const harness = createHarness(directory, manager)
  await harness.handler('', harness.context)
  const reportUrl = harness.openedUrls[0]
  assert.ok(reportUrl)

  try {
    //when
    await harness.shutdown()

    //then
    assert.equal(harness.widgets.at(-1)?.content, undefined)
    await assert.rejects(fetch(reportUrl))
  } finally {
    await harness.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})

test('should stop the active server before parsing arguments given a repeated report command', async () => {
  //given
  const directory = await mkdtemp(join(tmpdir(), 'context-metering-'))
  const manager = SessionManager.inMemory(directory)
  manager.appendMessage({ role: 'user', content: 'repeated-server-test', timestamp: 1 })
  const harness = createHarness(directory, manager)
  await harness.handler('', harness.context)
  const reportUrl = harness.openedUrls[0]
  assert.ok(reportUrl)

  try {
    //when
    await harness.handler('missing-session.jsonl', harness.context)

    //then
    assert.deepEqual(harness.openedUrls, [reportUrl])
    assert.ok(harness.notices.some((notice) => notice.message === 'Inspect server stopped.'))
    assert.equal(harness.widgets.at(-1)?.content, undefined)
    await assert.rejects(fetch(reportUrl))
    assert.deepEqual(await readdir(directory), [])
  } finally {
    await harness.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})

test('should clear the widget and report errors given an unreadable saved session file', async () => {
  //given
  const directory = await mkdtemp(join(tmpdir(), 'context-metering-'))
  const missingPath = join(directory, 'missing-session.jsonl')
  const harness = createHarness(directory, SessionManager.inMemory(directory))

  try {
    //when
    await harness.handler(missingPath, harness.context)

    //then
    assert.deepEqual(harness.widgets, [
      { key: 'inspect', content: ['Generating Inspect report…'], placement: 'aboveEditor' },
      { key: 'inspect', content: undefined },
    ])
    assert.ok(harness.notices.some((notice) => notice.type === 'error' && notice.message.includes('ENOENT')))
    assert.deepEqual(harness.openedUrls, [])
    assert.deepEqual(await readdir(directory), [])
  } finally {
    await harness.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})

test('should start the report without a privacy warning given a command invocation', async () => {
  //given
  const directory = await mkdtemp(join(tmpdir(), 'context-metering-'))
  const manager = SessionManager.inMemory(directory)
  const harness = createHarness(directory, manager)

  try {
    //when
    await harness.handler('', harness.context)

    //then
    assert.deepEqual(
      harness.notices.filter((notice) => notice.type === 'warning'),
      [],
    )
    assert.ok(harness.openedUrls[0])
    assert.deepEqual(await readdir(directory), [])
  } finally {
    await harness.shutdown()
    await rm(directory, { recursive: true, force: true })
  }
})
