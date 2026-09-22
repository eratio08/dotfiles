import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import webToolsExtension from '../index.ts'

interface RegisteredTool {
  name: string
}

type ExtensionHandler = (event: unknown) => unknown

interface TestExtensionApi {
  tools: RegisteredTool[]
  handlers: Map<string, ExtensionHandler[]>
  registerTool(tool: RegisteredTool): void
  on(event: string, handler: ExtensionHandler): void
}

function createTestExtensionApi(): TestExtensionApi {
  const api: TestExtensionApi = {
    tools: [],
    handlers: new Map(),
    registerTool(tool) {
      api.tools.push(tool)
    },
    on(event, handler) {
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

test('extension registers the same tools under the same credential gate', async () => {
  //given
  await withEnvironment(
    { EXA_API_KEY: undefined, PARALLEL_API_KEY: undefined, PI_WEBSEARCH_PROVIDER: undefined },
    async () => {
      const api = createTestExtensionApi()

      //when
      webToolsExtension(api as unknown as ExtensionAPI)

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
      webToolsExtension(api as unknown as ExtensionAPI)
      assert.deepEqual(
        api.tools.map((tool) => tool.name),
        ['webfetch', 'websearch'],
      )
      await api.handlers.get('session_shutdown')?.[0]?.(undefined)
    },
  )
})

test('extension keeps the webfetch tool-call URL messages', async () => {
  //given
  await withEnvironment(
    { EXA_API_KEY: undefined, PARALLEL_API_KEY: undefined, PI_WEBSEARCH_PROVIDER: undefined },
    async () => {
      const api = createTestExtensionApi()
      webToolsExtension(api as unknown as ExtensionAPI)
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
