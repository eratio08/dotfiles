import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from '@earendil-works/pi-coding-agent'
import { Effect } from 'effect'

import { FileSystem, type FileSystemError } from './services/fs.ts'
import { type PdfExtractionError, PdfExtractor } from './services/pdf.ts'

interface PdfReaderDetails {
  path: string
  pages: number
  markdownBytes: number
  truncated: boolean
  fullOutputPath?: string
}

interface PdfReaderResult {
  text: string
  details: PdfReaderDetails
}

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

export { type PdfReaderDetails, type PdfReaderResult, pagesToMarkdown, readPdf }
