import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Effect, ManagedRuntime } from 'effect'
import cavemanExtension from '../index.ts'
import { getModeInstructions } from '../src/core.ts'
import { Caveman, CavemanContext, CavemanHostError, CavemanLayer } from '../src/effects.ts'

type MessageOptions = {
  deliverAs?: 'steer' | 'followUp'
  expandPromptTemplates?: boolean
}
type EventHandler = (event: unknown, ctx: ExtensionContext) => Promise<unknown>
type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<unknown>
type AppendEntry = (customType: string, data?: unknown) => void
type SendUserMessage = (content: string, options?: MessageOptions) => void

interface PiOverrides {
  appendEntry?: AppendEntry
  sendUserMessage?: SendUserMessage
}

interface TestHarness {
  pi: ExtensionAPI
  events: Map<string, EventHandler>
  commands: Map<string, CommandHandler>
  appended: Array<{ customType: string; data: unknown }>
  messages: Array<{ content: string; options?: MessageOptions }>
}

interface ContextOptions {
  entries?: readonly unknown[]
  hasUI?: boolean
  idle?: boolean
  throwOnUi?: boolean
}

interface ContextFixture {
  ctx: ExtensionContext
  statuses: Array<{ key: string; text: string | undefined }>
  notifications: Array<{ message: string; type: string | undefined }>
}

function makePi(overrides: PiOverrides = {}): TestHarness {
  const events = new Map<string, EventHandler>()
  const commands = new Map<string, CommandHandler>()
  const appended: Array<{ customType: string; data: unknown }> = []
  const messages: Array<{ content: string; options?: MessageOptions }> = []
  const appendEntry = overrides.appendEntry ?? ((customType, data) => appended.push({ customType, data }))
  const sendUserMessage = overrides.sendUserMessage ?? ((content, options) => messages.push({ content, options }))

  const pi = {
    on(event: string, handler: EventHandler): void {
      events.set(event, handler)
    },
    registerCommand(name: string, options: { handler: CommandHandler }): void {
      commands.set(name, options.handler)
    },
    appendEntry,
    sendUserMessage,
  } as unknown as ExtensionAPI

  return { pi, events, commands, appended, messages }
}

function makeContext(options: ContextOptions = {}): ContextFixture {
  const statuses: Array<{ key: string; text: string | undefined }> = []
  const notifications: Array<{ message: string; type: string | undefined }> = []
  const hasUI = options.hasUI ?? true
  const entries = options.entries ?? []
  const ui = {
    theme: {
      fg: (_color: string, text: string): string => text,
    },
    setStatus(key: string, text: string | undefined): void {
      if (options.throwOnUi) throw new Error('status failed')
      statuses.push({ key, text })
    },
    notify(message: string, type?: string): void {
      if (options.throwOnUi) throw new Error('notification failed')
      notifications.push({ message, type })
    },
  }
  const ctx = {
    ui,
    mode: hasUI ? 'tui' : 'print',
    hasUI,
    cwd: '/tmp/caveman-test',
    sessionManager: { getBranch: () => entries },
    modelRegistry: {},
    model: undefined,
    scopedModels: [],
    signal: undefined,
    isIdle: () => options.idle ?? true,
    isProjectTrusted: () => true,
    abort: () => undefined,
    hasPendingMessages: () => false,
    shutdown: () => undefined,
    getContextUsage: () => undefined,
    compact: () => undefined,
    getSystemPrompt: () => '',
  } as unknown as ExtensionContext
  return { ctx, statuses, notifications }
}

function eventHandler(harness: TestHarness, name: string): EventHandler {
  const handler = harness.events.get(name)
  if (!handler) throw new Error(`Missing event handler: ${name}`)
  return handler
}

function commandHandler(harness: TestHarness, name: string): CommandHandler {
  const handler = harness.commands.get(name)
  if (!handler) throw new Error(`Missing command handler: ${name}`)
  return handler
}

test('service persists mode and tracks agent activity', async () => {
  //given
  const harness = makePi()
  const context = makeContext()
  const runtime = ManagedRuntime.make(CavemanLayer(harness.pi))

  try {
    //when
    const result = await runtime.runPromise(
      Effect.provideService(
        Effect.gen(function* () {
          const caveman = yield* Caveman
          yield* caveman.setMode('lite')
          yield* caveman.setAgentActive(true)
          return {
            mode: yield* caveman.mode,
            agentActive: yield* caveman.agentActive,
          }
        }),
        CavemanContext,
        context.ctx,
      ),
    )

    //then
    assert.deepEqual(result, { mode: 'lite', agentActive: true })
    assert.deepEqual(harness.appended, [{ customType: 'caveman-mode', data: { mode: 'lite' } }])
    assert.deepEqual(context.notifications, [{ message: 'caveman: lite', type: 'info' }])
    assert.deepEqual(context.statuses, [
      { key: 'caveman', text: '○ 🪨 caveman: 🌿' },
      { key: 'caveman', text: '● 🪨 caveman: 🌿' },
    ])
  } finally {
    await runtime.dispose()
  }
})

test('service is safe without UI', async () => {
  //given
  const harness = makePi()
  const context = makeContext({ hasUI: false, throwOnUi: true })
  const runtime = ManagedRuntime.make(CavemanLayer(harness.pi))

  try {
    //when
    const result = await runtime.runPromise(
      Effect.provideService(
        Effect.gen(function* () {
          const caveman = yield* Caveman
          yield* caveman.setMode('ultra')
          yield* caveman.setAgentActive(true)
          yield* caveman.notify('ignored', 'warning')
          yield* caveman.shutdown()
          return yield* caveman.agentActive
        }),
        CavemanContext,
        context.ctx,
      ),
    )

    //then
    assert.equal(result, false)
    assert.deepEqual(context.statuses, [])
    assert.deepEqual(context.notifications, [])
    assert.deepEqual(harness.appended, [{ customType: 'caveman-mode', data: { mode: 'ultra' } }])
  } finally {
    await runtime.dispose()
  }
})

test('service delivers aliases based on idle state', async () => {
  //given
  const harness = makePi()
  const idleContext = makeContext({ idle: true })
  const busyContext = makeContext({ idle: false })
  const runtime = ManagedRuntime.make(CavemanLayer(harness.pi))

  try {
    //when
    await runtime.runPromise(
      Effect.gen(function* () {
        const caveman = yield* Caveman
        yield* Effect.provideService(
          caveman.sendAlias('caveman-review', '  src/core.ts  '),
          CavemanContext,
          idleContext.ctx,
        )
        yield* Effect.provideService(caveman.sendAlias('caveman-commit', ''), CavemanContext, busyContext.ctx)
      }),
    )

    //then
    assert.deepEqual(harness.messages, [
      { content: '/skill:caveman-review src/core.ts', options: undefined },
      { content: '/skill:caveman-commit', options: { deliverAs: 'followUp' } },
    ])
    assert.deepEqual(busyContext.notifications, [{ message: 'caveman-commit queued', type: 'info' }])
  } finally {
    await runtime.dispose()
  }
})

test('service reports persistence failures without changing mode', async () => {
  //given
  const harness = makePi({
    appendEntry: () => {
      throw new Error('append failed')
    },
  })
  const context = makeContext({ hasUI: false })
  const runtime = ManagedRuntime.make(CavemanLayer(harness.pi))
  const effect = Effect.provideService(
    Effect.gen(function* () {
      const caveman = yield* Caveman
      yield* caveman.setMode('lite')
    }),
    CavemanContext,
    context.ctx,
  )

  try {
    //when
    const rejection = runtime.runPromise(effect)

    //then
    await assert.rejects(rejection, (error: unknown) => {
      return error instanceof CavemanHostError && error.operation === 'appendEntry'
    })
    const mode = await runtime.runPromise(
      Effect.gen(function* () {
        const caveman = yield* Caveman
        return yield* caveman.mode
      }),
    )
    assert.equal(mode, 'full')
  } finally {
    await runtime.dispose()
  }
})

test('input uses the current event context', async () => {
  //given
  const harness = makePi()
  cavemanExtension(harness.pi)
  const initialContext = makeContext({ entries: [] })
  const eventContext = makeContext()
  await eventHandler(harness, 'session_start')({}, initialContext.ctx)
  const input = eventHandler(harness, 'input')

  try {
    //when
    const result = await input({ source: 'interactive', text: '/caveman ultra' }, eventContext.ctx)

    //then
    assert.deepEqual(result, { action: 'continue' })
    assert.deepEqual(harness.appended, [{ customType: 'caveman-mode', data: { mode: 'ultra' } }])
    assert.equal(initialContext.statuses.at(-1)?.text, '○ 🪨 caveman: ⚡')
    assert.equal(eventContext.statuses.at(-1)?.text, '○ 🪨 caveman: 🔥')
  } finally {
    await eventHandler(harness, 'session_shutdown')({}, eventContext.ctx)
  }
})

test('before agent start injects mode instructions', async () => {
  //given
  const harness = makePi()
  cavemanExtension(harness.pi)
  const context = makeContext()
  const beforeAgentStart = eventHandler(harness, 'before_agent_start')

  try {
    //when
    const result = await beforeAgentStart({ systemPrompt: 'base prompt' }, context.ctx)

    //then
    assert.deepEqual(result, {
      systemPrompt: `base prompt\n\n${getModeInstructions('full')}`,
    })
  } finally {
    await eventHandler(harness, 'session_shutdown')({}, context.ctx)
  }
})

test('before agent start does not inject instructions in off mode', async () => {
  //given
  const harness = makePi()
  cavemanExtension(harness.pi)
  const context = makeContext()
  await eventHandler(harness, 'input')({ source: 'interactive', text: '/caveman off' }, context.ctx)
  const beforeAgentStart = eventHandler(harness, 'before_agent_start')

  try {
    //when
    const result = await beforeAgentStart({ systemPrompt: 'base prompt' }, context.ctx)

    //then
    assert.equal(result, undefined)
  } finally {
    await eventHandler(harness, 'session_shutdown')({}, context.ctx)
  }
})

test('session shutdown clears status and disposes runtime', async () => {
  //given
  const harness = makePi()
  cavemanExtension(harness.pi)
  const context = makeContext()
  await eventHandler(harness, 'session_start')({}, context.ctx)
  const shutdown = eventHandler(harness, 'session_shutdown')
  const command = commandHandler(harness, 'caveman')

  //when
  await shutdown({}, context.ctx)

  //then
  assert.equal(context.statuses.at(-1)?.text, '')
  await assert.rejects(command('lite', context.ctx))
})
