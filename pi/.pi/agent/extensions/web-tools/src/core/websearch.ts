import { Predicate, Schema } from 'effect'

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

interface WebSearchEnvironment {
  readonly EXA_API_KEY?: string
  readonly PARALLEL_API_KEY?: string
  readonly PI_WEBSEARCH_PROVIDER?: string
}

interface WebSearchDetails {
  provider: WebSearchProvider
  query: string
  lineCount: number
  preview: string[]
  truncated: boolean
  fullOutputPath?: string
}

interface WebSearchInput {
  query: string
  numResults?: number
  livecrawl?: (typeof LIVECRAWL_VALUES)[number]
  type?: (typeof SEARCH_TYPE_VALUES)[number]
  contextMaxCharacters?: number
}

interface WebSearchResult {
  content: [{ type: 'text'; text: string }]
  details: WebSearchDetails
}

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

export {
  clampInt,
  countLines,
  EXA_URL,
  exaUrl,
  hasWebSearchCredentials,
  LIVECRAWL_VALUES,
  MAX_CONTEXT_CHARACTERS,
  MAX_NUM_RESULTS,
  NO_RESULTS,
  PARALLEL_URL,
  PROVIDER_VALUES,
  parseSearchResponse,
  previewLines,
  SEARCH_TYPE_VALUES,
  selectProvider,
  truncateInline,
  WEBSEARCH_NAME,
  type WebSearchDetails,
  type WebSearchEnvironment,
  type WebSearchInput,
  type WebSearchProvider,
  type WebSearchResult,
}
