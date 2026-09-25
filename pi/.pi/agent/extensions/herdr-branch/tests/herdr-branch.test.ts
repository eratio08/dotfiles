import { afterEach, beforeEach, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExecOptions, ExecResult, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { createFakeExtensionContext, installFakePlugin } from '@eratio/pi-effect/testing'
import herdrForkExtension from '../index.ts'

type TestContextOptions = {
  readonly confirmations?: string[]
  readonly cwd?: string
  readonly hasUI?: boolean
  readonly idle?: boolean
  readonly leafId?: string | null
  readonly mode?: ExtensionContext['mode']
  readonly notifications?: string[]
  readonly notificationLevels?: string[]
  readonly onShutdown?: () => void
  readonly onWaitForIdle?: () => void
  readonly sessionFile?: string
  readonly sessionId?: string
  readonly signal?: AbortSignal
}

function createTestContext(options: TestContextOptions = {}): ExtensionContext {
  const cwd = options.cwd ?? process.cwd()
  const base = createFakeExtensionContext(cwd)

  return {
    ...base,
    mode: options.mode ?? 'tui',
    hasUI: options.hasUI ?? true,
    cwd,
    signal: options.signal,
    sessionManager: {
      ...base.sessionManager,
      getCwd: () => cwd,
      getLeafId: () => (options.leafId === undefined ? 'entry-123' : options.leafId),
      getSessionId: () => options.sessionId ?? 'session-123',
      getSessionFile: () => options.sessionFile,
    },
    ui: {
      ...base.ui,
      confirm: async (_title: string, message: string) => {
        options.confirmations?.push(message)
        return false
      },
      notify: (message: string, level?: string) => {
        options.notifications?.push(message)
        if (level) options.notificationLevels?.push(level)
      },
    },
    isIdle: () => options.idle ?? true,
    waitForIdle: async () => options.onWaitForIdle?.(),
    shutdown: () => options.onShutdown?.(),
  } as ExtensionContext
}

async function shutdown(fake: Awaited<ReturnType<typeof installFakePlugin>>): Promise<void> {
  await fake.invokeEvent('session_shutdown', { type: 'session_shutdown', reason: 'quit' })
}

const environmentKeys = ['HERDR_ENV', 'HERDR_PANE_ID', 'HERDR_BIN_PATH'] as const
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]]))

beforeEach(() => {
  for (const key of environmentKeys) delete process.env[key]
})

afterEach(() => {
  for (const key of environmentKeys) {
    const value = originalEnvironment.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const extensionPath = fileURLToPath(new URL('../index.ts', import.meta.url))

test('should fork into a same-tab pane with the supplied name given a valid session', async () => {
  //given
  const tempDirectory = await mkdtemp(join(tmpdir(), 'herdr-fork-test-'))
  const sessionFile = join(tempDirectory, 'session.jsonl')
  const sessionId = 'session-source-123'
  const name = 'analysis'
  const cwd = tempDirectory
  await writeFile(sessionFile, '{}\n')
  const notifications: string[] = []
  const confirmations: string[] = []
  let waitForIdleCalls = 0
  Object.assign(process.env, {
    HERDR_ENV: '1',
    HERDR_PANE_ID: 'w1:p1',
    HERDR_BIN_PATH: 'herdr-test',
  })
  const context = createTestContext({
    confirmations,
    cwd,
    notifications,
    onWaitForIdle: () => {
      waitForIdleCalls += 1
    },
    sessionFile,
    sessionId,
  })
  const fake = await installFakePlugin(herdrForkExtension)
  const calls: Array<{ command: string; args: string[]; cwd: string | undefined }> = []

  fake.api.exec = async (command: string, args: string[], options?: ExecOptions): Promise<ExecResult> => {
    calls.push({ command, args: [...args], cwd: options?.cwd })

    if (args[0] === 'pane' && args[1] === 'split') {
      return {
        stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p2' } } }),
        stderr: '',
        code: 0,
        killed: false,
      }
    }

    return { stdout: '', stderr: '', code: 0, killed: false }
  }

  try {
    //when
    await fake.invokeCommand('herdr-fork', name, context)

    //then
    expect(waitForIdleCalls).toBe(1)
    expect(confirmations).toHaveLength(0)
    expect(calls).toHaveLength(2)
    expect(calls.map(({ command }) => command)).toEqual(['herdr-test', 'herdr-test'])
    expect(calls[0]?.args).toEqual(['pane', 'split', '--current', '--direction', 'right', '--cwd', cwd, '--focus'])
    expect(calls[0]?.cwd).toBe(cwd)
    expect(calls[1]?.args[0]).toBe('agent')
    expect(calls[1]?.args[1]).toBe('start')
    expect(calls[1]?.args[2]).toBe(name)
    expect(calls[1]?.args.slice(calls[1]?.args.indexOf('--'))).toEqual([
      '--',
      '--fork',
      sessionFile,
      '--extension',
      extensionPath,
    ])
    expect(calls[1]?.args).not.toContain('--session')
    expect(calls[1]?.cwd).toBe(cwd)
    expect(notifications.join('\n')).toContain(sessionId)
    expect(notifications.join('\n')).toContain(name)
    expect(notifications.join('\n')).toContain('w1:p2')
    expect(notifications.join('\n')).toContain('current tab and workspace')
    expect(notifications.join('\n')).toContain('/tree')
  } finally {
    await shutdown(fake)
    await rm(tempDirectory, { recursive: true, force: true })
  }
})

test('should generate a default Herdr agent name given the name is omitted', async () => {
  //given
  const tempDirectory = await mkdtemp(join(tmpdir(), 'herdr-fork-test-'))
  const sessionFile = join(tempDirectory, 'session.jsonl')
  await writeFile(sessionFile, '{}\n')
  Object.assign(process.env, {
    HERDR_ENV: '1',
    HERDR_PANE_ID: 'w1:p1',
    HERDR_BIN_PATH: 'herdr-test',
  })
  const context = createTestContext({ cwd: tempDirectory, sessionFile })
  const fake = await installFakePlugin(herdrForkExtension)
  const calls: string[][] = []
  fake.api.exec = async (_command: string, args: string[]): Promise<ExecResult> => {
    calls.push([...args])

    if (args[0] === 'pane' && args[1] === 'split') {
      return {
        stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p2' } } }),
        stderr: '',
        code: 0,
        killed: false,
      }
    }

    return { stdout: '', stderr: '', code: 0, killed: false }
  }

  try {
    //when
    await fake.invokeCommand('herdr-fork', '', context)

    //then
    expect(calls).toHaveLength(2)
    expect(calls[1]?.[2]).toMatch(/^pi-fork-[0-9a-f]{8}$/)
  } finally {
    await shutdown(fake)
    await rm(tempDirectory, { recursive: true, force: true })
  }
})

test('should create no pane given Pi has no UI', async () => {
  //given
  Object.assign(process.env, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' })
  const context = createTestContext({ hasUI: false })
  const fake = await installFakePlugin(herdrForkExtension)
  let execCalls = 0
  fake.api.exec = async (): Promise<ExecResult> => {
    execCalls += 1
    return { stdout: '', stderr: '', code: 0, killed: false }
  }

  try {
    //when
    await fake.invokeCommand('herdr-fork', 'analysis', context)

    //then
    expect(execCalls).toBe(0)
  } finally {
    await shutdown(fake)
  }
})

test('should create no pane given Pi is not in TUI mode', async () => {
  //given
  const notifications: string[] = []
  Object.assign(process.env, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' })
  const context = createTestContext({ mode: 'rpc', notifications })
  const fake = await installFakePlugin(herdrForkExtension)
  let execCalls = 0
  fake.api.exec = async (): Promise<ExecResult> => {
    execCalls += 1
    return { stdout: '', stderr: '', code: 0, killed: false }
  }

  try {
    //when
    await fake.invokeCommand('herdr-fork', 'analysis', context)

    //then
    expect(execCalls).toBe(0)
    expect(notifications.join('\n')).toContain('TUI mode')
  } finally {
    await shutdown(fake)
  }
})

test('should create no pane given the command runs outside Herdr', async () => {
  //given
  const notifications: string[] = []
  const context = createTestContext({ notifications })
  const fake = await installFakePlugin(herdrForkExtension)
  let execCalls = 0
  fake.api.exec = async (): Promise<ExecResult> => {
    execCalls += 1
    return { stdout: '', stderr: '', code: 0, killed: false }
  }

  try {
    //when
    await fake.invokeCommand('herdr-fork', 'analysis', context)

    //then
    expect(execCalls).toBe(0)
    expect(notifications.join('\n')).toContain('Herdr pane')
  } finally {
    await shutdown(fake)
  }
})

test('should pass cancellation to Herdr and stop before agent start given pane creation is cancelled', async () => {
  //given
  const tempDirectory = await mkdtemp(join(tmpdir(), 'herdr-branch-cancel-'))
  const sessionFile = join(tempDirectory, 'session.jsonl')
  await writeFile(sessionFile, '{}\n')
  const controller = new AbortController()
  Object.assign(process.env, {
    HERDR_ENV: '1',
    HERDR_PANE_ID: 'w1:p1',
    HERDR_BIN_PATH: 'herdr-test',
  })
  const context = createTestContext({ cwd: tempDirectory, sessionFile, signal: controller.signal })
  const fake = await installFakePlugin(herdrForkExtension)
  const calls: Array<{ command: string; args: string[]; signal: AbortSignal | undefined }> = []
  fake.api.exec = async (command: string, args: string[], options?: ExecOptions): Promise<ExecResult> => {
    calls.push({ command, args: [...args], signal: options?.signal })
    controller.abort()
    return {
      stdout: '',
      stderr: 'cancelled',
      code: 1,
      killed: options?.signal?.aborted ?? false,
    }
  }

  try {
    //when
    const cancelled = await fake.invokeCommand('herdr-fork', 'analysis', context).then(
      () => false,
      () => true,
    )

    //then
    expect(cancelled).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.command).toBe('herdr-test')
    expect(calls[0]?.signal?.aborted).toBe(true)
    expect(calls[0]?.args).toEqual([
      'pane',
      'split',
      '--current',
      '--direction',
      'right',
      '--cwd',
      tempDirectory,
      '--focus',
    ])
  } finally {
    await shutdown(fake)
    await rm(tempDirectory, { recursive: true, force: true })
  }
})

test('should create no pane given the parent remains busy after waiting for idle', async () => {
  //given
  const notifications: string[] = []
  const confirmations: string[] = []
  Object.assign(process.env, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' })
  const context = createTestContext({ confirmations, idle: false, notifications })
  const fake = await installFakePlugin(herdrForkExtension)
  let execCalls = 0
  fake.api.exec = async (): Promise<ExecResult> => {
    execCalls += 1
    return { stdout: '', stderr: '', code: 0, killed: false }
  }

  try {
    //when
    await fake.invokeCommand('herdr-fork', 'analysis', context)

    //then
    expect(execCalls).toBe(0)
    expect(confirmations).toHaveLength(0)
    expect(notifications.join('\n')).toContain('Wait until Pi is idle')
  } finally {
    await shutdown(fake)
  }
})

test('should explain that an empty session cannot be forked given the session has no leaf entry', async () => {
  //given
  const notifications: string[] = []
  const notificationLevels: string[] = []
  Object.assign(process.env, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' })
  const context = createTestContext({
    leafId: null,
    notificationLevels,
    notifications,
    sessionFile: join(tmpdir(), `empty-${randomUUID()}.jsonl`),
  })
  const fake = await installFakePlugin(herdrForkExtension)
  let execCalls = 0
  fake.api.exec = async (): Promise<ExecResult> => {
    execCalls += 1
    return { stdout: '', stderr: '', code: 0, killed: false }
  }

  try {
    //when
    await fake.invokeCommand('herdr-fork', 'analysis', context)

    //then
    expect(execCalls).toBe(0)
    expect(notifications).toContain(
      'Cannot fork an empty Pi session. Send a message first, then run /herdr-fork again.',
    )
    expect(notificationLevels).toContain('warning')
  } finally {
    await shutdown(fake)
  }
})

test('should warn that the session file is missing given no file exists for the session', async () => {
  //given
  const notifications: string[] = []
  const notificationLevels: string[] = []
  const confirmations: string[] = []
  Object.assign(process.env, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' })
  const context = createTestContext({
    confirmations,
    leafId: 'entry-123',
    notificationLevels,
    notifications,
    sessionFile: join(tmpdir(), `missing-${randomUUID()}.jsonl`),
  })
  const fake = await installFakePlugin(herdrForkExtension)
  let execCalls = 0
  fake.api.exec = async (): Promise<ExecResult> => {
    execCalls += 1
    return { stdout: '', stderr: '', code: 0, killed: false }
  }

  try {
    //when
    await fake.invokeCommand('herdr-fork', 'analysis', context)

    //then
    expect(execCalls).toBe(0)
    expect(confirmations).toHaveLength(0)
    expect(notifications).toContain(
      'The Pi session file does not exist yet. Send a message first, then run /herdr-fork again.',
    )
    expect(notificationLevels).toContain('warning')
    expect(notifications.join('\n')).not.toContain('ENOENT')
  } finally {
    await shutdown(fake)
  }
})

test('should keep the split pane given Pi fails to start', async () => {
  //given
  const tempDirectory = await mkdtemp(join(tmpdir(), 'herdr-fork-test-'))
  const sessionFile = join(tempDirectory, 'session.jsonl')
  await writeFile(sessionFile, '{}\n')
  const notifications: string[] = []
  Object.assign(process.env, {
    HERDR_ENV: '1',
    HERDR_PANE_ID: 'w1:p1',
    HERDR_BIN_PATH: 'herdr-test',
  })
  const context = createTestContext({ cwd: tempDirectory, notifications, sessionFile })
  const fake = await installFakePlugin(herdrForkExtension)
  const calls: Array<{ command: string; args: string[] }> = []
  fake.api.exec = async (command: string, args: string[]): Promise<ExecResult> => {
    calls.push({ command, args: [...args] })

    if (args[0] === 'pane' && args[1] === 'split') {
      return {
        stdout: JSON.stringify({ result: { pane: { pane_id: 'w1:p2' } } }),
        stderr: '',
        code: 0,
        killed: false,
      }
    }

    return { stdout: '', stderr: 'Pi did not become ready', code: 1, killed: false }
  }

  try {
    //when
    await fake.invokeCommand('herdr-fork', '', context)

    //then
    expect(calls).toHaveLength(2)
    expect(calls[0]?.args.slice(0, 2)).toEqual(['pane', 'split'])
    expect(calls[1]?.args[0]).toBe('agent')
    expect(calls[1]?.args[1]).toBe('start')
    expect(calls.some(({ args }) => args[0] === 'pane' && args[1] === 'close')).toBe(false)
    expect(notifications.join('\n')).toContain('w1:p2')
    expect(notifications.join('\n')).toContain('remains open')
    expect(notifications.join('\n')).toContain('Pi did not become ready')
  } finally {
    await shutdown(fake)
    await rm(tempDirectory, { recursive: true, force: true })
  }
})

test('should reject the name before pane creation given it starts with a hyphen', async () => {
  //given
  const notifications: string[] = []
  Object.assign(process.env, { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p1' })
  const context = createTestContext({ notifications })
  const fake = await installFakePlugin(herdrForkExtension)
  let execCalls = 0
  fake.api.exec = async (): Promise<ExecResult> => {
    execCalls += 1
    return { stdout: '', stderr: '', code: 0, killed: false }
  }

  try {
    //when
    await fake.invokeCommand('herdr-fork', '-invalid', context)

    //then
    expect(execCalls).toBe(0)
    expect(notifications.join('\n')).toContain('must not start with a hyphen')
  } finally {
    await shutdown(fake)
  }
})

test('should stop before agent start given Herdr rejects the pane split', async () => {
  //given
  const tempDirectory = await mkdtemp(join(tmpdir(), 'herdr-fork-test-'))
  const sessionFile = join(tempDirectory, 'session.jsonl')
  await writeFile(sessionFile, '{}\n')
  const notifications: string[] = []
  Object.assign(process.env, {
    HERDR_ENV: '1',
    HERDR_PANE_ID: 'w1:p1',
    HERDR_BIN_PATH: 'herdr-test',
  })
  const context = createTestContext({ cwd: tempDirectory, notifications, sessionFile })
  const fake = await installFakePlugin(herdrForkExtension)
  const calls: string[][] = []
  fake.api.exec = async (_command: string, args: string[]): Promise<ExecResult> => {
    calls.push([...args])
    return { stdout: '', stderr: 'split denied', code: 1, killed: false }
  }

  try {
    //when
    await fake.invokeCommand('herdr-fork', '', context)

    //then
    expect(calls).toHaveLength(1)
    expect(calls[0]?.slice(0, 2)).toEqual(['pane', 'split'])
    expect(notifications.join('\n')).toContain('split denied')
    expect(notifications.join('\n')).not.toContain('agent start')
  } finally {
    await shutdown(fake)
    await rm(tempDirectory, { recursive: true, force: true })
  }
})

test('should stop before agent start given Herdr omits the split pane ID', async () => {
  //given
  const tempDirectory = await mkdtemp(join(tmpdir(), 'herdr-fork-test-'))
  const sessionFile = join(tempDirectory, 'session.jsonl')
  await writeFile(sessionFile, '{}\n')
  const notifications: string[] = []
  Object.assign(process.env, {
    HERDR_ENV: '1',
    HERDR_PANE_ID: 'w1:p1',
    HERDR_BIN_PATH: 'herdr-test',
  })
  const context = createTestContext({ cwd: tempDirectory, notifications, sessionFile })
  const fake = await installFakePlugin(herdrForkExtension)
  const calls: Array<{ command: string; args: string[] }> = []
  fake.api.exec = async (command: string, args: string[]): Promise<ExecResult> => {
    calls.push({ command, args: [...args] })
    return { stdout: '{}', stderr: '', code: 0, killed: false }
  }

  try {
    //when
    await fake.invokeCommand('herdr-fork', '', context)

    //then
    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toEqual([
      'pane',
      'split',
      '--current',
      '--direction',
      'right',
      '--cwd',
      tempDirectory,
      '--focus',
    ])
    expect(notifications.join('\n')).toContain('split pane ID')
    expect(calls.some(({ args }) => args[0] === 'agent')).toBe(false)
  } finally {
    await shutdown(fake)
    await rm(tempDirectory, { recursive: true, force: true })
  }
})
