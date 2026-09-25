import { randomBytes } from 'node:crypto'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from '@earendil-works/pi-coding-agent'
import { Effect, Predicate, Schema } from 'effect'
import {
  clampInt,
  countLines,
  exaUrl,
  MAX_CONTEXT_CHARACTERS,
  MAX_NUM_RESULTS,
  NO_RESULTS,
  PARALLEL_URL,
  parseSearchResponse,
  previewLines,
  selectProvider,
  WEBSEARCH_NAME,
  type WebSearchInput,
  type WebSearchResult,
} from '../core/websearch.ts'
import {
  WebToolsHttp,
  type WebToolsHttpRequestError,
  type WebToolsHttpResponseBodyError,
  type WebToolsHttpResponseTooLargeError,
  type WebToolsHttpTimeoutError,
} from './services/http.ts'
import { type WebToolsFilesystemError, WebToolsTemporaryOutput } from './services/temporary-output.ts'
import { WebSearchConfig } from './services/websearch-config.ts'

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
  runWebSearch,
  type WebSearchEffectRunner,
  type WebSearchError,
  WebSearchParseError,
  WebSearchResponseError,
  type WebSearchResult,
}
