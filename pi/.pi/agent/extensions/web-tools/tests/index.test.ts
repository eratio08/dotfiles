import assert from 'node:assert/strict'
import test from 'node:test'
import webToolsExtension from '../index.ts'

type RegisteredTool = { name: string }

type ExtensionHandler = (event: unknown) => unknown

type TestExtensionApi = {
  tools: RegisteredTool[]
  handlers: Map<string, ExtensionHandler[]>
  registerTool(tool: RegisteredTool): void
  on(event: string, handler: ExtensionHandler): void
}

function createTestExtensionApi(): TestExtensionApi {
  const api: TestExtensionApi = {
    tools: [],
    handlers: new Map(),
    registerTool(tool: RegisteredTool): void {
      api.tools.push(tool)
    },
    on(event: string, handler: ExtensionHandler): void {
      const handlers = api.handlers.get(event) ?? []
      handlers.push(handler)
      api.handlers.set(event, handlers)
    },
  }
  return api
}

function withEnvironment(values: Record<string, string | undefined>, action: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  return action().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

test('should register the same tools under one credential gate given extension setup', async () => {
  //given
  await withEnvironment(
    { EXA_API_KEY: undefined, PARALLEL_API_KEY: undefined, PI_WEBSEARCH_PROVIDER: undefined },
    async () => {
      const api = createTestExtensionApi()

      //when
      await webToolsExtension(api as never)

      //then
      assert.deepEqual(
        api.tools.map((tool) => tool.name),
        ['webfetch'],
      )
      await api.handlers.get('session_shutdown')?.[0]?.(undefined)
      await api.handlers.get('session_shutdown')?.[0]?.(undefined)
    },
  )
  await withEnvironment(
    { EXA_API_KEY: 'exa-key', PARALLEL_API_KEY: undefined, PI_WEBSEARCH_PROVIDER: undefined },
    async () => {
      const api = createTestExtensionApi()
      await webToolsExtension(api as never)
      assert.deepEqual(
        api.tools.map((tool) => tool.name),
        ['webfetch', 'websearch'],
      )
      await api.handlers.get('session_shutdown')?.[0]?.(undefined)
    },
  )
})

test('should preserve webfetch tool-call URL messages given a tool call', async () => {
  //given
  await withEnvironment(
    { EXA_API_KEY: undefined, PARALLEL_API_KEY: undefined, PI_WEBSEARCH_PROVIDER: undefined },
    async () => {
      const api = createTestExtensionApi()
      await webToolsExtension(api as never)
      const toolCall = api.handlers.get('tool_call')?.[0]
      assert.ok(toolCall)

      //when
      const nonString = await toolCall({ toolName: 'webfetch', input: {} })
      const invalid = await toolCall({ toolName: 'webfetch', input: { url: 'ftp://example.com' } })
      const local = await toolCall({ toolName: 'webfetch', input: { url: 'http://localhost' } })

      //then
      assert.deepEqual(nonString, { block: true, reason: 'webfetch requires a string url' })
      assert.deepEqual(invalid, { block: true, reason: 'URL must use http:// or https://' })
      assert.deepEqual(local, { block: true, reason: 'Blocked private or localhost target: localhost' })
      await api.handlers.get('session_shutdown')?.[0]?.(undefined)
    },
  )
})
