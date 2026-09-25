import { Context, Effect, Layer, Predicate, Schema } from 'effect'

const WebToolsErrorDetails = Schema.Struct({
  name: Schema.String,
  message: Schema.String,
})
type WebToolsErrorDetails = Schema.Schema.Type<typeof WebToolsErrorDetails>

class WebToolsHttpRequestError extends Schema.TaggedError<WebToolsHttpRequestError>()('WebToolsHttpRequestError', {
  operation: Schema.String,
  url: Schema.String,
  method: Schema.String,
  message: Schema.String,
  cause: Schema.optional(WebToolsErrorDetails),
}) {}

class WebToolsHttpTimeoutError extends Schema.TaggedError<WebToolsHttpTimeoutError>()('WebToolsHttpTimeoutError', {
  operation: Schema.String,
  url: Schema.String,
  method: Schema.String,
  timeoutMs: Schema.Number,
  message: Schema.String,
}) {}

class WebToolsHttpResponseBodyError extends Schema.TaggedError<WebToolsHttpResponseBodyError>()(
  'WebToolsHttpResponseBodyError',
  {
    operation: Schema.String,
    url: Schema.String,
    message: Schema.String,
    cause: Schema.optional(WebToolsErrorDetails),
  },
) {}

class WebToolsHttpResponseTooLargeError extends Schema.TaggedError<WebToolsHttpResponseTooLargeError>()(
  'WebToolsHttpResponseTooLargeError',
  {
    operation: Schema.String,
    url: Schema.String,
    maxBytes: Schema.Number,
    message: Schema.String,
  },
) {}

interface WebToolsHttpService {
  readonly request: (
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ) => Effect.Effect<Response, WebToolsHttpRequestError | WebToolsHttpTimeoutError>
  readonly readText: (
    response: Response,
    maxBytes?: number,
  ) => Effect.Effect<string, WebToolsHttpResponseBodyError | WebToolsHttpResponseTooLargeError>
}

class WebToolsHttp extends Context.Service<WebToolsHttp, WebToolsHttpService>()('web-tools/WebToolsHttp') {}

type WebToolsFetch = typeof fetch
type WebToolsHttpRequestObserver = (url: string, init: RequestInit, timeoutMs: number) => void

function redactSensitiveText(text: string): string {
  return text
    .replace(/((?:exaApiKey|api[_-]?key|token|secret|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(Bearer\s+)[^\s]+/gi, '$1[REDACTED]')
}

function redactSensitiveUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    for (const key of url.searchParams.keys()) {
      if (/(?:api[_-]?key|token|secret|password)/i.test(key)) url.searchParams.set(key, '[REDACTED]')
    }
    return url.toString()
  } catch {
    return redactSensitiveText(rawUrl)
  }
}

function errorMessage(cause: unknown, fallback: string): string {
  return redactSensitiveText(Predicate.isError(cause) ? cause.message : Predicate.isString(cause) ? cause : fallback)
}

function errorDetails(cause: unknown): WebToolsErrorDetails | undefined {
  if (Predicate.isError(cause)) return { name: cause.name, message: redactSensitiveText(cause.message) }
  if (Predicate.isString(cause)) return { name: 'Error', message: redactSensitiveText(cause) }
  return undefined
}

function requestFailure(url: string, init: RequestInit, cause: unknown): WebToolsHttpRequestError {
  return new WebToolsHttpRequestError({
    operation: 'request',
    url: redactSensitiveUrl(url),
    method: String(init.method ?? 'GET'),
    message: errorMessage(cause, 'HTTP request failed'),
    cause: errorDetails(cause),
  })
}

function requestTimeout(url: string, init: RequestInit, timeoutMs: number): WebToolsHttpTimeoutError {
  const safeUrl = redactSensitiveUrl(url)
  return new WebToolsHttpTimeoutError({
    operation: 'request',
    url: safeUrl,
    method: String(init.method ?? 'GET'),
    timeoutMs,
    message: 'Request timed out',
  })
}

function responseBodyFailure(response: Response, cause: unknown): WebToolsHttpResponseBodyError {
  const url = redactSensitiveUrl(response.url || 'response')
  return new WebToolsHttpResponseBodyError({
    operation: 'readResponseBody',
    url,
    message: errorMessage(cause, 'Unable to read response body'),
    cause: errorDetails(cause),
  })
}

function responseTooLarge(response: Response, maxBytes: number): WebToolsHttpResponseTooLargeError {
  const url = redactSensitiveUrl(response.url || 'response')
  return new WebToolsHttpResponseTooLargeError({
    operation: 'readResponseBody',
    url,
    maxBytes,
    message: `Response too large (exceeds ${maxBytes} bytes)`,
  })
}

const readResponseReader = Effect.fnUntraced(function* (
  response: Response,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  maxBytes: number | undefined,
): Effect.fn.Return<string, WebToolsHttpResponseBodyError | WebToolsHttpResponseTooLargeError> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  while (true) {
    const { done, value } = yield* Effect.tryPromise({
      try: () => reader.read(),
      catch: (cause: unknown) => responseBodyFailure(response, cause),
    })
    if (done) break
    if (!value) continue
    totalBytes += value.byteLength
    if (maxBytes !== undefined && totalBytes > maxBytes) {
      return yield* Effect.fail(responseTooLarge(response, maxBytes))
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks).toString('utf8')
})

function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () => reader.cancel(),
    catch: () => undefined,
  }).pipe(Effect.ignore)
}

const readResponseText = Effect.fnUntraced(function* (
  response: Response,
  maxBytes?: number,
): Effect.fn.Return<string, WebToolsHttpResponseBodyError | WebToolsHttpResponseTooLargeError> {
  const reader = yield* Effect.try({
    try: () => response.body?.getReader(),
    catch: (cause: unknown) => responseBodyFailure(response, cause),
  })
  if (reader === undefined) {
    const text = yield* Effect.tryPromise({
      try: () => response.text(),
      catch: (cause: unknown) => responseBodyFailure(response, cause),
    })
    if (maxBytes !== undefined && Buffer.byteLength(text) > maxBytes) {
      return yield* Effect.fail(responseTooLarge(response, maxBytes))
    }
    return text
  }
  return yield* Effect.scoped(
    Effect.acquireUseRelease(
      Effect.succeed(reader),
      (activeReader) => readResponseReader(response, activeReader, maxBytes),
      cancelReader,
    ),
  )
})

function createHttpService(
  fetchImplementation: WebToolsFetch | undefined = undefined,
  observeRequest?: WebToolsHttpRequestObserver,
): WebToolsHttpService {
  const request = Effect.fn('WebToolsHttp.request')(function* (
    url: string,
    init: RequestInit,
    timeoutMs: number,
  ): Effect.fn.Return<Response, WebToolsHttpRequestError | WebToolsHttpTimeoutError> {
    if (observeRequest) yield* Effect.sync(() => observeRequest(url, init, timeoutMs))
    return yield* Effect.tryPromise({
      try: (signal: AbortSignal) => (fetchImplementation ?? fetch)(url, { ...init, signal }),
      catch: (cause: unknown) => requestFailure(url, init, cause),
    }).pipe(
      Effect.timeout(timeoutMs),
      Effect.catchTag('TimeoutError', () => Effect.fail(requestTimeout(url, init, timeoutMs))),
    )
  })
  const readText = Effect.fn('WebToolsHttp.readText')(function* (
    response: Response,
    maxBytes?: number,
  ): Effect.fn.Return<string, WebToolsHttpResponseBodyError | WebToolsHttpResponseTooLargeError> {
    return yield* readResponseText(response, maxBytes)
  })
  return { request, readText }
}

const WebToolsHttpLive: Layer.Layer<WebToolsHttp> = Layer.succeed(WebToolsHttp, WebToolsHttp.of(createHttpService()))

function createWebToolsHttpTestLayer(
  fetchImplementation: WebToolsFetch,
  observeRequest?: WebToolsHttpRequestObserver,
): Layer.Layer<WebToolsHttp> {
  return Layer.succeed(WebToolsHttp, WebToolsHttp.of(createHttpService(fetchImplementation, observeRequest)))
}

export {
  createHttpService,
  createWebToolsHttpTestLayer,
  redactSensitiveUrl as redactWebToolsSensitiveUrl,
  type WebToolsFetch,
  WebToolsHttp,
  WebToolsHttpLive,
  WebToolsHttpRequestError,
  type WebToolsHttpRequestObserver,
  WebToolsHttpResponseBodyError,
  WebToolsHttpResponseTooLargeError,
  WebToolsHttpTimeoutError,
}
