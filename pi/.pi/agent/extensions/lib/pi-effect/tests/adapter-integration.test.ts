import { expect, test } from 'bun:test'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, Schema } from 'effect'
import { Type } from 'typebox'
import {
  PiCommandContext,
  PiContext,
  PiExtension,
  PiHost,
  PiMessages,
  PiRegistrationError,
  PiToolContext,
  PiToolError,
  type PiToolResult,
  PiUi,
  PiUiUnavailableError,
} from '../src/index.ts'
import { createFakeExtensionContext, installFakePlugin } from '../src/testing/fake.ts'

const inputEvent = {
  type: 'input' as const,
  text: 'hello',
  source: 'interactive' as const,
}

async function shutdown(fake: Awaited<ReturnType<typeof installFakePlugin>>): Promise<void> {
  await fake.invokeEvent('session_shutdown', { type: 'session_shutdown', reason: 'quit' })
}

test('preserves event results and provides the current invocation context', async () => {
  //given
  let cwd = ''
  const plugin = PiExtension.define({
    id: 'tests/event-result',
    effect: (registrations) =>
      registrations.events.on('input', (event) =>
        Effect.gen(function* () {
          cwd = (yield* PiContext).cwd
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
})

test('keeps stable host services across invocation contexts', async () => {
  //given
  let setupMessages: unknown
  const eventMessages: unknown[] = []
  const plugin = PiExtension.define({
    id: 'tests/stable-services',
    effect: ({ events }) =>
      Effect.gen(function* () {
        setupMessages = yield* PiMessages
        yield* events.on('session_start', () =>
          Effect.gen(function* () {
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
})

test('applies neutral and fail-closed event policies', async () => {
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

test('captures synchronous event handler construction failures', async () => {
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

test('registers boolean and string flags through the Pi host overloads', async () => {
  const plugin = PiExtension.define({
    id: 'tests/flags',
    effect: ({ flags }) =>
      Effect.gen(function* () {
        yield* flags.register('enabled', { type: 'boolean', default: true })
        yield* flags.register('profile', { type: 'string', default: 'default' })
      }),
  })
  const fake = await installFakePlugin(PiExtension.install(plugin))

  expect(fake.flags.get('enabled')?.value).toBe(true)
  expect(fake.flags.get('profile')?.value).toBe('default')
  await shutdown(fake)
})

test('rejects malformed package-owned flag definitions', async () => {
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

test('provides tool identity, progress updates, and the final result', async () => {
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

test('returns a typed error for unavailable UI capabilities', async () => {
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

class ScopedProbe extends Context.Service<ScopedProbe, { readonly value: number }>()('tests/ScopedProbe') {}
class LayerFailure extends Schema.TaggedError<LayerFailure>()('LayerFailure', {}) {}

test('preserves plugin layer construction failures', async () => {
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

test('runs command completions and disposes a scoped layer once across repeated shutdown', async () => {
  //given
  let releases = 0
  let replacementCwd = ''
  const plugin = PiExtension.define<ScopedProbe>({
    id: 'tests/lifecycle',
    layer: Layer.effect(
      ScopedProbe,
      Effect.gen(function* () {
        const host = yield* PiHost
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
  expect(replacementCwd).toBe('/replacement')
  expect(releases).toBe(1)
})

export { ScopedProbe }
