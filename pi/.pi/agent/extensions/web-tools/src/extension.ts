import { randomBytes } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  withFileMutationQueue,
} from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, Predicate, Schema } from 'effect'
import { Parser } from 'htmlparser2'
import TurndownService from 'turndown'

const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'div',
  'dl',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
])

function pushBreak(chunks: string[]): void {
  const last = chunks[chunks.length - 1] ?? ''
  if (!last.endsWith('\n')) chunks.push('\n')
}

function extractTextFromHTML(html: string): string {
  const chunks: string[] = []
  let skipDepth = 0
  const parser = new Parser({
    onopentag(name: string): void {
      if (skipDepth > 0 || ['script', 'style', 'noscript', 'iframe', 'object', 'embed'].includes(name)) {
        skipDepth += 1
        return
      }
      if (BLOCK_TAGS.has(name)) pushBreak(chunks)
    },
    ontext(text: string): void {
      if (skipDepth === 0) chunks.push(text)
    },
    onclosetag(name: string): void {
      if (skipDepth > 0) {
        skipDepth -= 1
        return
      }
      if (BLOCK_TAGS.has(name)) pushBreak(chunks)
    },
  })
  parser.write(html)
  parser.end()
  return chunks
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function convertHTMLToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  })
  turndown.remove(['script', 'style', 'meta', 'link'])
  return turndown.turndown(html)
}

const WEBFETCH_NAME = 'webfetch'
const DEFAULT_TIMEOUT_SECONDS = 30
const MAX_TIMEOUT_SECONDS = 120
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

const FORMAT_VALUES = ['text', 'markdown', 'html'] as const

type WebFetchFormat = (typeof FORMAT_VALUES)[number]

type WebFetchDetails = {
  url: string
  host: string
  contentType: string
  mime: string
  format: WebFetchFormat
  lineCount: number
  preview: string[]
  truncated: boolean
  fullOutputPath?: string
}

type WebFetchInput = { url: string; format?: WebFetchFormat; timeout?: number }

type WebFetchResult = { content: [{ type: 'text'; text: string }]; details: WebFetchDetails }

const browserUserAgent =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36'

function acceptHeaderForFormat(format: WebFetchFormat): string {
  switch (format) {
    case 'markdown':
      return 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1'
    case 'text':
      return 'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1'
    case 'html':
      return 'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1'
  }
}

function normalizeHost(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase()
}

function isPrivateIpv4(hostname: string): boolean {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false
  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10))
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false
  if (parts[0] === 10) return true
  if (parts[0] === 127) return true
  if (parts[0] === 192 && parts[1] === 168) return true
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
  return false
}

function assertSafePublicHttpUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL must use http:// or https://')
  }
  const hostname = normalizeHost(url.hostname)
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    hostname === '0:0:0:0:0:0:0:1' ||
    isPrivateIpv4(hostname)
  ) {
    throw new Error(`Blocked private or localhost target: ${url.hostname}`)
  }
  return url
}

function mimeFrom(contentType: string): string {
  return contentType.split(';', 1)[0]?.trim().toLowerCase() ?? ''
}

function isTextualMime(mime: string): boolean {
  return (
    !mime ||
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime.endsWith('+json') ||
    mime === 'application/xml' ||
    mime.endsWith('+xml') ||
    mime === 'application/javascript' ||
    mime === 'application/x-javascript'
  )
}

function clampTimeout(timeout: number | undefined): number {
  if (typeof timeout !== 'number' || !Number.isFinite(timeout)) return DEFAULT_TIMEOUT_SECONDS
  return Math.min(MAX_TIMEOUT_SECONDS, Math.max(1, Math.floor(timeout)))
}

function convertContent(content: string, contentType: string, format: WebFetchFormat): string {
  if (!contentType.toLowerCase().includes('text/html')) return content
  if (format === 'markdown') return convertHTMLToMarkdown(content)
  if (format === 'text') return extractTextFromHTML(content)
  return content
}

function countLines(text: string): number {
  return text.length === 0 ? 0 : text.split('\n').length
}

function truncateInline(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

function previewLines(text: string, maxLines = 3, maxChars = 100): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map((line) => truncateInline(line, maxChars))
}

const WEBSEARCH_NAME = 'websearch'
const EXA_URL = 'https://mcp.exa.ai/mcp'
const PARALLEL_URL = 'https://search.parallel.ai/mcp'
const MAX_NUM_RESULTS = 20
const MAX_CONTEXT_CHARACTERS = 50000
const NO_RESULTS = 'No search results found. Please try a different query.'

const PROVIDER_VALUES = ['exa', 'parallel'] as const
const LIVECRAWL_VALUES = ['fallback', 'preferred'] as const
const SEARCH_TYPE_VALUES = ['auto', 'fast', 'deep'] as const

type WebSearchProvider = (typeof PROVIDER_VALUES)[number]

type WebSearchEnvironment = {
  readonly EXA_API_KEY?: string
  readonly PARALLEL_API_KEY?: string
  readonly PI_WEBSEARCH_PROVIDER?: string
}

type WebSearchDetails = {
  provider: WebSearchProvider
  query: string
  lineCount: number
  preview: string[]
  truncated: boolean
  fullOutputPath?: string
}

type WebSearchInput = {
  query: string
  numResults?: number
  livecrawl?: (typeof LIVECRAWL_VALUES)[number]
  type?: (typeof SEARCH_TYPE_VALUES)[number]
  contextMaxCharacters?: number
}

type WebSearchResult = { content: [{ type: 'text'; text: string }]; details: WebSearchDetails }

function exaUrl(apiKey: string | undefined): string {
  if (!apiKey) return EXA_URL
  const url = new URL(EXA_URL)
  url.searchParams.set('exaApiKey', apiKey)
  return url.toString()
}

function clampInt(value: number | undefined, fallback: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(1, Math.floor(value)))
}

function hasWebSearchCredentials(env: WebSearchEnvironment = process.env): boolean {
  return Boolean(env.EXA_API_KEY?.trim() || env.PARALLEL_API_KEY?.trim())
}

function selectProvider(env: WebSearchEnvironment = process.env): WebSearchProvider {
  const preferred = env.PI_WEBSEARCH_PROVIDER
  const hasExa = Boolean(env.EXA_API_KEY?.trim())
  const hasParallel = Boolean(env.PARALLEL_API_KEY?.trim())
  if (preferred === 'exa' || preferred === 'parallel') return preferred
  if (hasExa && !hasParallel) return 'exa'
  if (hasParallel && !hasExa) return 'parallel'
  return 'exa'
}

const searchResponseJsonSchema = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.optional(
      Schema.NullOr(
        Schema.Struct({
          content: Schema.optional(
            Schema.Array(
              Schema.Struct({
                text: Schema.optional(Schema.Unknown),
              }),
            ),
          ),
        }),
      ),
    ),
  }),
)

function parseSearchResponse(body: string): string | undefined {
  const parsePayload = (payload: string): string | undefined => {
    const trimmed = payload.trim()
    if (!trimmed.startsWith('{')) return undefined
    const parsed = Schema.decodeUnknownSync(searchResponseJsonSchema)(trimmed)
    const items = parsed.result?.content ?? []
    for (const item of items) {
      if (Predicate.isString(item.text) && item.text.length > 0) return item.text
    }
    return undefined
  }
  const direct = body.trim() ? parsePayload(body) : undefined
  if (direct) return direct
  for (const line of body.split('\n')) {
    if (!line.startsWith('data:')) continue
    const text = parsePayload(line.slice(5))
    if (text) return text
  }
  return undefined
}

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

type WebToolsHttpService = {
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

const WebToolsFilesystemCause = Schema.Struct({
  name: Schema.String,
  message: Schema.String,
})
type WebToolsFilesystemCause = Schema.Schema.Type<typeof WebToolsFilesystemCause>

class WebToolsFilesystemError extends Schema.TaggedError<WebToolsFilesystemError>()('WebToolsFilesystemError', {
  operation: Schema.String,
  path: Schema.String,
  message: Schema.String,
  cause: Schema.optional(WebToolsFilesystemCause),
}) {}

type WebToolsTemporaryOutputService = {
  readonly writeOutput: (prefix: string, content: string) => Effect.Effect<string, WebToolsFilesystemError>
}

class WebToolsTemporaryOutput extends Context.Service<WebToolsTemporaryOutput, WebToolsTemporaryOutputService>()(
  'web-tools/WebToolsTemporaryOutput',
) {}

type TemporaryOutputWrite = { readonly prefix: string; readonly content: string; readonly path: string }

function temporaryOutputError(operation: string, path: string, cause: unknown): WebToolsFilesystemError {
  const causeDetails: WebToolsFilesystemCause | undefined = Predicate.isError(cause)
    ? { name: cause.name, message: cause.message }
    : Predicate.isString(cause)
      ? { name: 'Error', message: cause }
      : undefined
  return new WebToolsFilesystemError({
    operation,
    path,
    message: Predicate.isError(cause) ? cause.message : `Unable to ${operation} temporary output`,
    cause: causeDetails,
  })
}

function tryTemporaryOutput<A>(
  operation: string,
  path: string,
  execute: (signal: AbortSignal) => PromiseLike<A>,
): Effect.Effect<A, WebToolsFilesystemError> {
  return Effect.tryPromise({
    try: execute,
    catch: (cause: unknown) => temporaryOutputError(operation, path, cause),
  })
}

const writeOutput = Effect.fn('WebToolsTemporaryOutput.writeOutput')(function* (
  prefix: string,
  content: string,
): Effect.fn.Return<string, WebToolsFilesystemError> {
  const tempDir = yield* tryTemporaryOutput('mkdtemp', prefix, () => mkdtemp(join(tmpdir(), `${prefix}-`)))
  const fullOutputPath = join(tempDir, 'output.txt')
  yield* tryTemporaryOutput('writeFile', fullOutputPath, (signal) =>
    withFileMutationQueue(fullOutputPath, () => writeFile(fullOutputPath, content, { encoding: 'utf8', signal })),
  )
  return fullOutputPath
})

const WebToolsTemporaryOutputLive: Layer.Layer<WebToolsTemporaryOutput> = Layer.succeed(
  WebToolsTemporaryOutput,
  WebToolsTemporaryOutput.of({ writeOutput }),
)

function createWebToolsTemporaryOutputTestLayer(
  writes: TemporaryOutputWrite[],
  root = '/tmp',
): Layer.Layer<WebToolsTemporaryOutput> {
  let sequence = 0
  return Layer.succeed(
    WebToolsTemporaryOutput,
    WebToolsTemporaryOutput.of({
      writeOutput: (prefix: string, content: string) =>
        Effect.sync(() => {
          const path = join(root, `${prefix}-${sequence++}`, 'output.txt')
          writes.push({ prefix, content, path })
          return path
        }),
    }),
  )
}

class WebSearchConfig extends Context.Service<WebSearchConfig, WebSearchEnvironment>()('web-tools/WebSearchConfig') {}

function WebSearchConfigLive(): Layer.Layer<WebSearchConfig> {
  return Layer.effect(
    WebSearchConfig,
    Effect.sync(() =>
      WebSearchConfig.of({
        EXA_API_KEY: process.env.EXA_API_KEY,
        PARALLEL_API_KEY: process.env.PARALLEL_API_KEY,
        PI_WEBSEARCH_PROVIDER: process.env.PI_WEBSEARCH_PROVIDER,
      }),
    ),
  )
}

class WebFetchValidationError extends Schema.TaggedError<WebFetchValidationError>()('WebFetchValidationError', {
  message: Schema.String,
}) {}

class WebFetchStatusError extends Schema.TaggedError<WebFetchStatusError>()('WebFetchStatusError', {
  url: Schema.String,
  status: Schema.Number,
  statusText: Schema.String,
  message: Schema.String,
}) {}

class WebFetchUnsupportedContentError extends Schema.TaggedError<WebFetchUnsupportedContentError>()(
  'WebFetchUnsupportedContentError',
  {
    mime: Schema.String,
    message: Schema.String,
  },
) {}

class WebFetchResponseTooLargeError extends Schema.TaggedError<WebFetchResponseTooLargeError>()(
  'WebFetchResponseTooLargeError',
  {
    maxBytes: Schema.Number,
    message: Schema.String,
  },
) {}

function workflowErrorMessage(cause: unknown, fallback: string): string {
  return Predicate.isError(cause) ? cause.message : fallback
}

function validateWebFetchUrl(rawUrl: string): Effect.Effect<URL, WebFetchValidationError> {
  return Effect.try({
    try: () => assertSafePublicHttpUrl(rawUrl),
    catch: (cause: unknown) => new WebFetchValidationError({ message: workflowErrorMessage(cause, 'Blocked URL') }),
  })
}

type WebFetchError =
  | WebFetchValidationError
  | WebFetchStatusError
  | WebFetchUnsupportedContentError
  | WebFetchResponseTooLargeError
  | WebToolsHttpRequestError
  | WebToolsHttpTimeoutError
  | WebToolsHttpResponseBodyError
  | WebToolsHttpResponseTooLargeError
  | WebToolsFilesystemError

const runWebFetch = Effect.fn('runWebFetch')(function* (
  params: WebFetchInput,
): Effect.fn.Return<WebFetchResult, WebFetchError, WebToolsHttp | WebToolsTemporaryOutput> {
  const http = yield* WebToolsHttp
  const temporaryOutput = yield* WebToolsTemporaryOutput
  const format = params.format ?? 'markdown'
  const timeoutSeconds = clampTimeout(params.timeout)
  const safeUrl = yield* validateWebFetchUrl(params.url)
  const url = safeUrl.toString()
  const response = yield* http.request(
    url,
    {
      headers: {
        'User-Agent': browserUserAgent,
        Accept: acceptHeaderForFormat(format),
        'Accept-Language': 'en-US,en;q=0.9',
      },
    },
    timeoutSeconds * 1000,
  )
  if (!response.ok) {
    const errorUrl = redactSensitiveUrl(url)
    return yield* Effect.fail(
      new WebFetchStatusError({
        url: errorUrl,
        status: response.status,
        statusText: response.statusText,
        message: `Unable to fetch ${errorUrl}: HTTP ${response.status} ${response.statusText}`,
      }),
    )
  }
  const contentType = response.headers.get('content-type') ?? ''
  const mime = mimeFrom(contentType)
  if (mime.startsWith('image/')) {
    return yield* Effect.fail(
      new WebFetchUnsupportedContentError({
        mime,
        message: `Unsupported fetched image content type: ${mime}`,
      }),
    )
  }
  if (!isTextualMime(mime)) {
    return yield* Effect.fail(
      new WebFetchUnsupportedContentError({
        mime,
        message: `Unsupported fetched file content type: ${mime || 'unknown'}`,
      }),
    )
  }
  const rawContent = yield* http.readText(response, MAX_RESPONSE_BYTES).pipe(
    Effect.catchTag('WebToolsHttpResponseTooLargeError', (error) =>
      Effect.fail(
        new WebFetchResponseTooLargeError({
          maxBytes: error.maxBytes,
          message: `Response too large (exceeds ${formatSize(error.maxBytes)})`,
        }),
      ),
    ),
  )
  const converted = convertContent(rawContent, contentType, format)
  const truncation = truncateHead(converted, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  })
  let text = truncation.content
  let fullOutputPath: string | undefined
  if (truncation.truncated) {
    const prefix = yield* Effect.sync(() => `pi-${WEBFETCH_NAME}-${randomBytes(4).toString('hex')}`)
    fullOutputPath = yield* temporaryOutput.writeOutput(prefix, converted)
    text += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${fullOutputPath}]`
  }
  return {
    content: [{ type: 'text', text }],
    details: {
      url,
      host: safeUrl.host,
      contentType,
      mime,
      format,
      lineCount: countLines(converted),
      preview: previewLines(converted),
      truncated: truncation.truncated,
      fullOutputPath,
    },
  }
})

type WebFetchEffectRunner = (effect: ReturnType<typeof runWebFetch>, signal?: AbortSignal) => Promise<WebFetchResult>

const SEARCH_TIMEOUT_MS = 25_000

class WebSearchResponseError extends Schema.TaggedError<WebSearchResponseError>()('WebSearchResponseError', {
  toolName: Schema.String,
  status: Schema.Number,
  statusText: Schema.String,
  message: Schema.String,
}) {}

class WebSearchParseError extends Schema.TaggedError<WebSearchParseError>()('WebSearchParseError', {
  message: Schema.String,
}) {}

function parseSearchResponseEffect(body: string): Effect.Effect<string | undefined, WebSearchParseError> {
  return Effect.try({
    try: () => parseSearchResponse(body),
    catch: (cause: unknown) =>
      new WebSearchParseError({
        message: Predicate.isError(cause) ? cause.message : 'Unable to parse search response',
      }),
  })
}

type WebSearchError =
  | WebSearchResponseError
  | WebSearchParseError
  | WebToolsHttpRequestError
  | WebToolsHttpTimeoutError
  | WebToolsHttpResponseBodyError
  | WebToolsHttpResponseTooLargeError
  | WebToolsFilesystemError

const runWebSearch = Effect.fn('runWebSearch')(function* (
  params: WebSearchInput,
  toolCallId: string,
  sessionFile: string | null,
): Effect.fn.Return<WebSearchResult, WebSearchError, WebToolsHttp | WebToolsTemporaryOutput | WebSearchConfig> {
  const http = yield* WebToolsHttp
  const temporaryOutput = yield* WebToolsTemporaryOutput
  const config = yield* WebSearchConfig
  const provider = selectProvider(config)
  const numResults = clampInt(params.numResults, 8, MAX_NUM_RESULTS)
  const contextMaxCharacters =
    params.contextMaxCharacters === undefined
      ? undefined
      : clampInt(params.contextMaxCharacters, 10000, MAX_CONTEXT_CHARACTERS)
  const request =
    provider === 'parallel'
      ? {
          url: PARALLEL_URL,
          toolName: 'web_search',
          argumentsObject: {
            objective: params.query,
            search_queries: [params.query],
            session_id: sessionFile ?? toolCallId,
          },
          headers: {
            'User-Agent': 'pi-web-tools',
            ...(config.PARALLEL_API_KEY ? { Authorization: `Bearer ${config.PARALLEL_API_KEY}` } : {}),
          },
        }
      : {
          url: exaUrl(config.EXA_API_KEY),
          toolName: 'web_search_exa',
          argumentsObject: {
            query: params.query,
            type: params.type ?? 'auto',
            numResults,
            livecrawl: params.livecrawl ?? 'fallback',
            ...(contextMaxCharacters ? { contextMaxCharacters } : {}),
          },
          headers: {},
        }
  const response = yield* http.request(
    request.url,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        ...request.headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: request.toolName,
          arguments: request.argumentsObject,
        },
      }),
    },
    SEARCH_TIMEOUT_MS,
  )
  if (!response.ok) {
    return yield* Effect.fail(
      new WebSearchResponseError({
        toolName: request.toolName,
        status: response.status,
        statusText: response.statusText,
        message: `${request.toolName} failed: HTTP ${response.status} ${response.statusText}`,
      }),
    )
  }
  const text = yield* parseSearchResponseEffect(yield* http.readText(response))
  const output = text ?? NO_RESULTS
  const truncation = truncateHead(output, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  })
  let resultText = truncation.content
  let fullOutputPath: string | undefined
  if (truncation.truncated) {
    const prefix = yield* Effect.sync(() => `pi-${WEBSEARCH_NAME}-${randomBytes(4).toString('hex')}`)
    fullOutputPath = yield* temporaryOutput.writeOutput(prefix, output)
    resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${fullOutputPath}]`
  }
  return {
    content: [{ type: 'text', text: resultText }],
    details: {
      provider,
      query: params.query,
      lineCount: countLines(output),
      preview: previewLines(output),
      truncated: truncation.truncated,
      fullOutputPath,
    },
  }
})

type WebSearchEffectRunner = (effect: ReturnType<typeof runWebSearch>, signal?: AbortSignal) => Promise<WebSearchResult>

export {
  acceptHeaderForFormat,
  assertSafePublicHttpUrl,
  browserUserAgent,
  clampInt,
  clampTimeout,
  convertContent,
  convertHTMLToMarkdown,
  countLines,
  createHttpService,
  createWebToolsHttpTestLayer,
  createWebToolsTemporaryOutputTestLayer,
  DEFAULT_TIMEOUT_SECONDS,
  EXA_URL,
  exaUrl,
  extractTextFromHTML,
  FORMAT_VALUES,
  hasWebSearchCredentials,
  isTextualMime,
  LIVECRAWL_VALUES,
  MAX_CONTEXT_CHARACTERS,
  MAX_NUM_RESULTS,
  MAX_RESPONSE_BYTES,
  MAX_TIMEOUT_SECONDS,
  mimeFrom,
  NO_RESULTS,
  PARALLEL_URL,
  PROVIDER_VALUES,
  parseSearchResponse,
  previewLines,
  redactSensitiveUrl as redactWebToolsSensitiveUrl,
  runWebFetch,
  runWebSearch,
  SEARCH_TYPE_VALUES,
  selectProvider,
  type TemporaryOutputWrite,
  truncateInline,
  WEBFETCH_NAME,
  WEBSEARCH_NAME,
  type WebFetchDetails,
  type WebFetchEffectRunner,
  type WebFetchError,
  type WebFetchFormat,
  type WebFetchInput,
  WebFetchResponseTooLargeError,
  type WebFetchResult,
  WebFetchStatusError,
  WebFetchUnsupportedContentError,
  WebFetchValidationError,
  WebSearchConfig,
  WebSearchConfigLive,
  type WebSearchDetails,
  type WebSearchEffectRunner,
  type WebSearchEnvironment,
  type WebSearchError,
  type WebSearchInput,
  WebSearchParseError,
  type WebSearchProvider,
  WebSearchResponseError,
  type WebSearchResult,
  type WebToolsFetch,
  WebToolsFilesystemError,
  WebToolsHttp,
  WebToolsHttpLive,
  WebToolsHttpRequestError,
  type WebToolsHttpRequestObserver,
  WebToolsHttpResponseBodyError,
  WebToolsHttpResponseTooLargeError,
  WebToolsHttpTimeoutError,
  WebToolsTemporaryOutput,
  WebToolsTemporaryOutputLive,
}
