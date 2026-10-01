import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, Schema } from 'effect'
import { extractText } from 'unpdf'

class FileSystemError extends Schema.TaggedError<FileSystemError>()('FileSystemError', {
  operation: Schema.String,
  path: Schema.String,
  cause: Schema.Unknown,
}) {}

class FileSystem extends Context.Service<
  FileSystem,
  {
    readonly readFile: (path: string) => Effect.Effect<Uint8Array, FileSystemError>
    readonly writeTemporaryMarkdown: (content: string) => Effect.Effect<string, FileSystemError>
  }
>()('read-pdf/services/FileSystem') {}

function toFileSystemError(operation: string, path: string, cause: unknown): FileSystemError {
  return new FileSystemError({ operation, path, cause })
}

function tryFileSystem<A>(
  operation: string,
  path: string,
  execute: (signal: AbortSignal) => PromiseLike<A>,
): Effect.Effect<A, FileSystemError> {
  return Effect.tryPromise({
    try: execute,
    catch: (cause: unknown) => toFileSystemError(operation, path, cause),
  })
}

const readFile = Effect.fn('FileSystem.readFile')(function* (
  path: string,
): Effect.fn.Return<Uint8Array, FileSystemError> {
  return yield* tryFileSystem('readFile', path, (signal) => fs.readFile(path, { signal }))
})

const writeTemporaryMarkdown = Effect.fn('FileSystem.writeTemporaryMarkdown')(function* (
  content: string,
): Effect.fn.Return<string, FileSystemError> {
  const path = yield* Effect.sync(() => join(tmpdir(), `pi-read-pdf-${randomUUID()}.md`))
  yield* tryFileSystem('writeFile', path, (signal) => fs.writeFile(path, content, { encoding: 'utf8', signal }))
  return path
})

const FileSystemLive: Layer.Layer<FileSystem> = Layer.succeed(
  FileSystem,
  FileSystem.of({ readFile, writeTemporaryMarkdown }),
)

type PdfExtraction = { readonly pages: readonly string[]; readonly totalPages: number }

class PdfExtractionError extends Schema.TaggedError<PdfExtractionError>()('PdfExtractionError', {
  cause: Schema.Unknown,
}) {}

class PdfExtractor extends Context.Service<
  PdfExtractor,
  {
    readonly extract: (data: Uint8Array) => Effect.Effect<PdfExtraction, PdfExtractionError>
  }
>()('read-pdf/services/PdfExtractor') {}

const extract = Effect.fn('PdfExtractor.extract')(function* (
  data: Uint8Array,
): Effect.fn.Return<PdfExtraction, PdfExtractionError> {
  return yield* Effect.tryPromise({
    try: async (signal: AbortSignal) => {
      if (signal.aborted) throw new Error('Operation aborted')
      const result = await extractText(new Uint8Array(data), { mergePages: false })
      if (signal.aborted) throw new Error('Operation aborted')
      return { pages: result.text, totalPages: result.totalPages }
    },
    catch: (cause: unknown) => new PdfExtractionError({ cause }),
  })
})

const PdfExtractorLive: Layer.Layer<PdfExtractor> = Layer.succeed(PdfExtractor, PdfExtractor.of({ extract }))

type PdfReaderDetails = {
  path: string
  pages: number
  markdownBytes: number
  truncated: boolean
  fullOutputPath?: string
}

type PdfReaderResult = { text: string; details: PdfReaderDetails }

function pagesToMarkdown(pages: readonly string[]): string {
  return pages
    .map((page, index) => {
      const lines = page
        .replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      const paragraphs: string[] = []
      let paragraph: string[] = []
      for (const line of lines) {
        if (line) {
          paragraph.push(line)
        } else if (paragraph.length > 0) {
          paragraphs.push(paragraph.join('\n'))
          paragraph = []
        }
      }
      if (paragraph.length > 0) paragraphs.push(paragraph.join('\n'))
      return `# Page ${index + 1}${paragraphs.length > 0 ? `\n\n${paragraphs.join('\n\n')}` : ''}`
    })
    .join('\n\n')
}

const readPdf = Effect.fn('readPdf')(function* (
  path: string,
  displayPath = path,
): Effect.fn.Return<PdfReaderResult, FileSystemError | PdfExtractionError, FileSystem | PdfExtractor> {
  const fileSystem = yield* FileSystem
  const pdfExtractor = yield* PdfExtractor
  const bytes = yield* fileSystem.readFile(path)
  const extraction = yield* pdfExtractor.extract(bytes)
  const markdown = pagesToMarkdown(extraction.pages)
  const truncation = truncateHead(markdown, {
    maxBytes: DEFAULT_MAX_BYTES,
    maxLines: DEFAULT_MAX_LINES,
  })
  let text = truncation.content
  let fullOutputPath: string | undefined
  if (truncation.truncated) {
    fullOutputPath = yield* fileSystem.writeTemporaryMarkdown(markdown)
    text += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${fullOutputPath}]`
  }
  return {
    text,
    details: {
      path: displayPath,
      pages: extraction.totalPages,
      markdownBytes: Buffer.byteLength(markdown),
      truncated: truncation.truncated,
      fullOutputPath,
    },
  }
})

export {
  FileSystem,
  FileSystemError,
  FileSystemLive,
  type PdfExtraction,
  PdfExtractionError,
  PdfExtractor,
  PdfExtractorLive,
  type PdfReaderDetails,
  type PdfReaderResult,
  pagesToMarkdown,
  readPdf,
}
