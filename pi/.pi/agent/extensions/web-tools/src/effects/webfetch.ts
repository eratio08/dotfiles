import { randomBytes } from 'node:crypto'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from '@earendil-works/pi-coding-agent'
import { Effect, Predicate, Schema } from 'effect'
import {
  acceptHeaderForFormat,
  assertSafePublicHttpUrl,
  browserUserAgent,
  clampTimeout,
  convertContent,
  countLines,
  isTextualMime,
  MAX_RESPONSE_BYTES,
  mimeFrom,
  previewLines,
  WEBFETCH_NAME,
  type WebFetchInput,
  type WebFetchResult,
} from '../core/webfetch.ts'
import {
  redactWebToolsSensitiveUrl,
  WebToolsHttp,
  type WebToolsHttpRequestError,
  type WebToolsHttpResponseBodyError,
  type WebToolsHttpResponseTooLargeError,
  type WebToolsHttpTimeoutError,
} from './services/http.ts'
import { type WebToolsFilesystemError, WebToolsTemporaryOutput } from './services/temporary-output.ts'

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
    catch: (cause) => new WebFetchValidationError({ message: workflowErrorMessage(cause, 'Blocked URL') }),
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
    const errorUrl = redactWebToolsSensitiveUrl(url)
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

export {
  runWebFetch,
  type WebFetchEffectRunner,
  WebFetchResponseTooLargeError,
  WebFetchStatusError,
  WebFetchUnsupportedContentError,
  WebFetchValidationError,
}
