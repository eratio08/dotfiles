import assert from 'node:assert/strict'
import test from 'node:test'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import rtk from '../index.ts'

type Handler = (...args: unknown[]) => unknown

type FakePiOptions = {
  versionCode?: number
  rewriteCode?: number
  rewriteStdout?: string
  rewriteFailure?: boolean
}

function createPi(options: FakePiOptions = {}) {
  const calls: string[][] = []
  const signals: (AbortSignal | undefined)[] = []
  const handlers = new Map<string, Handler>()
  const pi = {
    exec: async (_command: string, args: string[], execOptions?: { signal?: AbortSignal }) => {
      calls.push(args)
      signals.push(execOptions?.signal)
      if (args[0] === '--version') {
        return { code: options.versionCode ?? 0, killed: false, stderr: '', stdout: 'rtk 0.48.0\n' }
      }
      if (options.rewriteFailure) {
        throw new Error('rewrite failed')
      }
      return {
        code: options.rewriteCode ?? 0,
        killed: false,
        stderr: '',
        stdout: options.rewriteStdout ?? `rtk ${args[1]}\n`,
      }
    },
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler)
    },
  }

  return { calls, signals, handlers, pi: pi as unknown as ExtensionAPI }
}

async function startPi(options: FakePiOptions = {}) {
  const testPi = createPi(options)
  await rtk(testPi.pi)
  return testPi
}

async function invoke(handlers: Map<string, Handler>, event: string, ...args: unknown[]) {
  const handler = handlers.get(event)
  if (!handler) {
    throw new Error(`Missing ${event} handler`)
  }
  await handler(...args)
}

async function captureWarnings(action: () => Promise<unknown>) {
  const warnings: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: Parameters<typeof console.warn>) => {
    warnings.push(args)
  }

  try {
    await action()
  } finally {
    console.warn = originalWarn
  }

  return warnings
}

test('extension validates RTK during startup', async () => {
  // given
  const { calls, handlers, pi } = createPi()

  // when
  await rtk(pi)

  // then
  assert.deepEqual(calls, [['--version']])
  assert.equal(handlers.has('tool_call'), true)
  assert.equal(handlers.has('session_shutdown'), true)
})

test('extension ignores non-bash tool calls', async () => {
  // given
  const { calls, handlers } = await startPi()

  // when
  await invoke(handlers, 'tool_call', { toolName: 'read', input: {} }, { signal: new AbortController().signal })

  // then
  assert.deepEqual(calls, [['--version']])
})

test('extension rewrites bash commands through the RTK dependency', async () => {
  // given
  const { calls, signals, handlers } = await startPi({ rewriteCode: 3 })
  const event = { toolName: 'bash', input: { command: 'ls -la' } }
  const signal = new AbortController().signal

  // when
  await invoke(handlers, 'tool_call', event, { signal })

  // then
  assert.equal(event.input.command, 'rtk ls -la')
  assert.deepEqual(calls, [['--version'], ['rewrite', 'ls -la']])
  assert.equal(signal.aborted, false)
  assert.ok(signals[1])
})

test('extension ignores empty rewrite output', async () => {
  // given
  const { handlers } = await startPi({ rewriteStdout: '' })
  const event = { toolName: 'bash', input: { command: 'ls -la' } }

  // when
  await invoke(handlers, 'tool_call', event, { signal: new AbortController().signal })

  // then
  assert.equal(event.input.command, 'ls -la')
})

test('extension ignores unchanged rewrite output', async () => {
  // given
  const { handlers } = await startPi({ rewriteStdout: 'ls -la\n' })
  const event = { toolName: 'bash', input: { command: 'ls -la' } }

  // when
  await invoke(handlers, 'tool_call', event, { signal: new AbortController().signal })

  // then
  assert.equal(event.input.command, 'ls -la')
})

test('extension ignores rewrite failures', async () => {
  // given
  const { handlers } = await startPi({ rewriteFailure: true })
  const event = { toolName: 'bash', input: { command: 'ls -la' } }

  // when
  await invoke(handlers, 'tool_call', event, { signal: new AbortController().signal })

  // then
  assert.equal(event.input.command, 'ls -la')
})

test('extension disposes on session shutdown', async () => {
  // given
  const { calls, handlers } = await startPi()

  // when
  await invoke(handlers, 'session_shutdown')

  // then
  assert.deepEqual(calls, [['--version']])
})

test('extension disables when RTK binary is unavailable', async () => {
  // given
  const { calls, handlers, pi } = createPi({ versionCode: 1 })

  // when
  const warnings = await captureWarnings(() => rtk(pi))

  // then
  assert.deepEqual(calls, [['--version']])
  assert.equal(handlers.has('tool_call'), false)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0]?.[0], '[rtk] rtk binary not found in PATH — extension disabled')
})
