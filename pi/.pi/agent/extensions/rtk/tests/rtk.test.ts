import { test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { createFakeExtensionApi, createFakeExtensionContext } from '@eratio/pi-effect/testing'
import rtk from '../index.ts'

type FakePiOptions = {
  versionCode?: number
  versionFailure?: boolean
  rewriteCode?: number
  rewriteStdout?: string
  rewriteFailure?: boolean
}

type FakePi = ReturnType<typeof createFakeExtensionApi> & {
  calls: string[][]
  signals: (AbortSignal | undefined)[]
}

function createPi(options: FakePiOptions = {}): FakePi {
  const fake = createFakeExtensionApi()
  const calls: string[][] = []
  const signals: (AbortSignal | undefined)[] = []

  fake.api.exec = async (
    _command: Parameters<ExtensionAPI['exec']>[0],
    args: Parameters<ExtensionAPI['exec']>[1],
    execOptions?: Parameters<ExtensionAPI['exec']>[2],
  ): ReturnType<ExtensionAPI['exec']> => {
    calls.push(args)
    signals.push(execOptions?.signal)
    if (args[0] === '--version') {
      if (options.versionFailure) {
        throw new Error('version check failed')
      }
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
  }

  return { ...fake, calls, signals }
}

async function startPi(options: FakePiOptions = {}): Promise<FakePi> {
  const fake = createPi(options)
  await rtk(fake.api)
  return fake
}

async function shutdown(fake: FakePi): Promise<void> {
  await fake.invokeEvent('session_shutdown', { type: 'session_shutdown', reason: 'quit' })
}

async function captureWarnings(action: () => Promise<void> | void): Promise<unknown[][]> {
  const warnings: unknown[][] = []
  const originalWarn = console.warn
  console.warn = (...args: Parameters<typeof console.warn>): void => {
    warnings.push(args)
  }

  try {
    await action()
  } finally {
    console.warn = originalWarn
  }

  return warnings
}

test('should validate RTK given extension startup', async () => {
  // given
  const fake = createPi()

  // when
  await rtk(fake.api)

  // then
  assert.deepEqual(fake.calls, [['--version']])
  assert.equal(fake.events.has('tool_call'), true)
  assert.equal(fake.events.has('session_shutdown'), true)
  await shutdown(fake)
})

test('should ignore non-Bash tool calls given another tool type', async () => {
  // given
  const fake = await startPi()

  // when
  await fake.invokeEvent('tool_call', { type: 'tool_call', toolName: 'read', input: {} })

  // then
  assert.deepEqual(fake.calls, [['--version']])
  await shutdown(fake)
})

test('should ignore empty commands given an empty Bash command', async () => {
  // given
  const fake = await startPi()
  const event = { type: 'tool_call', toolName: 'bash', input: { command: '' } }

  // when
  await fake.invokeEvent('tool_call', event)

  // then
  assert.equal(event.input.command, '')
  assert.deepEqual(fake.calls, [['--version']])
  await shutdown(fake)
})

test('should rewrite Bash commands given the RTK dependency', async () => {
  // given
  const fake = await startPi({ rewriteCode: 3 })
  const event = { type: 'tool_call', toolName: 'bash', input: { command: 'ls -la' } }
  const controller = new AbortController()
  const context = { ...createFakeExtensionContext(), signal: controller.signal }

  // when
  await fake.invokeEvent('tool_call', event, context)

  // then
  assert.equal(event.input.command, 'rtk ls -la')
  assert.deepEqual(fake.calls, [['--version'], ['rewrite', 'ls -la']])
  assert.ok(fake.signals[1])
  assert.equal(fake.signals[1]?.aborted, false)
  controller.abort()
  assert.equal(fake.signals[1]?.aborted, true)
  await shutdown(fake)
})

test('should ignore rewrite output given empty output', async () => {
  // given
  const fake = await startPi({ rewriteStdout: '' })
  const event = { type: 'tool_call', toolName: 'bash', input: { command: 'ls -la' } }

  // when
  await fake.invokeEvent('tool_call', event)

  // then
  assert.equal(event.input.command, 'ls -la')
  await shutdown(fake)
})

test('should ignore rewrite output given an unchanged command', async () => {
  // given
  const fake = await startPi({ rewriteStdout: 'ls -la\n' })
  const event = { type: 'tool_call', toolName: 'bash', input: { command: 'ls -la' } }

  // when
  await fake.invokeEvent('tool_call', event)

  // then
  assert.equal(event.input.command, 'ls -la')
  await shutdown(fake)
})

test('should ignore rewrite failures given a failed rewrite', async () => {
  // given
  const fake = await startPi({ rewriteFailure: true })
  const event = { type: 'tool_call', toolName: 'bash', input: { command: 'ls -la' } }

  // when
  await fake.invokeEvent('tool_call', event)

  // then
  assert.equal(event.input.command, 'ls -la')
  await shutdown(fake)
})

test('should dispose the extension given session shutdown', async () => {
  // given
  const fake = await startPi()

  // when
  await shutdown(fake)

  // then
  assert.deepEqual(fake.calls, [['--version']])
})

test('should disable RTK given an unavailable RTK binary', async () => {
  // given
  const fake = createPi({ versionCode: 1 })

  // when
  const warnings = await captureWarnings(() => rtk(fake.api))

  // then
  assert.deepEqual(fake.calls, [['--version']])
  assert.equal(fake.events.has('tool_call'), false)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0]?.[0], '[rtk] rtk binary not found in PATH — extension disabled')
  await shutdown(fake)
})

test('should disable RTK given a rejected version check', async () => {
  // given
  const fake = createPi({ versionFailure: true })

  // when
  const warnings = await captureWarnings(() => rtk(fake.api))

  // then
  assert.deepEqual(fake.calls, [['--version']])
  assert.equal(fake.events.has('tool_call'), false)
  assert.equal(warnings.length, 1)
  assert.equal(warnings[0]?.[0], '[rtk] rtk binary not found in PATH — extension disabled')
  await shutdown(fake)
})
