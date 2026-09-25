import assert from 'node:assert/strict'
import test from 'node:test'
import { createWebSearchTool } from '../index.ts'
import {
  hasWebSearchCredentials,
  parseSearchResponse,
  selectProvider,
  previewLines as webSearchPreviewLines,
} from '../src/core/websearch.ts'

test('should gate websearch registration on credentials given provider configuration', () => {
  assert.equal(hasWebSearchCredentials({} as NodeJS.ProcessEnv), false)
  assert.equal(hasWebSearchCredentials({ EXA_API_KEY: 'x' } as NodeJS.ProcessEnv), true)
  assert.equal(hasWebSearchCredentials({ PARALLEL_API_KEY: 'x' } as NodeJS.ProcessEnv), true)
  assert.equal(hasWebSearchCredentials({ EXA_API_KEY: '   ' } as NodeJS.ProcessEnv), false)
})

test('should select the configured provider given provider settings', () => {
  assert.equal(selectProvider({ PI_WEBSEARCH_PROVIDER: 'parallel' } as NodeJS.ProcessEnv), 'parallel')
  assert.equal(selectProvider({ EXA_API_KEY: 'x' } as NodeJS.ProcessEnv), 'exa')
  assert.equal(selectProvider({ PARALLEL_API_KEY: 'x' } as NodeJS.ProcessEnv), 'parallel')
  assert.equal(selectProvider({} as NodeJS.ProcessEnv), 'exa')
})

test('should parse direct JSON and SSE responses given provider payloads', () => {
  const direct = JSON.stringify({ result: { content: [{ type: 'text', text: 'direct hit' }] } })
  const sse = [
    'event: message',
    `data: ${JSON.stringify({ result: { content: [{ type: 'text', text: 'sse hit' }] } })}`,
  ].join('\n')
  assert.equal(parseSearchResponse(direct), 'direct hit')
  assert.equal(parseSearchResponse(sse), 'sse hit')
  assert.equal(parseSearchResponse('data: not-json'), undefined)
})

test('should trim blank preview lines and truncate long lines given preview text', () => {
  assert.deepEqual(webSearchPreviewLines('\n alpha \n\nbeta\ngamma\ndelta', 2, 20), ['alpha', 'beta'])
  assert.deepEqual(webSearchPreviewLines('abcdefghijklmnopqrstuvwxyz', 3, 8), ['abcdefg…'])
})

test('should preserve provider fallback and tool schema given a selected provider', () => {
  //given
  const webSearchTool = createWebSearchTool(async () => {
    throw new Error('test runner must not execute the websearch workflow')
  })
  const parameters = webSearchTool.parameters as {
    required: string[]
    properties: Record<string, { enum?: string[]; description?: string }>
  }

  //when
  const schema = {
    name: webSearchTool.name,
    required: parameters.required,
    livecrawl: parameters.properties.livecrawl.enum,
    type: parameters.properties.type.enum,
    contextDescription: parameters.properties.contextMaxCharacters.description,
  }

  //then
  assert.deepEqual(schema, {
    name: 'websearch',
    required: ['query'],
    livecrawl: ['fallback', 'preferred'],
    type: ['auto', 'fast', 'deep'],
    contextDescription: 'Maximum model context characters. Default 10000, max 50000',
  })
  assert.equal(selectProvider({ PI_WEBSEARCH_PROVIDER: 'parallel' } as NodeJS.ProcessEnv), 'parallel')
  assert.equal(selectProvider({ PI_WEBSEARCH_PROVIDER: 'exa' } as NodeJS.ProcessEnv), 'exa')
  assert.equal(selectProvider({ PI_WEBSEARCH_PROVIDER: 'parallel', EXA_API_KEY: 'x' } as NodeJS.ProcessEnv), 'parallel')
  assert.equal(selectProvider({ PI_WEBSEARCH_PROVIDER: 'exa', PARALLEL_API_KEY: 'x' } as NodeJS.ProcessEnv), 'exa')
})
