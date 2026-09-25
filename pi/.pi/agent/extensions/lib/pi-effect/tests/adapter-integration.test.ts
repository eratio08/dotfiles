import { expect, test } from 'bun:test'
import type { ExtensionContext, ProjectTrustContext } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, Schema } from 'effect'
import { Type } from 'typebox'
import {
  Pi,
  PiCommandContext,
  PiContext,
  PiExtension,
  type PiHostError,
  PiHostService,
  PiMessages,
  PiProcess,
  PiRegistrationError,
  PiSessionContext,
  PiToolContext,
  PiToolError,
  type PiToolResult,
  PiUi,
  PiUiUnavailableError,
} from '../src/index.ts'
import { createFakeExtensionApi, createFakeExtensionContext, installFakePlugin } from '../src/testing/fake.ts'

const inputEvent = {
  type: 'input' as const,
  text: 'hello',
  source: 'interactive' as const,
}

async function shutdown(fake: Awaited<ReturnType<typeof installFakePlugin>>): Promise<void> {
  await fake.invokeEvent('session_shutdown', { type: 'session_shutdown', reason: 'quit' })
}

test('should preserve event results and provide the current invocation context given an event invocation', async () => {
  //given
  let cwd = ''
  let systemPromptOptions: unknown
  const plugin = PiExtension.define({
    id: 'tests/event-result',
    effect: (registrations) =>
      registrations.events.on('input', (event) =>
        Effect.gen(function* () {
          cwd = (yield* PiContext).cwd
          const command = yield* PiCommandContext
          systemPromptOptions = yield* command.systemPromptOptions()
          return { action: 'transform', text: event.text.toUpperCase() }
        }),
      ),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))
  const context = { ...createFakeExtensionContext(), cwd: '/workspace' } as ExtensionContext

  //when
  const results = await fake.invokeEvent('input', inputEvent, context)
  await shutdown(fake)

  //then
  expect(results).toEqual([{ action: 'transform', text: 'HELLO' }])
  expect(cwd).toBe('/workspace')
  expect(systemPromptOptions).toEqual({ cwd: '/workspace' })
})

test('should accept void effects given a side-effect-only event handler', async () => {
  //given
  let handled = false
  const plugin = PiExtension.define({
    id: 'tests/void-event-result',
    effect: (registrations) =>
      registrations.events.on('session_start', () =>
        Effect.sync(() => {
          handled = true
        }),
      ),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))

  try {
    //when
    await fake.invokeEvent('session_start', { type: 'session_start' })

    //then
    expect(handled).toBe(true)
  } finally {
    await shutdown(fake)
  }
})

test('should map invocation context read failures to PiHostError given a failing host read', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/context-read-failure',
    effect: ({ events }) =>
      events.on(
        'session_start',
        () =>
          Effect.gen(function* () {
            const context = yield* PiContext
            yield* context.isIdle()
            return undefined
          }),
        { failure: 'propagate' },
      ),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))
  const context = {
    ...createFakeExtensionContext(),
    isIdle: () => {
      throw new Error('idle check failed')
    },
  } as ExtensionContext

  //when
  const execution = fake.invokeEvent('session_start', { type: 'session_start' }, context)

  //then
  await expect(execution).rejects.toMatchObject({
    _tag: 'PiHostError',
    operation: 'isIdle',
  } satisfies Partial<PiHostError>)
  await shutdown(fake)
})

test('should map command system-prompt option failures to PiHostError given a failing option read', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/system-prompt-options-read-failure',
    effect: (registrations) =>
      registrations.commands.register('test-command', {
        handler: () =>
          Effect.gen(function* () {
            const command = yield* PiCommandContext
            yield* command.systemPromptOptions()
            return undefined
          }),
      }),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))
  const commandContext = {
    ...createFakeExtensionContext(),
    getSystemPromptOptions: () => {
      throw new Error('system prompt options failed')
    },
  } as ExtensionContext

  //when
  const execution = fake.invokeCommand('test-command', '', commandContext)

  //then
  await expect(execution).rejects.toMatchObject({
    _tag: 'PiHostError',
    operation: 'systemPromptOptions',
  } satisfies Partial<PiHostError>)
  await shutdown(fake)
})

test('should map session snapshot failures to PiHostError given a failing session read', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/session-snapshot-failure',
    effect: ({ events }) =>
      events.on(
        'session_start',
        () =>
          Effect.gen(function* () {
            yield* PiSessionContext
            return undefined
          }),
        { failure: 'propagate' },
      ),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))
  const hostContext = createFakeExtensionContext()
  const context = {
    ...hostContext,
    sessionManager: {
      ...hostContext.sessionManager,
      getCwd: () => {
        throw new Error('session cwd failed')
      },
    },
  } as ExtensionContext

  //when
  const execution = fake.invokeEvent('session_start', { type: 'session_start' }, context)

  //then
  await expect(execution).rejects.toMatchObject({
    _tag: 'PiHostError',
    operation: 'sessionContext',
  } satisfies Partial<PiHostError>)
  await shutdown(fake)
})

test('should map session context read failures to PiHostError given a failing context read', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/session-context-read-failure',
    effect: ({ events }) =>
      events.on(
        'session_start',
        () =>
          Effect.gen(function* () {
            const session = yield* PiSessionContext
            yield* session.entry('entry')
            return undefined
          }),
        { failure: 'propagate' },
      ),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))
  const hostContext = createFakeExtensionContext()
  const context = {
    ...hostContext,
    sessionManager: {
      ...hostContext.sessionManager,
      getEntry: () => {
        throw new Error('entry lookup failed')
      },
    },
  } as ExtensionContext

  //when
  const execution = fake.invokeEvent('session_start', { type: 'session_start' }, context)

  //then
  await expect(execution).rejects.toMatchObject({
    _tag: 'PiHostError',
    operation: 'entry',
  } satisfies Partial<PiHostError>)
  await shutdown(fake)
})

test('should keep host services stable given multiple invocation contexts', async () => {
  //given
  let setupMessages: unknown
  const facadeMessages: unknown[] = []
  const eventMessages: unknown[] = []
  const plugin = PiExtension.define({
    id: 'tests/stable-services',
    effect: ({ events }) =>
      Effect.gen(function* () {
        setupMessages = yield* PiMessages
        yield* events.on('session_start', () =>
          Effect.gen(function* () {
            facadeMessages.push((yield* Pi).messages)
            eventMessages.push(yield* PiMessages)
          }).pipe(Effect.as(undefined)),
        )
      }),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))

  //when
  await fake.invokeEvent('session_start', { type: 'session_start' })
  await fake.invokeEvent('session_start', { type: 'session_start' })
  await shutdown(fake)

  //then
  expect(eventMessages).toHaveLength(2)
  expect(eventMessages[0]).toBe(setupMessages)
  expect(eventMessages[1]).toBe(setupMessages)
  expect(facadeMessages[0]).toBe(setupMessages)
  expect(facadeMessages[1]).toBe(setupMessages)
})

test('should model the Pi event bus given Effect operations', async () => {
  //given
  const received: unknown[] = []
  const plugin = PiExtension.define({
    id: 'tests/effect-event-bus',
    effect: ({ events }) =>
      Effect.gen(function* () {
        yield* events.on('session_start', () =>
          Effect.gen(function* () {
            const pi = yield* Pi
            const unsubscribe = yield* pi.events.on('custom', (data) => received.push(data))
            yield* pi.events.emit('custom', { value: 1 })
            yield* unsubscribe
            yield* pi.events.emit('custom', { value: 2 })
          }).pipe(Effect.as(undefined)),
        )
      }),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))

  //when
  await fake.invokeEvent('session_start', { type: 'session_start' })
  await shutdown(fake)

  //then
  expect(received).toEqual([{ value: 1 }])
})

test('should clean up event bus subscriptions given a closed scope', async () => {
  //given
  const received: unknown[] = []
  const plugin = PiExtension.define({
    id: 'tests/scoped-event-bus',
    effect: ({ events }) =>
      events.on('session_start', () =>
        Effect.gen(function* () {
          const pi = yield* Pi
          yield* Effect.scoped(
            Effect.gen(function* () {
              yield* pi.events.onScoped('custom', (data) => received.push(data))
              yield* pi.events.emit('custom', { value: 1 })
            }),
          )
          yield* pi.events.emit('custom', { value: 2 })
        }).pipe(Effect.as(undefined)),
      ),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))

  //when
  await fake.invokeEvent('session_start', { type: 'session_start' })
  await shutdown(fake)

  //then
  expect(received).toEqual([{ value: 1 }])
})

test('should map event bus failures to PiHostError given a failed host operation', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/effect-event-bus-failure',
    effect: ({ events }) =>
      events.on(
        'session_start',
        () =>
          Effect.gen(function* () {
            const pi = yield* Pi
            yield* pi.events.emit('custom', {})
          }).pipe(Effect.as(undefined)),
        { failure: 'propagate' },
      ),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))
  fake.api.events.emit = () => {
    throw new Error('event bus failed')
  }

  //when
  const execution = fake.invokeEvent('session_start', { type: 'session_start' })

  //then
  await expect(execution).rejects.toMatchObject({
    _tag: 'PiHostError',
    operation: 'events.emit',
  } satisfies Partial<PiHostError>)
  await shutdown(fake)
})

test('should return a typed error given an unsupported custom UI operation', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/trust-ui-custom',
    effect: ({ events }) =>
      events.on(
        'project_trust',
        () =>
          Effect.gen(function* () {
            const ui = yield* PiUi
            yield* ui.custom(() => undefined as never)
          }).pipe(Effect.as(undefined)),
        { failure: 'propagate' },
      ),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))
  const trustContext = {
    mode: 'tui',
    hasUI: true,
    cwd: '/workspace',
    ui: {
      select: async () => undefined,
      confirm: async () => false,
      input: async () => undefined,
    },
  } as unknown as ProjectTrustContext

  //when
  const execution = fake.invokeEvent(
    'project_trust',
    { type: 'project_trust' },
    trustContext as unknown as ExtensionContext,
  )

  //then
  await expect(execution).rejects.toBeInstanceOf(PiUiUnavailableError)
  await shutdown(fake)
})

test('should apply neutral and fail-closed policies given configured event policies', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/event-failures',
    effect: (registrations) =>
      Effect.gen(function* () {
        yield* registrations.events.on('input', () =>
          Effect.fail(
            new PiToolError({
              tool: 'input',
              operation: 'test',
              message: 'input failed',
            }),
          ),
        )
        yield* registrations.events.on('tool_call', () =>
          Effect.fail(
            new PiToolError({
              tool: 'tool',
              operation: 'test',
              message: 'tool failed',
            }),
          ),
        )
      }),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))

  //when
  const inputResults = await fake.invokeEvent('input', inputEvent)
  const toolResults = await fake.invokeEvent('tool_call', {
    type: 'tool_call',
    toolCallId: 'call-1',
    toolName: 'custom',
    input: {},
  })
  await shutdown(fake)

  //then
  expect(inputResults).toEqual([{ action: 'continue' }])
  expect(toolResults).toEqual([{ block: true, reason: 'The tool-call handler failed.' }])
})

test('should capture event handler construction failures given a synchronous throw', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/sync-handler-throw',
    effect: ({ events }) =>
      events.on('session_start', () => {
        throw new Error('handler construction failed')
      }),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))

  //when
  const execution = fake.invokeEvent('session_start', { type: 'session_start' })

  //then
  await expect(execution).rejects.toThrow('handler construction failed')
  await shutdown(fake)
})

test('should register boolean and string flags given Pi host overloads', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/flags',
    effect: ({ flags }) =>
      Effect.gen(function* () {
        yield* flags.register('enabled', { type: 'boolean', default: true })
        yield* flags.register('profile', { type: 'string', default: 'default' })
      }),
  })
  const factory = PiExtension.install(plugin)

  //when
  const fake = await installFakePlugin(factory)

  //then
  expect(fake.flags.get('enabled')?.value).toBe(true)
  expect(fake.flags.get('profile')?.value).toBe('default')
  await shutdown(fake)
})

test('should reject malformed flag definitions given package-owned flags', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/invalid-flag',
    effect: ({ flags }) =>
      Effect.gen(function* () {
        // @ts-expect-error The runtime schema must reject this JavaScript input.
        yield* flags.register('broken', { type: 'boolean', default: 'yes' })
      }),
  })

  //when
  const installation = installFakePlugin(PiExtension.install(plugin))

  //then
  await expect(installation).rejects.toBeInstanceOf(PiRegistrationError)
})

test('should provide tool identity, progress updates, and a final result given tool execution', async () => {
  //given
  const updates: unknown[] = []
  const Params = Type.Object({ query: Type.String() })
  const plugin = PiExtension.define({
    id: 'tests/tool',
    effect: (registrations) =>
      registrations.tools.register({
        name: 'test-tool',
        label: 'Test tool',
        description: 'Test tool',
        promptSnippet: 'Use test-tool for tests.',
        promptGuidelines: ['Use test-tool for tests.'],
        parameters: Params,
        executionMode: 'sequential',
        execute: (params) =>
          Effect.gen(function* () {
            const tool = yield* PiToolContext
            yield* tool.onUpdate({ content: [{ type: 'text', text: `working:${params.query}` }] })
            return {
              content: [{ type: 'text' as const, text: `${tool.toolCallId}:${tool.executionMode}` }],
              details: { query: params.query },
            } satisfies PiToolResult<{ query: string }>
          }),
      }),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))

  //when
  const result = await fake.invokeTool('test-tool', 'call-1', { query: 'search' }, undefined, undefined, (update) => {
    updates.push(update)
  })
  await shutdown(fake)

  //then
  expect(result).toEqual({
    content: [{ type: 'text', text: 'call-1:sequential' }],
    details: { query: 'search' },
  })
  expect(updates).toEqual([{ content: [{ type: 'text', text: 'working:search' }] }])
})

test('should return a typed error given unavailable UI capabilities', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/ui-guard',
    effect: (registrations) =>
      registrations.events.on('agent_start', () =>
        Effect.gen(function* () {
          const ui = yield* PiUi
          yield* ui.select('Choose', ['one'])
          return undefined
        }),
      ),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))
  const printContext = {
    ...createFakeExtensionContext(),
    mode: 'print' as const,
    hasUI: false,
  } as ExtensionContext

  //when
  const execution = fake.invokeEvent('agent_start', { type: 'agent_start' }, printContext)

  //then
  await expect(execution).rejects.toBeInstanceOf(PiUiUnavailableError)
  await shutdown(fake)
})

test('should map tools-expanded UI read failures to PiHostError given a failed UI read', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/ui-tools-expanded-failure',
    effect: ({ events }) =>
      events.on(
        'session_start',
        () =>
          Effect.gen(function* () {
            const ui = yield* PiUi
            yield* ui.getToolsExpanded()
          }).pipe(Effect.as(undefined)),
        { failure: 'propagate' },
      ),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))
  const baseContext = createFakeExtensionContext()
  const context = {
    ...baseContext,
    ui: {
      ...baseContext.ui,
      getToolsExpanded: () => {
        throw new Error('tools expanded failed')
      },
    },
  } as ExtensionContext

  //when
  const execution = fake.invokeEvent('session_start', { type: 'session_start' }, context)

  //then
  await expect(execution).rejects.toMatchObject({
    _tag: 'PiHostError',
    operation: 'getToolsExpanded',
  } satisfies Partial<PiHostError>)
  await shutdown(fake)
})

test('should forward Effect cancellation to host promises given AbortSignal support', async () => {
  //given
  const contextController = new AbortController()
  const callController = new AbortController()
  let hostSignal: AbortSignal | undefined
  let hostCancelled = false
  const plugin = PiExtension.define({
    id: 'tests/host-promise-cancellation',
    effect: ({ events }) =>
      events.on(
        'session_start',
        () =>
          Effect.gen(function* () {
            const process = yield* PiProcess
            yield* process.exec('command', [], { signal: callController.signal })
          }).pipe(Effect.as(undefined)),
        { failure: 'propagate' },
      ),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))
  fake.api.exec = (_command, _args, options) =>
    new Promise((resolve) => {
      hostSignal = options?.signal
      if (hostSignal) {
        hostSignal.addEventListener(
          'abort',
          () => {
            hostCancelled = true
            resolve({ stdout: '', stderr: '', code: 0, killed: true })
          },
          { once: true },
        )
      } else {
        resolve({ stdout: '', stderr: '', code: 0, killed: true })
      }
      contextController.abort()
    })
  const context = { ...createFakeExtensionContext(), signal: contextController.signal } as ExtensionContext

  //when
  const execution = fake.invokeEvent('session_start', { type: 'session_start' }, context)

  //then
  await expect(execution).rejects.toBeDefined()
  expect(hostSignal).toBeDefined()
  expect(hostSignal).not.toBe(callController.signal)
  expect(hostSignal?.aborted).toBe(true)
  expect(hostCancelled).toBe(true)
  await shutdown(fake)
})

class ScopedProbe extends Context.Service<ScopedProbe, { readonly value: number }>()('tests/ScopedProbe') {}
class LayerFailure extends Schema.TaggedError<LayerFailure>()('LayerFailure', {}) {}

test('should release the runtime scope given a failed shutdown registration', async () => {
  //given
  let releases = 0
  const plugin = PiExtension.define<ScopedProbe>({
    id: 'tests/shutdown-registration-failure',
    layer: Layer.effect(
      ScopedProbe,
      Effect.acquireRelease(Effect.succeed(ScopedProbe.of({ value: 1 })), () =>
        Effect.sync(() => {
          releases += 1
        }),
      ),
    ),
    effect: () => Effect.succeed(undefined),
  })
  const fake = createFakeExtensionApi()
  fake.api.on = () => {
    throw new Error('session shutdown registration failed')
  }

  //when
  const installation = PiExtension.install(plugin)(fake.api)

  //then
  await expect(installation).rejects.toMatchObject({
    _tag: 'PiRegistrationError',
    registration: 'event:session_shutdown',
  })
  expect(releases).toBe(1)
})

test('should preserve plugin layer construction failures given a failed layer build', async () => {
  //given
  const plugin = PiExtension.define<ScopedProbe, LayerFailure>({
    id: 'tests/layer-failure',
    layer: Layer.effect(ScopedProbe, Effect.fail(new LayerFailure())),
    effect: () => Effect.succeed(undefined),
  })

  //when
  const installation = installFakePlugin(PiExtension.install(plugin))

  //then
  await expect(installation).rejects.toBeInstanceOf(LayerFailure)
})

test('should run command completions and dispose a scoped layer once given repeated shutdown', async () => {
  //given
  let releases = 0
  let replacementCwd = ''
  let systemPromptOptions: unknown
  const plugin = PiExtension.define<ScopedProbe>({
    id: 'tests/lifecycle',
    layer: Layer.effect(
      ScopedProbe,
      Effect.gen(function* () {
        const host = yield* PiHostService
        return yield* Effect.acquireRelease(Effect.succeed(ScopedProbe.of({ value: host.events ? 1 : 0 })), () =>
          Effect.sync(() => {
            releases += 1
          }),
        )
      }),
    ),
    effect: (registrations) =>
      registrations.commands.register('test-command', {
        getArgumentCompletions: () => Effect.succeed([{ value: 'alpha', label: 'alpha' }]),
        handler: () =>
          Effect.gen(function* () {
            const command = yield* PiCommandContext
            systemPromptOptions = yield* command.systemPromptOptions()
            yield* command.newSession({
              setup: (session) =>
                Effect.sync(() => {
                  replacementCwd = session.cwd
                }),
            })
          }),
      }),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))
  const manager = {
    getCwd: () => '/replacement',
    getSessionId: () => 'replacement',
    getSessionFile: () => undefined,
    getSessionDir: () => '/replacement',
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
  const commandContext = {
    ...createFakeExtensionContext(),
    getSystemPromptOptions: () => ({}),
    waitForIdle: async () => undefined,
    newSession: async (options?: { setup?: (session: typeof manager) => Promise<void> }) => {
      if (options?.setup) await options.setup(manager)
      return { cancelled: false }
    },
  } as unknown as ExtensionContext

  //when
  const completions = await fake.invokeCommandCompletions('test-command', 'al')
  await fake.invokeCommand('test-command', '', commandContext)
  await shutdown(fake)
  await shutdown(fake)

  //then
  expect(completions).toEqual([{ value: 'alpha', label: 'alpha' }])
  expect(systemPromptOptions).toEqual({})
  expect(replacementCwd).toBe('/replacement')
  expect(releases).toBe(1)
})

export { ScopedProbe }
