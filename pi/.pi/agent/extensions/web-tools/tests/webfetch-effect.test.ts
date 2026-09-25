import assert from 'node:assert/strict'
import test from 'node:test'
import { Effect, Layer } from 'effect'
import { acceptHeaderForFormat, MAX_RESPONSE_BYTES } from '../src/core/webfetch.ts'
import { createWebToolsHttpTestLayer, type WebToolsFetch, type WebToolsHttp } from '../src/effects/services/http.ts'
import {
  createWebToolsTemporaryOutputTestLayer,
  type TemporaryOutputWrite,
  WebToolsFilesystemError,
  WebToolsTemporaryOutput,
} from '../src/effects/services/temporary-output.ts'
import {
  runWebFetch,
  WebFetchResponseTooLargeError,
  WebFetchStatusError,
  WebFetchUnsupportedContentError,
  WebFetchValidationError,
} from '../src/effects/webfetch.ts'

function webFetchLayer(
  fetchImplementation: WebToolsFetch,
  writes: TemporaryOutputWrite[],
  observeRequest?: (url: string, init: RequestInit, timeoutMs: number) => void,
): Layer.Layer<WebToolsHttp | WebToolsTemporaryOutput> {
  return Layer.mergeAll(
    createWebToolsHttpTestLayer(fetchImplementation, observeRequest),
    createWebToolsTemporaryOutputTestLayer(writes, '/tmp/webfetch-effect-test'),
  )
}

test('should preserve request headers, conversion, and details given a webfetch response', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  let request: { url: string; headers: Headers; timeoutMs: number } | undefined
  const fetchImplementation: WebToolsFetch = async () =>
    new Response('<h1>Hello</h1><p>World</p>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })

  //when
  const result = await Effect.runPromise(
    Effect.provide(
      runWebFetch({ url: 'https://example.com/page', format: 'text', timeout: 30 }),
      webFetchLayer(fetchImplementation, writes, (url, init, timeoutMs) => {
        request = { url, headers: new Headers(init.headers), timeoutMs }
      }),
    ),
  )

  //then
  assert.equal(result.content[0].text, 'Hello\nWorld')
  assert.deepEqual(result.details, {
    url: 'https://example.com/page',
    host: 'example.com',
    contentType: 'text/html; charset=utf-8',
    mime: 'text/html',
    format: 'text',
    lineCount: 2,
    preview: ['Hello', 'World'],
    truncated: false,
    fullOutputPath: undefined,
  })
  assert.equal(request?.url, 'https://example.com/page')
  assert.equal(request?.headers.get('User-Agent')?.includes('Chrome/143'), true)
  assert.equal(request?.headers.get('Accept'), acceptHeaderForFormat('text'))
  assert.equal(request?.headers.get('Accept-Language'), 'en-US,en;q=0.9')
  assert.equal(request?.timeoutMs, 30000)
  assert.deepEqual(writes, [])
})

test('should validate the URL given a webfetch workflow', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  let requestCount = 0
  const fetchImplementation: WebToolsFetch = async () => {
    requestCount += 1
    return new Response('unexpected')
  }

  //when
  const error = await Effect.runPromise(
    Effect.provide(
      runWebFetch({ url: 'http://localhost', format: 'text' }),
      webFetchLayer(fetchImplementation, writes),
    ),
  ).then(
    () => undefined,
    (cause) => cause,
  )

  //then
  assert.ok(error instanceof WebFetchValidationError)
  assert.equal(requestCount, 0)
})

test('should preserve response errors given a non-success status', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  const fetchImplementation: WebToolsFetch = async () =>
    new Response('failure', { status: 503, statusText: 'Service Unavailable' })

  //when
  const error = await Effect.runPromise(
    Effect.provide(runWebFetch({ url: 'https://example.com/status' }), webFetchLayer(fetchImplementation, writes)),
  ).then(
    () => undefined,
    (cause) => cause,
  )

  //then
  assert.ok(error instanceof WebFetchStatusError)
  assert.equal(error.message, 'Unable to fetch https://example.com/status: HTTP 503 Service Unavailable')
})

test('should redact credentials from status errors given a credentialed URL', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  const fetchImplementation: WebToolsFetch = async () =>
    new Response('failure', { status: 500, statusText: 'Server Error' })

  //when
  const error = await Effect.runPromise(
    Effect.provide(
      runWebFetch({ url: 'https://example.com/status?token=secret' }),
      webFetchLayer(fetchImplementation, writes),
    ),
  ).then(
    () => undefined,
    (cause) => cause,
  )

  //then
  assert.ok(error instanceof WebFetchStatusError)
  assert.doesNotMatch(error.url, /secret/)
  assert.doesNotMatch(error.message, /secret/)
})

test('should reject image content given an image response', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  const fetchImplementation: WebToolsFetch = async () =>
    new Response('image bytes', { headers: { 'content-type': 'image/png' } })

  //when
  const error = await Effect.runPromise(
    Effect.provide(runWebFetch({ url: 'https://example.com/image' }), webFetchLayer(fetchImplementation, writes)),
  ).then(
    () => undefined,
    (cause) => cause,
  )

  //then
  assert.ok(error instanceof WebFetchUnsupportedContentError)
  assert.equal(error.message, 'Unsupported fetched image content type: image/png')
})

test('should reject non-text content given a non-text response', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  const fetchImplementation: WebToolsFetch = async () =>
    new Response('binary bytes', { headers: { 'content-type': 'application/octet-stream' } })

  //when
  const error = await Effect.runPromise(
    Effect.provide(runWebFetch({ url: 'https://example.com/file' }), webFetchLayer(fetchImplementation, writes)),
  ).then(
    () => undefined,
    (cause) => cause,
  )

  //then
  assert.ok(error instanceof WebFetchUnsupportedContentError)
  assert.equal(error.message, 'Unsupported fetched file content type: application/octet-stream')
})

test('should map an oversized raw response given a body over the size limit', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  const fetchImplementation: WebToolsFetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller: ReadableStreamDefaultController<Uint8Array<ArrayBufferLike>>): void {
          controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES + 1))
        },
      }),
      { headers: { 'content-type': 'text/plain' } },
    )

  //when
  const error = await Effect.runPromise(
    Effect.provide(runWebFetch({ url: 'https://example.com/large' }), webFetchLayer(fetchImplementation, writes)),
  ).then(
    () => undefined,
    (cause) => cause,
  )

  //then
  assert.ok(error instanceof WebFetchResponseTooLargeError)
  assert.equal(error.message, 'Response too large (exceeds 5.0MB)')
})

test('should map temporary output failures given a failed write', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  const fullOutput = Array.from({ length: 2001 }, (_, index) => `line ${index + 1}`).join('\n')
  const fetchImplementation: WebToolsFetch = async () =>
    new Response(fullOutput, { headers: { 'content-type': 'text/plain' } })
  const outputLayer = Layer.succeed(
    WebToolsTemporaryOutput,
    WebToolsTemporaryOutput.of({
      writeOutput: () =>
        Effect.fail(
          new WebToolsFilesystemError({
            operation: 'writeFile',
            path: '/tmp/output.txt',
            message: 'disk full',
          }),
        ),
    }),
  )

  //when
  const error = await Effect.runPromise(
    Effect.provide(
      runWebFetch({ url: 'https://example.com/output-error', format: 'text' }),
      Layer.mergeAll(createWebToolsHttpTestLayer(fetchImplementation), outputLayer),
    ),
  ).then(
    () => undefined,
    (cause) => cause,
  )

  //then
  assert.ok(error instanceof WebToolsFilesystemError)
  assert.equal(error.message, 'disk full')
  assert.deepEqual(writes, [])
})

test('should spill complete output given a response that requires truncation', async () => {
  //given
  const writes: TemporaryOutputWrite[] = []
  const fullOutput = Array.from({ length: 2001 }, (_, index) => `line ${index + 1}`).join('\n')
  const fetchImplementation: WebToolsFetch = async () =>
    new Response(fullOutput, { headers: { 'content-type': 'text/plain' } })

  //when
  const result = await Effect.runPromise(
    Effect.provide(
      runWebFetch({ url: 'https://example.com/large-text', format: 'text' }),
      webFetchLayer(fetchImplementation, writes),
    ),
  )

  //then
  assert.equal(result.details.truncated, true)
  assert.match(result.content[0].text, /Output truncated/)
  assert.equal(writes.length, 1)
  assert.equal(writes[0]?.content, fullOutput)
  assert.match(writes[0]?.prefix ?? '', /^pi-webfetch-[0-9a-f]{8}$/)
  assert.match(writes[0]?.path ?? '', /\/pi-webfetch-[0-9a-f]{8}-0\/output\.txt$/)
})
