import { isMainThread, parentPort } from 'node:worker_threads'
import { Lang, parse, pattern } from '@ast-grep/napi'
import type { RawAstMatch } from '../core/model.ts'
import { decodeOpensrcFailure } from './failure.ts'

interface AstParserWorkerRequest {
  readonly type: 'parse'
  readonly source: string
  readonly file: string
  readonly content: string
  readonly pattern: string
  readonly language: string
  readonly limit: number
}

interface AstParserWorkerResult {
  readonly type: 'result'
  readonly matches: readonly RawAstMatch[]
}

interface AstParserWorkerFailure {
  readonly type: 'error'
  readonly name: string
  readonly message: string
  readonly stack?: string
}

type AstParserWorkerMessage = AstParserWorkerResult | AstParserWorkerFailure

function runAstParserWorker(): void {
  if (parentPort === null) return
  const workerPort = parentPort
  workerPort.once('message', (request: AstParserWorkerRequest) => {
    Promise.resolve()
      .then(() => parseAstRequest(request))
      .then(
        (message) => workerPort.postMessage(message),
        (cause) => workerPort.postMessage(serializeAstParserError(cause)),
      )
  })
}

function parseAstRequest(request: AstParserWorkerRequest): AstParserWorkerMessage {
  const parserLanguage = toAstLanguage(request.language)
  if (parserLanguage === undefined) {
    return {
      type: 'error',
      name: 'ValidationError',
      message: `Unsupported AST language: ${request.language}`,
    }
  }
  const root = parse(parserLanguage, request.content)
  const rule = pattern(parserLanguage, request.pattern)
  const parsed = root.root().findAll(rule).slice(0, request.limit)
  const metavariableNames = [...request.pattern.matchAll(/\$+([A-Z][A-Z0-9_]*)/g)].map((match) => match[1])
  const matches = parsed.map((node): RawAstMatch => {
    const range = node.range()
    const metavars: Record<string, string> = {}
    for (const name of metavariableNames) {
      const matched = node.getMatch(name)
      if (matched) metavars[name] = matched.text()
    }
    return {
      source: request.source,
      file: request.file,
      text: node.text(),
      start: { line: range.start.line, column: range.start.column, offset: range.start.index },
      end: { line: range.end.line, column: range.end.column, offset: range.end.index },
      metavars,
    }
  })
  return { type: 'result', matches }
}

function toAstLanguage(value: string): Lang | undefined {
  const normalized = value.toLowerCase()
  if (normalized === 'javascript' || normalized === 'js') return Lang.JavaScript
  if (normalized === 'typescript' || normalized === 'ts') return Lang.TypeScript
  if (normalized === 'tsx' || normalized === 'typescriptreact') return Lang.Tsx
  if (normalized === 'html') return Lang.Html
  if (normalized === 'css') return Lang.Css
  return undefined
}

function serializeAstParserError(cause: unknown): AstParserWorkerFailure {
  const failure = decodeOpensrcFailure(cause)
  if (failure !== undefined)
    return { type: 'error', name: failure.name, message: failure.message, stack: failure.stack }
  if (cause instanceof Error) return { type: 'error', name: cause.name, message: cause.message, stack: cause.stack }
  return { type: 'error', name: 'Error', message: String(cause) }
}

export {
  type AstParserWorkerFailure,
  type AstParserWorkerMessage,
  type AstParserWorkerRequest,
  type AstParserWorkerResult,
  runAstParserWorker,
}

if (!isMainThread) runAstParserWorker()
