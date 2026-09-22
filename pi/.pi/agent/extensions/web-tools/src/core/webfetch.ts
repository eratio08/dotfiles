import { convertHTMLToMarkdown, extractTextFromHTML } from '../html.ts'

const WEBFETCH_NAME = 'webfetch'
const DEFAULT_TIMEOUT_SECONDS = 30
const MAX_TIMEOUT_SECONDS = 120
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024

const FORMAT_VALUES = ['text', 'markdown', 'html'] as const

type WebFetchFormat = (typeof FORMAT_VALUES)[number]

interface WebFetchDetails {
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

interface WebFetchInput {
  url: string
  format?: WebFetchFormat
  timeout?: number
}

interface WebFetchResult {
  content: [{ type: 'text'; text: string }]
  details: WebFetchDetails
}

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

export {
  acceptHeaderForFormat,
  assertSafePublicHttpUrl,
  browserUserAgent,
  clampTimeout,
  convertContent,
  countLines,
  DEFAULT_TIMEOUT_SECONDS,
  FORMAT_VALUES,
  isTextualMime,
  MAX_RESPONSE_BYTES,
  MAX_TIMEOUT_SECONDS,
  mimeFrom,
  normalizeHost,
  previewLines,
  truncateInline,
  WEBFETCH_NAME,
  type WebFetchDetails,
  type WebFetchFormat,
  type WebFetchInput,
  type WebFetchResult,
}
