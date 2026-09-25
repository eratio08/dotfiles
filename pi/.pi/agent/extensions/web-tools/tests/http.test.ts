import assert from 'node:assert/strict'
import test from 'node:test'
import { ManagedRuntime } from 'effect'
import {
  createWebToolsHttpTestLayer,
  type WebToolsFetch,
  WebToolsHttp,
  WebToolsHttpRequestError,
  WebToolsHttpResponseBodyError,
  WebToolsHttpResponseTooLargeError,
  WebToolsHttpTimeoutError,
} from '../src/effects/services/http.ts'

test('should forward request data and return native response data given an HTTP request', async () => {
  //given
  const calls: Array<{ url: string; method: string; headers: Headers; body: string; timeoutMs: number }> = []
  const fetchImplementation: WebToolsFetch = async () =>
    new Response('ok', { status: 201, statusText: 'Created', headers: { 'x-test': 'yes' } })
  const runtime = ManagedRuntime.make(
    createWebToolsHttpTestLayer(fetchImplementation, (url, init, timeoutMs) => {
      calls.push({
        url,
        method: String(init.method),
        headers: new Headers(init.headers),
        body: String(init.body),
        timeoutMs,
      })
    }),
  )

  //when
  const response = await runtime.runPromise(
    WebToolsHttp.use((http) =>
      http.request(
        'https://example.com/search',
        {
          method: 'POST',
          headers: { Accept: 'application/json', Authorization: 'Bearer secret' },
          body: '{"query":"test"}',
        },
        25000,
      ),
    ),
  )
  await runtime.dispose()

  //then
  assert.equal(response.status, 201)
  assert.equal(response.statusText, 'Created')
  assert.equal(response.headers.get('x-test'), 'yes')
  assert.deepEqual(calls, [
    {
      url: 'https://example.com/search',
      method: 'POST',
      headers: new Headers({ Accept: 'application/json', Authorization: 'Bearer secret' }),
      body: '{"query":"test"}',
      timeoutMs: 25000,
    },
  ])
})

test('should map request timeout separately from caller cancellation given a timed-out request', async () => {
  //given
  const fetchImplementation: WebToolsFetch = async (_url: URL | RequestInfo, init: RequestInit | undefined) => {
    await new Promise<never>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })
    throw new Error('unreachable')
  }
  const runtime = ManagedRuntime.make(createWebToolsHttpTestLayer(fetchImplementation))

  //when
  const timeoutError = await runtime
    .runPromise(WebToolsHttp.use((http) => http.request('https://example.com', {}, 1)))
    .then(
      () => undefined,
      (error) => error,
    )
  const controller = new AbortController()
  const callerRequest = runtime.runPromise(
    WebToolsHttp.use((http) => http.request('https://example.com', {}, 25000)),
    { signal: controller.signal },
  )
  controller.abort(new Error('caller cancelled'))
  const callerError = await callerRequest.then(
    () => undefined,
    (error) => error,
  )
  await runtime.dispose()

  //then
  assert.ok(timeoutError instanceof WebToolsHttpTimeoutError)
  assert.equal(timeoutError.message, 'Request timed out')
  assert.equal(callerError instanceof WebToolsHttpTimeoutError, false)
  assert.equal(callerError instanceof WebToolsHttpRequestError, false)
})

test('should cancel a response reader given a raw body over the size limit', async () => {
  //given
  let cancelled = false
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller: ReadableStreamDefaultController<Uint8Array<ArrayBufferLike>>): void {
        controller.enqueue(new TextEncoder().encode('too large'))
      },
      cancel(): void {
        cancelled = true
      },
    }),
  )
  const runtime = ManagedRuntime.make(createWebToolsHttpTestLayer(async () => response))

  //when
  const error = await runtime.runPromise(WebToolsHttp.use((http) => http.readText(response, 3))).then(
    () => undefined,
    (cause) => cause,
  )
  await runtime.dispose()

  //then
  assert.ok(error instanceof WebToolsHttpResponseTooLargeError)
  assert.equal(cancelled, true)
})

test('should release a response reader given caller cancellation during body reading', async () => {
  //given
  let startedResolve!: () => void
  const started = new Promise<void>((resolve) => {
    startedResolve = resolve
  })
  let cancelled = false
  const response = new Response(
    new ReadableStream<Uint8Array>({
      pull(): Promise<void> {
        startedResolve()
        return new Promise<void>(() => undefined)
      },
      cancel(): void {
        cancelled = true
      },
    }),
  )
  const runtime = ManagedRuntime.make(createWebToolsHttpTestLayer(async () => response))
  const controller = new AbortController()
  const read = runtime.runPromise(
    WebToolsHttp.use((http) => http.readText(response)),
    { signal: controller.signal },
  )
  await started

  //when
  controller.abort()
  const error = await read.then(
    () => undefined,
    (cause) => cause,
  )
  await runtime.dispose()

  //then
  assert.ok(error)
  assert.equal(error instanceof WebToolsHttpResponseBodyError, false)
  assert.equal(cancelled, true)
})

test('should map response body failures and redact credentials given a credentialed URL', async () => {
  //given
  const fetchImplementation: WebToolsFetch = async () => {
    throw new Error('request failed for https://example.com/?exaApiKey=secret')
  }
  const runtime = ManagedRuntime.make(createWebToolsHttpTestLayer(fetchImplementation))

  //when
  const requestError = await runtime
    .runPromise(WebToolsHttp.use((http) => http.request('https://example.com/?exaApiKey=secret', {}, 25000)))
    .then(
      () => undefined,
      (cause) => cause,
    )
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller: ReadableStreamDefaultController<Uint8Array<ArrayBufferLike>>): void {
        controller.error(new Error('body failed'))
      },
    }),
  )
  const bodyError = await runtime.runPromise(WebToolsHttp.use((http) => http.readText(response))).then(
    () => undefined,
    (cause) => cause,
  )
  await runtime.dispose()

  //then
  assert.ok(requestError instanceof WebToolsHttpRequestError)
  assert.doesNotMatch(requestError.url, /secret/)
  assert.doesNotMatch(requestError.message, /secret/)
  assert.ok(bodyError instanceof WebToolsHttpResponseBodyError)
})

test('should read an unbounded response body without a webfetch limit given an HTTP request', async () => {
  //given
  const response = new Response('complete search response')
  const runtime = ManagedRuntime.make(createWebToolsHttpTestLayer(async () => response))

  //when
  const text = await runtime.runPromise(WebToolsHttp.use((http) => http.readText(response)))
  await runtime.dispose()

  //then
  assert.equal(text, 'complete search response')
})
