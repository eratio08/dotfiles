import { StringEnum } from '@earendil-works/pi-ai'
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, getMarkdownTheme } from '@earendil-works/pi-coding-agent'
import { Container, Markdown, Spacer, Text } from '@earendil-works/pi-tui'
import { type EffectToolDefinition, PiExtension, type PiRegistrationContext, PiToolContext } from '@eratio08/pi-effect'
import { Effect, Layer, Predicate } from 'effect'
import { type Static, Type } from 'typebox'
import {
  assertSafePublicHttpUrl,
  DEFAULT_TIMEOUT_SECONDS,
  FORMAT_VALUES,
  MAX_TIMEOUT_SECONDS,
  WEBFETCH_NAME,
  type WebFetchDetails,
} from './src/core/webfetch.ts'
import {
  hasWebSearchCredentials,
  LIVECRAWL_VALUES,
  MAX_CONTEXT_CHARACTERS,
  MAX_NUM_RESULTS,
  SEARCH_TYPE_VALUES,
  truncateInline,
  WEBSEARCH_NAME,
  type WebSearchDetails,
} from './src/core/websearch.ts'
import { type WebToolsHttp, WebToolsHttpLive } from './src/effects/services/http.ts'
import { type WebToolsTemporaryOutput, WebToolsTemporaryOutputLive } from './src/effects/services/temporary-output.ts'
import { type WebSearchConfig, WebSearchConfigLive } from './src/effects/services/websearch-config.ts'
import {
  runWebFetch,
  type WebFetchEffectRunner,
  type WebFetchError,
  type WebFetchResult,
} from './src/effects/webfetch.ts'
import {
  runWebSearch,
  type WebSearchEffectRunner,
  type WebSearchError,
  type WebSearchResult,
} from './src/effects/websearch.ts'

const webFetchParameters = Type.Object({
  url: Type.String({ description: 'The HTTP or HTTPS URL to fetch content from' }),
  format: Type.Optional(StringEnum(FORMAT_VALUES, { description: 'The format to return: text, markdown, or html' })),
  timeout: Type.Optional(
    Type.Number({ description: `Timeout in seconds. Default ${DEFAULT_TIMEOUT_SECONDS}, max ${MAX_TIMEOUT_SECONDS}` }),
  ),
})

type WebFetchToolDefinition = EffectToolDefinition<
  typeof webFetchParameters,
  WebToolsHttp | WebToolsTemporaryOutput,
  WebFetchError,
  WebFetchDetails
>
type WebFetchRenderCallParameters = Parameters<NonNullable<WebFetchToolDefinition['renderCall']>>
type WebFetchRenderResultParameters = Parameters<NonNullable<WebFetchToolDefinition['renderResult']>>

function createWebFetchTool(
  _run?: WebFetchEffectRunner,
): EffectToolDefinition<
  typeof webFetchParameters,
  WebToolsHttp | WebToolsTemporaryOutput,
  WebFetchError,
  WebFetchDetails
> {
  return {
    name: WEBFETCH_NAME,
    label: 'webfetch',
    description: `Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: 'Fetch text or HTML content from a public web URL',
    promptGuidelines: [
      'Use webfetch when the user wants a specific public web page or document fetched.',
      'Use webfetch instead of bash curl for normal public HTTP or HTTPS retrieval.',
    ],
    parameters: webFetchParameters,
    renderCall(args: WebFetchRenderCallParameters[0], theme: WebFetchRenderCallParameters[1]): Text {
      const format = Predicate.isString(args.format) ? args.format : 'markdown'
      let target = Predicate.isString(args.url) ? args.url : ''
      try {
        target = new URL(target).host || target
      } catch {}
      return new Text(
        `${theme.fg('toolTitle', theme.bold('webfetch '))}${theme.fg('accent', target)}${theme.fg('muted', ` ${format}`)}`,
        0,
        0,
      )
    },
    renderResult(
      result: WebFetchRenderResultParameters[0],
      { expanded, isPartial }: WebFetchRenderResultParameters[1],
      theme: WebFetchRenderResultParameters[2],
    ): Text | Markdown | Container {
      if (isPartial) return new Text(theme.fg('warning', 'Fetching...'), 0, 0)
      const details = result.details as WebFetchDetails | undefined
      const content = result.content.find((item) => item.type === 'text')
      const text = content?.type === 'text' ? content.text : ''
      if (!details) return new Text(text || theme.fg('muted', 'No content'), 0, 0)
      if (!expanded) {
        let summary = theme.fg('success', details.host)
        summary += theme.fg('muted', ` • ${details.format} • ${details.mime || details.contentType || 'unknown'}`)
        summary += theme.fg('dim', ` • ${details.lineCount} lines`)
        if (details.truncated) summary += theme.fg('warning', ' • truncated')
        if (details.preview.length === 0) return new Text(summary, 0, 0)
        return new Text(`${summary}\n${theme.fg('toolOutput', details.preview.join('\n'))}`, 0, 0)
      }
      const body =
        details.format === 'markdown'
          ? new Markdown(text, 0, 0, getMarkdownTheme())
          : new Text(theme.fg('toolOutput', text), 0, 0)
      if (!details.fullOutputPath) return body
      const container = new Container()
      container.addChild(body)
      container.addChild(new Spacer(1))
      container.addChild(new Text(theme.fg('dim', `Full output: ${details.fullOutputPath}`), 0, 0))
      return container
    },
    execute: (params: Static<typeof webFetchParameters>) => runWebFetch(params),
  }
}

const webSearchParameters = Type.Object({
  query: Type.String({ description: 'Web search query' }),
  numResults: Type.Optional(
    Type.Number({ description: `Number of results to return. Default 8, max ${MAX_NUM_RESULTS}` }),
  ),
  livecrawl: Type.Optional(StringEnum(LIVECRAWL_VALUES, { description: 'Live crawl mode: fallback or preferred' })),
  type: Type.Optional(StringEnum(SEARCH_TYPE_VALUES, { description: 'Search type: auto, fast, or deep' })),
  contextMaxCharacters: Type.Optional(
    Type.Number({ description: `Maximum model context characters. Default 10000, max ${MAX_CONTEXT_CHARACTERS}` }),
  ),
})

type WebSearchToolDefinition = EffectToolDefinition<
  typeof webSearchParameters,
  WebToolsHttp | WebToolsTemporaryOutput | WebSearchConfig,
  WebSearchError,
  WebSearchDetails
>
type WebSearchRenderCallParameters = Parameters<NonNullable<WebSearchToolDefinition['renderCall']>>
type WebSearchRenderResultParameters = Parameters<NonNullable<WebSearchToolDefinition['renderResult']>>

function createWebSearchTool(
  _run?: WebSearchEffectRunner,
): EffectToolDefinition<
  typeof webSearchParameters,
  WebToolsHttp | WebToolsTemporaryOutput | WebSearchConfig,
  WebSearchError,
  WebSearchDetails
> {
  return {
    name: WEBSEARCH_NAME,
    label: 'websearch',
    description: `Search the public web for current information using Exa or Parallel. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.`,
    promptSnippet: 'Search the public web for current public information',
    promptGuidelines: [
      'Use websearch when the user needs current public web information beyond the model cutoff.',
      'Use websearch before webfetch when the user needs discovery rather than one exact URL.',
    ],
    parameters: webSearchParameters,
    renderCall(args: WebSearchRenderCallParameters[0], theme: WebSearchRenderCallParameters[1]): Text {
      const query = truncateInline(Predicate.isString(args.query) ? args.query : '', 80)
      return new Text(`${theme.fg('toolTitle', theme.bold('websearch '))}${theme.fg('accent', query)}`, 0, 0)
    },
    renderResult(
      result: WebSearchRenderResultParameters[0],
      { expanded, isPartial }: WebSearchRenderResultParameters[1],
      theme: WebSearchRenderResultParameters[2],
    ): Text | Container {
      if (isPartial) return new Text(theme.fg('warning', 'Searching...'), 0, 0)
      const details = result.details as WebSearchDetails | undefined
      const content = result.content.find((item) => item.type === 'text')
      const text = content?.type === 'text' ? content.text : ''
      if (!details) return new Text(text || theme.fg('muted', 'No results'), 0, 0)
      if (!expanded) {
        let summary = theme.fg('success', details.provider)
        summary += theme.fg('muted', ` • ${truncateInline(details.query, 80)}`)
        summary += theme.fg('dim', ` • ${details.lineCount} lines`)
        if (details.truncated) summary += theme.fg('warning', ' • truncated')
        if (details.preview.length === 0) return new Text(summary, 0, 0)
        return new Text(`${summary}\n${theme.fg('toolOutput', details.preview.join('\n'))}`, 0, 0)
      }
      const body = new Text(theme.fg('toolOutput', text), 0, 0)
      if (!details.fullOutputPath) return body
      const container = new Container()
      container.addChild(body)
      container.addChild(new Spacer(1))
      container.addChild(new Text(theme.fg('dim', `Full output: ${details.fullOutputPath}`), 0, 0))
      return container
    },
    execute: (params: Static<typeof webSearchParameters>) =>
      Effect.gen(function* () {
        const context = yield* PiToolContext
        return yield* runWebSearch(params, context.toolCallId, context.session.file ?? null)
      }),
  }
}

type WebToolsServices = WebToolsHttp | WebToolsTemporaryOutput | WebSearchConfig

type WebToolsFailure = WebFetchError | WebSearchError

const webToolsPlugin = PiExtension.define<WebToolsServices, WebToolsFailure>({
  id: 'web-tools',
  layer: Layer.mergeAll(WebToolsHttpLive, WebToolsTemporaryOutputLive, WebSearchConfigLive()),
  effect: (registrations: PiRegistrationContext<WebToolsServices, WebToolsFailure>) =>
    Effect.gen(function* () {
      yield* registrations.tools.register(createWebFetchTool())
      if (hasWebSearchCredentials()) yield* registrations.tools.register(createWebSearchTool())
      yield* registrations.events.on('tool_call', (event) => {
        if (event.toolName !== WEBFETCH_NAME) return Effect.succeed(undefined)
        const input = event.input
        const url = Predicate.isObject(input) ? input.url : undefined
        if (!Predicate.isString(url)) {
          return Effect.succeed({ block: true, reason: 'webfetch requires a string url' })
        }
        return Effect.sync(() => {
          try {
            assertSafePublicHttpUrl(url)
            return undefined
          } catch (cause) {
            return { block: true, reason: Predicate.isError(cause) ? cause.message : 'Blocked URL' }
          }
        })
      })
    }),
})

const webToolsExtension = PiExtension.install(webToolsPlugin)

export {
  createWebFetchTool,
  createWebSearchTool,
  type WebFetchResult,
  type WebSearchResult,
  webToolsExtension as default,
}
