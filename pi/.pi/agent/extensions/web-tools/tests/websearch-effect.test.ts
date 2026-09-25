import assert from 'node:assert/strict'
import test from 'node:test'
import { Effect, Layer } from 'effect'
import { NO_RESULTS } from '../src/core/websearch.ts'
import { createWebToolsHttpTestLayer, type WebToolsFetch, type WebToolsHttp } from '../src/effects/services/http.ts'
import {
  createWebToolsTemporaryOutputTestLayer,
  type TemporaryOutputWrite,
  type WebToolsTemporaryOutput,
} from '../src/effects/services/temporary-output.ts'
import { WebSearchConfig, type WebSearchEnvironment } from '../src/effects/services/websearch-config.ts'
import { runWebSearch, WebSearchParseError, WebSearchResponseError } from '../src/effects/websearch.ts'

interface JsonRpcBody {
  params: {
    name: string
    arguments: Record<string, unknown>
  }
}

function webSearchLayer(
  fetchImplementation: WebToolsFetch,
  writes: TemporaryOutputWrite[],
  environment: WebSearchEnvironment,
  observeRequest?: (url: string, init: RequestInit, timeoutMs: number) => void,
): Layer.Layer<WebToolsHttp | WebToolsTemporaryOutput | WebSearchConfig> {
  return Layer.mergeAll(
    createWebToolsHttpTestLayer(fetchImplementation, observeRequest),
    createWebToolsTemporaryOutputTestLayer(writes, '/tmp/websearch-effect-test'),
    Layer.succeed(WebSearchConfig, WebSearchConfig.of(environment)),
  )
}

test('should preserve Exa request options and parse direct JSON given an Exa response', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  let request: { url: string; headers: Headers; body: JsonRpcBody; timeoutMs: number } | undefined
  const fetchImplementation: WebToolsFetch = async () =>
    new Response(JSON.stringify({ result: { content: [{ type: 'text', text: 'Exa result' }] } }), {
      headers: { 'content-type': 'application/json' },
    })

  //when
  const result = await Effect.runPromise(
    Effect.provide(
      runWebSearch(
        {
          query: 'effect migration',
          numResults: 99,
          livecrawl: 'preferred',
          type: 'deep',
          contextMaxCharacters: 99999,
        },
        'call-1',
        null,
      ),
      webSearchLayer(fetchImplementation, writes, { EXA_API_KEY: 'exa-secret' }, (url, init, timeoutMs) => {
        request = {
          url,
          headers: new Headers(init.headers),
          body: JSON.parse(String(init.body)) as JsonRpcBody,
          timeoutMs,
        }
      }),
    ),
  )

  //then
  assert.equal(result.content[0].text, 'Exa result')
  assert.equal(result.details.provider, 'exa')
  assert.equal(request?.url, 'https://mcp.exa.ai/mcp?exaApiKey=exa-secret')
  assert.equal(request?.headers.get('Authorization'), null)
  assert.equal(request?.timeoutMs, 25000)
  assert.deepEqual(request?.body, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'web_search_exa',
      arguments: {
        query: 'effect migration',
        type: 'deep',
        numResults: 20,
        livecrawl: 'preferred',
        contextMaxCharacters: 50000,
      },
    },
  })
  assert.deepEqual(writes, [])
})

test('should preserve Parallel provider selection and session fallback given provider settings', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  let request: { url: string; headers: Headers; body: JsonRpcBody } | undefined
  const fetchImplementation: WebToolsFetch = async () =>
    new Response('event: message\ndata: {"result":{"content":[{"type":"text","text":"Parallel result"}]}}')

  //when
  const result = await Effect.runPromise(
    Effect.provide(
      runWebSearch({ query: 'parallel search' }, 'tool-call-id', null),
      webSearchLayer(
        fetchImplementation,
        writes,
        { PI_WEBSEARCH_PROVIDER: 'parallel', PARALLEL_API_KEY: 'parallel-secret' },
        (url, init) => {
          request = { url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) as JsonRpcBody }
        },
      ),
    ),
  )

  //then
  assert.equal(result.content[0].text, 'Parallel result')
  assert.equal(result.details.provider, 'parallel')
  assert.equal(request?.url, 'https://search.parallel.ai/mcp')
  assert.equal(request?.headers.get('Authorization'), 'Bearer parallel-secret')
  assert.equal(request?.body.params.name, 'web_search')
  assert.equal(request?.body.params.arguments.session_id, 'tool-call-id')
})

test('should keep an explicit provider given missing credentials', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  let requestUrl = ''
  const fetchImplementation: WebToolsFetch = async () =>
    new Response(JSON.stringify({ result: { content: [{ type: 'text', text: 'fallback provider' }] } }))

  //when
  const result = await Effect.runPromise(
    Effect.provide(
      runWebSearch({ query: 'fallback' }, 'call-2', 'session-file'),
      webSearchLayer(fetchImplementation, writes, { PI_WEBSEARCH_PROVIDER: 'parallel' }, (url) => {
        requestUrl = url
      }),
    ),
  )

  //then
  assert.equal(result.details.provider, 'parallel')
  assert.equal(result.content[0].text, 'fallback provider')
  assert.equal(requestUrl, 'https://search.parallel.ai/mcp')
})

test('should map invalid search response data given a malformed response', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  const fetchImplementation: WebToolsFetch = async () => new Response('{invalid json')

  //when
  const error = await Effect.runPromise(
    Effect.provide(
      runWebSearch({ query: 'invalid' }, 'call-invalid', null),
      webSearchLayer(fetchImplementation, writes, { EXA_API_KEY: 'key' }),
    ),
  ).then(
    () => undefined,
    (cause) => cause,
  )

  //then
  assert.ok(error instanceof WebSearchParseError)
  assert.match(error.message, /JSON|Unexpected token/)
})

test('should read a full response body without the webfetch limit given a search response', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  const fullOutput = 'x'.repeat(5 * 1024 * 1024 + 1)
  const fetchImplementation: WebToolsFetch = async () =>
    new Response(JSON.stringify({ result: { content: [{ type: 'text', text: fullOutput }] } }))

  //when
  const result = await Effect.runPromise(
    Effect.provide(
      runWebSearch({ query: 'large search result' }, 'call-large', null),
      webSearchLayer(fetchImplementation, writes, { EXA_API_KEY: 'key' }),
    ),
  )

  //then
  assert.equal(result.details.truncated, true)
  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.content, fullOutput)
})

test('should return the existing no-results text given an empty search result', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  const fetchImplementation: WebToolsFetch = async () => new Response(JSON.stringify({ result: { content: [] } }))

  //when
  const result = await Effect.runPromise(
    Effect.provide(
      runWebSearch({ query: 'nothing' }, 'call-3', null),
      webSearchLayer(fetchImplementation, writes, { EXA_API_KEY: 'key' }),
    ),
  )

  //then
  assert.equal(result.content[0].text, NO_RESULTS)
  assert.equal(result.details.lineCount, 1)
})

test('should preserve provider response errors given a failed provider request', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  const fetchImplementation: WebToolsFetch = async () =>
    new Response('failure', { status: 429, statusText: 'Too Many Requests' })

  //when
  const error = await Effect.runPromise(
    Effect.provide(
      runWebSearch({ query: 'rate limit' }, 'call-4', null),
      webSearchLayer(fetchImplementation, writes, { EXA_API_KEY: 'key' }),
    ),
  ).then(
    () => undefined,
    (cause) => cause,
  )

  //then
  assert.ok(error instanceof WebSearchResponseError)
  assert.equal(error.message, 'web_search_exa failed: HTTP 429 Too Many Requests')
})

test('should spill complete output given truncated search results', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  const fullOutput = Array.from({ length: 2001 }, (_, index) => `result ${index + 1}`).join('\n')
  const fetchImplementation: WebToolsFetch = async () =>
    new Response(JSON.stringify({ result: { content: [{ type: 'text', text: fullOutput }] } }))

  //when
  const result = await Effect.runPromise(
    Effect.provide(
      runWebSearch({ query: 'many results' }, 'call-5', null),
      webSearchLayer(fetchImplementation, writes, { EXA_API_KEY: 'key' }),
    ),
  )

  //then
  assert.equal(result.details.truncated, true)
  assert.match(result.content[0].text, /Output truncated/)
  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.content, fullOutput)
  assert.match(writes[0]?.prefix ?? '', /^pi-websearch-[0-9a-f]{8}$/)
  assert.match(writes[0]?.path ?? '', /\/pi-websearch-[0-9a-f]{8}-0\/output\.txt$/)
})
