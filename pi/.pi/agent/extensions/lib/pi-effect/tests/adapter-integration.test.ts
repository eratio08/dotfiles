import { expect, test } from 'bun:test'
import type {
  ExecuteToolOptions,
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolContext,
  ProjectTrustContext,
  ToolLoadout,
} from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, Schema } from 'effect'
import { type Static, Type } from 'typebox'
import {
  Pi,
  PiCommandContext,
  PiContext,
  PiExtension,
  PiMessages,
  PiOperations,
  type PiOperationsError,
  PiProcess,
  type PiRegistrationContext,
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
    effect: (registrations: PiRegistrationContext<never>) =>
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

test('should run shutdown handlers in registration order given a shutdown event', async () => {
  //given
  const received: number[] = []
  const plugin = PiExtension.define({
    id: 'tests/session-shutdown-order',
    effect: (registrations: PiRegistrationContext<never>) =>
      Effect.gen(function* () {
        yield* registrations.events.on('session_shutdown', () =>
          Effect.sync(() => {
            received.push(1)
          }),
        )
        yield* registrations.events.on('session_shutdown', () =>
          Effect.sync(() => {
            received.push(2)
          }),
        )
      }),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))

  //when
  await shutdown(fake)

  //then
  expect(received).toEqual([1, 2])
})

test('should accept void effects given a side-effect-only event handler', async () => {
  //given
  let handled = false
  const plugin = PiExtension.define({
    id: 'tests/void-event-result',
    effect: (registrations: PiRegistrationContext<never>) =>
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

test('should map invocation context read failures to PiOperationsError given a failing Pi API read', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/context-read-failure',
    effect: ({ events }: PiRegistrationContext<never>) =>
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
    _tag: 'PiOperationsError',
    operation: 'isIdle',
  } satisfies Partial<PiOperationsError>)
  await shutdown(fake)
})

test('should map command system-prompt option failures to PiOperationsError given a failing option read', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/system-prompt-options-read-failure',
    effect: (registrations: PiRegistrationContext<never>) =>
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
    _tag: 'PiOperationsError',
    operation: 'systemPromptOptions',
  } satisfies Partial<PiOperationsError>)
  await shutdown(fake)
})

test('should map session snapshot failures to PiOperationsError given a failing session read', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/session-snapshot-failure',
    effect: ({ events }: PiRegistrationContext<never>) =>
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
  const extensionContext = createFakeExtensionContext()
  const context = {
    ...extensionContext,
    sessionManager: {
      ...extensionContext.sessionManager,
      getCwd: () => {
        throw new Error('session cwd failed')
      },
    },
  } as ExtensionContext

  //when
  const execution = fake.invokeEvent('session_start', { type: 'session_start' }, context)

  //then
  await expect(execution).rejects.toMatchObject({
    _tag: 'PiOperationsError',
    operation: 'sessionContext',
  } satisfies Partial<PiOperationsError>)
  await shutdown(fake)
})

test('should map session context read failures to PiOperationsError given a failing context read', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/session-context-read-failure',
    effect: ({ events }: PiRegistrationContext<never>) =>
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
  const extensionContext = createFakeExtensionContext()
  const context = {
    ...extensionContext,
    sessionManager: {
      ...extensionContext.sessionManager,
      getEntry: () => {
        throw new Error('entry lookup failed')
      },
    },
  } as ExtensionContext

  //when
  const execution = fake.invokeEvent('session_start', { type: 'session_start' }, context)

  //then
  await expect(execution).rejects.toMatchObject({
    _tag: 'PiOperationsError',
    operation: 'entry',
  } satisfies Partial<PiOperationsError>)
  await shutdown(fake)
})

test('should keep Pi services stable given multiple invocation contexts', async () => {
  //given
  let setupMessages: unknown
  const facadeMessages: unknown[] = []
  const eventMessages: unknown[] = []
  const plugin = PiExtension.define({
    id: 'tests/stable-services',
    effect: ({ events }: PiRegistrationContext<never>) =>
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
    effect: ({ events }: PiRegistrationContext<never>) =>
      Effect.gen(function* () {
        yield* events.on('session_start', () =>
          Effect.gen(function* () {
            const pi = yield* Pi
            const unsubscribe = yield* pi.events.on('custom', (data: unknown) => received.push(data))
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
    effect: ({ events }: PiRegistrationContext<never>) =>
      events.on('session_start', () =>
        Effect.gen(function* () {
          const pi = yield* Pi
          yield* Effect.scoped(
            Effect.gen(function* () {
              yield* pi.events.onScoped('custom', (data: unknown) => received.push(data))
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

test('should map event bus failures to PiOperationsError given a failed Pi API call', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/effect-event-bus-failure',
    effect: ({ events }: PiRegistrationContext<never>) =>
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
  fake.api.events.emit = (): never => {
    throw new Error('event bus failed')
  }

  //when
  const execution = fake.invokeEvent('session_start', { type: 'session_start' })

  //then
  await expect(execution).rejects.toMatchObject({
    _tag: 'PiOperationsError',
    operation: 'events.emit',
  } satisfies Partial<PiOperationsError>)
  await shutdown(fake)
})

test('should return a typed error given an unsupported custom UI operation', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/trust-ui-custom',
    effect: ({ events }: PiRegistrationContext<never>) =>
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
    effect: (registrations: PiRegistrationContext<never>) =>
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
    effect: ({ events }: PiRegistrationContext<never>) =>
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

test('should register boolean and string flags given Pi flag API overloads', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/flags',
    effect: ({ flags }: PiRegistrationContext<never>) =>
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
    effect: ({ flags }: PiRegistrationContext<never>) =>
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
    effect: (registrations: PiRegistrationContext<never>) =>
      registrations.tools.register({
        name: 'test-tool',
        label: 'Test tool',
        description: 'Test tool',
        promptSnippet: 'Use test-tool for tests.',
        promptGuidelines: ['Use test-tool for tests.'],
        parameters: Params,
        executionMode: 'sequential',
        execute: (params: Static<typeof Params>) =>
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
  const result = await fake.invokeTool(
    'test-tool',
    'call-1',
    { query: 'search' },
    undefined,
    undefined,
    (update: unknown) => {
      updates.push(update)
    },
  )
  await shutdown(fake)

  //then
  expect(result).toEqual({
    content: [{ type: 'text', text: 'call-1:sequential' }],
    details: { query: 'search' },
  })
  expect(updates).toEqual([{ content: [{ type: 'text', text: 'working:search' }] }])
})

test('should preserve Pi tool metadata and prepare a model loadout given Effect tool registration', async () => {
  //given
  const namespace = { name: 'docs', description: 'Documentation tools' }
  const annotations = { readOnlyHint: true, openWorldHint: false }
  const loadout = {
    declared: [],
    callable: [],
    registered: [],
    getExposure: () => 'codemode' as const,
    getNamespace: () => namespace,
  }
  const plugin = PiExtension.define({
    id: 'tests/tool-metadata',
    effect: (registrations: PiRegistrationContext<never>) =>
      registrations.tools.register({
        name: 'metadata-tool',
        label: 'Metadata tool',
        description: 'Metadata tool',
        promptSnippet: 'Use metadata-tool for tests.',
        promptGuidelines: ['Use metadata-tool for tests.'],
        parameters: Type.Object({}),
        exposure: 'model-only',
        namespace,
        annotations,
        prepareLoadout: (tools: ToolLoadout) => ({
          descriptions: {
            'metadata-tool': `Use the ${tools.getNamespace('helper')?.name} namespace with ${tools.getExposure('helper')} tools.`,
          },
          hiddenDeclarations: ['helper'],
        }),
        execute: () =>
          Effect.succeed({
            content: [{ type: 'text' as const, text: 'done' }],
            details: {},
          }),
      }),
  })

  //when
  const fake = await installFakePlugin(PiExtension.install(plugin))
  const registered = fake.tools.get('metadata-tool')
  const changes = registered?.prepareLoadout?.(loadout)
  await shutdown(fake)

  //then
  expect(registered).toMatchObject({ exposure: 'model-only', namespace, annotations })
  expect(changes).toEqual({
    descriptions: { 'metadata-tool': 'Use the docs namespace with codemode tools.' },
    hiddenDeclarations: ['helper'],
  })
})

test('should preserve structured and error results given an output schema', async () => {
  //given
  const outputSchema = Type.Object({ answer: Type.String() })
  const plugin = PiExtension.define({
    id: 'tests/tool-structured-result',
    effect: (registrations: PiRegistrationContext<never>) =>
      registrations.tools.register({
        name: 'structured-tool',
        label: 'Structured tool',
        description: 'Structured tool',
        promptSnippet: 'Use structured-tool for tests.',
        promptGuidelines: ['Use structured-tool for tests.'],
        parameters: Type.Object({}),
        outputSchema,
        execute: () =>
          Effect.succeed({
            content: [{ type: 'text' as const, text: 'The lookup failed.' }],
            details: { answer: 'unavailable' },
            structuredContent: { answer: 'unavailable' },
            isError: true,
          } satisfies PiToolResult<{ answer: string }>),
      }),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))

  //when
  const result = await fake.invokeTool('structured-tool', 'call-2', {})
  const registered = fake.tools.get('structured-tool')
  await shutdown(fake)

  //then
  expect(registered?.outputSchema).toBe(outputSchema)
  expect(result).toEqual({
    content: [{ type: 'text', text: 'The lookup failed.' }],
    details: { answer: 'unavailable' },
    structuredContent: { answer: 'unavailable' },
    isError: true,
  })
})

test('should expose callable tools and forward nested execution given a tool context', async () => {
  const callableTool: ExtensionToolContext['tools'][number] = {
    name: 'nested-tool',
    label: 'Nested tool',
    description: 'Nested tool',
    parameters: Type.Object({ query: Type.String() }),
    execute: async () => ({ content: [], details: {} }),
  }
  const nestedSignal = new AbortController().signal
  let nativeCallableTools: ExtensionToolContext['tools'] = [callableTool]
  const nestedOutcome: Awaited<ReturnType<ExtensionToolContext['executeTool']>> = {
    toolCall: {
      type: 'toolCall',
      id: 'parent-call/0',
      name: 'nested-tool',
      arguments: { query: 'answer' },
    },
    result: {
      content: [{ type: 'text', text: 'Nested result' }],
      details: { answer: '42' },
      structuredContent: { answer: '42' },
      isError: true,
    },
    isError: true,
  }
  let callableToolNames: string[] = []
  let callableToolNamesAfterUpdate: string[] = []
  let nestedToolCallId = ''
  let observedNestedOutcome: Awaited<ReturnType<ExtensionToolContext['executeTool']>> | undefined
  let nestedCallName = ''
  let nestedCallArgs: unknown
  let nestedCallSignal: AbortSignal | undefined
  let receivedProgressCallback = false
  let nestedCallCount = 0
  const progressUpdates: unknown[] = []
  const nativeContext: ExtensionToolContext = {
    ...createFakeExtensionContext(),
    get tools(): ExtensionToolContext['tools'] {
      return nativeCallableTools
    },
    executeTool: async (name: string, args: unknown, options?: ExecuteToolOptions) => {
      nestedCallCount += 1
      if (nestedCallCount > 1) throw new Error('nested invocation failed')
      nestedCallName = name
      nestedCallArgs = args
      nestedCallSignal = options?.signal
      receivedProgressCallback = options?.onUpdate !== undefined
      options?.onUpdate?.({ content: [{ type: 'text', text: 'Nested progress' }], details: {} })
      return nestedOutcome
    },
  }
  const plugin = PiExtension.define({
    id: 'tests/nested-tool',
    effect: (registrations: PiRegistrationContext<never>) =>
      registrations.tools.register({
        name: 'parent-tool',
        label: 'Parent tool',
        description: 'Parent tool',
        promptSnippet: 'Use parent-tool for tests.',
        promptGuidelines: ['Use parent-tool for tests.'],
        parameters: Type.Object({}),
        execute: () =>
          Effect.gen(function* () {
            const tool = yield* PiToolContext
            callableToolNames = tool.tools.map(({ name }) => name)
            nativeCallableTools = []
            callableToolNamesAfterUpdate = tool.tools.map(({ name }) => name)
            nativeCallableTools = [callableTool]
            const outcome = yield* tool.executeTool(
              'nested-tool',
              { query: 'answer' },
              {
                signal: nestedSignal,
                onUpdate: (update: Parameters<NonNullable<ExecuteToolOptions['onUpdate']>>[0]) =>
                  progressUpdates.push(update),
              },
            )
            nestedToolCallId = outcome.toolCall.id
            observedNestedOutcome = outcome
            return {
              content: outcome.result.content,
              details: outcome.result.details,
              structuredContent: outcome.result.structuredContent,
              isError: outcome.isError,
            } satisfies PiToolResult<unknown>
          }),
      }),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))

  const result = await fake.invokeTool('parent-tool', 'parent-call', {}, nativeContext)
  const failedInvocation = fake.invokeTool('parent-tool', 'parent-call-2', {}, nativeContext)
  await expect(failedInvocation).rejects.toMatchObject({
    _tag: 'PiToolError',
    tool: 'nested-tool',
    operation: 'executeTool',
    message: 'nested invocation failed',
  })
  await shutdown(fake)

  expect(callableToolNames).toEqual(['nested-tool'])
  expect(callableToolNamesAfterUpdate).toEqual([])
  expect(nestedToolCallId).toBe('parent-call/0')
  expect(observedNestedOutcome).toBe(nestedOutcome)
  expect(nestedCallName).toBe('nested-tool')
  expect(nestedCallArgs).toEqual({ query: 'answer' })
  expect(nestedCallSignal).toBe(nestedSignal)
  expect(receivedProgressCallback).toBe(true)
  expect(progressUpdates).toEqual([{ content: [{ type: 'text', text: 'Nested progress' }], details: {} }])
  expect(result).toEqual({
    content: [{ type: 'text', text: 'Nested result' }],
    details: { answer: '42' },
    structuredContent: { answer: '42' },
    isError: true,
  })
})

test('should return a typed error given unavailable UI capabilities', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/ui-guard',
    effect: (registrations: PiRegistrationContext<never>) =>
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

test('should map tools-expanded UI read failures to PiOperationsError given a failed UI read', async () => {
  //given
  const plugin = PiExtension.define({
    id: 'tests/ui-tools-expanded-failure',
    effect: ({ events }: PiRegistrationContext<never>) =>
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
    _tag: 'PiOperationsError',
    operation: 'getToolsExpanded',
  } satisfies Partial<PiOperationsError>)
  await shutdown(fake)
})

test('should forward Effect cancellation to Pi API promises given AbortSignal support', async () => {
  //given
  const contextController = new AbortController()
  const callController = new AbortController()
  let piSignal: AbortSignal | undefined
  let piCancelled = false
  const plugin = PiExtension.define({
    id: 'tests/pi-promise-cancellation',
    effect: ({ events }: PiRegistrationContext<never>) =>
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
  fake.api.exec = (
    _command: Parameters<ExtensionAPI['exec']>[0],
    _args: Parameters<ExtensionAPI['exec']>[1],
    options: Parameters<ExtensionAPI['exec']>[2],
  ): ReturnType<ExtensionAPI['exec']> =>
    new Promise<Awaited<ReturnType<ExtensionAPI['exec']>>>((resolve): void => {
      piSignal = options?.signal
      if (piSignal) {
        piSignal.addEventListener(
          'abort',
          () => {
            piCancelled = true
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
  expect(piSignal).toBeDefined()
  expect(piSignal).not.toBe(callController.signal)
  expect(piSignal?.aborted).toBe(true)
  expect(piCancelled).toBe(true)
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
    effect: (): Effect.Effect<void> => Effect.succeed(undefined),
  })
  const fake = createFakeExtensionApi()
  fake.api.on = (): never => {
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
    effect: (): Effect.Effect<void> => Effect.succeed(undefined),
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
        const operations = yield* PiOperations
        return yield* Effect.acquireRelease(Effect.succeed(ScopedProbe.of({ value: operations.events ? 1 : 0 })), () =>
          Effect.sync(() => {
            releases += 1
          }),
        )
      }),
    ),
    effect: (registrations: PiRegistrationContext<ScopedProbe>) =>
      registrations.commands.register('test-command', {
        getArgumentCompletions: () => Effect.succeed([{ value: 'alpha', label: 'alpha' }]),
        handler: () =>
          Effect.gen(function* () {
            const command = yield* PiCommandContext
            systemPromptOptions = yield* command.systemPromptOptions()
            yield* command.newSession({
              setup: (session: PiSessionContext) =>
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
