import { describe, test } from 'bun:test'
import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ExtensionAPI, initTheme } from '@earendil-works/pi-coding-agent'
import { Cause, Effect, Exit, Layer, ManagedRuntime } from 'effect'

import readPdfExtension from '../index.ts'
import { type PdfReaderDetails, pagesToMarkdown, readPdf } from '../src/effects.ts'
import { FileSystem, FileSystemError, FileSystemLive } from '../src/services/fs.ts'
import { PdfExtractionError, PdfExtractor, PdfExtractorLive } from '../src/services/pdf.ts'

function pdfWithText(text: string): Buffer {
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${text}) Tj\nET\n`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf)
}

function replacementPdfExtractor(pages: readonly string[], totalPages = pages.length): PdfExtractor['Service'] {
  return PdfExtractor.of({ extract: () => Effect.succeed({ pages, totalPages }) })
}

function replacementFileSystem(bytes = new Uint8Array()): FileSystem['Service'] {
  return FileSystem.of({
    readFile: () => Effect.succeed(bytes),
    writeTemporaryMarkdown: () => Effect.succeed('/tmp/pi-read-pdf-test.md'),
  })
}

function replacementLayer(
  fileSystem: FileSystem['Service'],
  pdfExtractor: PdfExtractor['Service'],
): Layer.Layer<FileSystem | PdfExtractor> {
  return Layer.mergeAll(Layer.succeed(FileSystem, fileSystem), Layer.succeed(PdfExtractor, pdfExtractor))
}

type ReadPdfTool = {
  name: string
  promptSnippet: string
  execute: (...args: unknown[]) => Promise<unknown>
  renderResult: (...args: unknown[]) => { render(width: number): string[] }
}

type LoadedTool = {
  tool: ReadPdfTool
  shutdown: () => Promise<void>
}

type ReadPdfToolResult = {
  content: readonly { type: string; text: string }[]
  details: PdfReaderDetails
}

function loadTool(): LoadedTool {
  let tool: ReadPdfTool | undefined
  let shutdown: (() => Promise<void>) | undefined
  readPdfExtension({
    registerTool(candidate: unknown) {
      tool = candidate as ReadPdfTool
    },
    on(event: string, handler: unknown) {
      if (event === 'session_shutdown') shutdown = handler as () => Promise<void>
    },
  } as unknown as ExtensionAPI)
  assert.ok(tool)
  assert.ok(shutdown)
  assert.equal(tool.name, 'read-pdf')
  assert.equal(tool.promptSnippet, 'Read a PDF file and convert it to Markdown')
  return { tool, shutdown }
}

const theme = {
  fg: (_role: string, text: string) => text,
  bold: (text: string) => text,
}

describe('read-pdf effects', () => {
  test('converts extracted pages into Markdown headings and paragraphs', () => {
    //given
    const pages = ['Title\n\nFirst paragraph\nsecond line', '  Another page  ']

    //when
    const markdown = pagesToMarkdown(pages)

    //then
    assert.equal(markdown, '# Page 1\n\nTitle\n\nFirst paragraph\nsecond line\n\n# Page 2\n\nAnother page')
  })

  test('runs the PDF pipeline with replacement services', async () => {
    //given
    let writes = 0
    const fileSystem = FileSystem.of({
      readFile: (path) => {
        assert.equal(path, '/input.pdf')
        return Effect.succeed(new Uint8Array([1, 2, 3]))
      },
      writeTemporaryMarkdown: () => {
        writes += 1
        return Effect.succeed('/tmp/pi-read-pdf-test.md')
      },
    })
    const runtime = ManagedRuntime.make(
      replacementLayer(fileSystem, replacementPdfExtractor(['Title\n\nBody', 'Next'], 2)),
    )

    try {
      //when
      const result = await runtime.runPromise(readPdf('/input.pdf', 'input.pdf'))

      //then
      assert.deepEqual(result, {
        text: '# Page 1\n\nTitle\n\nBody\n\n# Page 2\n\nNext',
        details: {
          path: 'input.pdf',
          pages: 2,
          markdownBytes: Buffer.byteLength('# Page 1\n\nTitle\n\nBody\n\n# Page 2\n\nNext'),
          truncated: false,
          fullOutputPath: undefined,
        },
      })
      assert.equal(writes, 0)
    } finally {
      await runtime.dispose()
    }
  })

  test('extracts text from a real PDF with the live layers', async () => {
    //given
    const root = await mkdtemp(join(tmpdir(), 'pi-read-pdf-real-test-'))
    const path = join(root, 'sample.pdf')
    await writeFile(path, pdfWithText('Hello PDF'))
    const runtime = ManagedRuntime.make(Layer.mergeAll(FileSystemLive, PdfExtractorLive))

    try {
      //when
      const result = await runtime.runPromise(readPdf(path))

      //then
      assert.equal(result.text, '# Page 1\n\nHello PDF')
      assert.equal(result.details.pages, 1)
      assert.equal(result.details.truncated, false)
    } finally {
      await runtime.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  test('returns a typed failure from a replacement FileSystem layer', async () => {
    //given
    const expected = new FileSystemError({ operation: 'readFile', path: '/missing.pdf', cause: 'missing' })
    const fileSystem = FileSystem.of({
      readFile: () => Effect.fail(expected),
      writeTemporaryMarkdown: () => Effect.succeed('/tmp/pi-read-pdf-test.md'),
    })
    const runtime = ManagedRuntime.make(replacementLayer(fileSystem, replacementPdfExtractor(['unused'])))

    try {
      //when
      const exit = await runtime.runPromise(Effect.exit(readPdf('/missing.pdf')))

      //then
      assert.equal(Exit.isFailure(exit), true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        assert.ok(failure)
        if (failure) {
          assert.equal(failure.error, expected)
          assert.ok(failure.error instanceof FileSystemError)
          assert.equal(failure.error.operation, 'readFile')
          assert.equal(failure.error.path, '/missing.pdf')
        }
      }
    } finally {
      await runtime.dispose()
    }
  })

  test('returns a typed failure from a replacement PdfExtractor layer', async () => {
    //given
    const expected = new PdfExtractionError({ cause: 'invalid PDF' })
    const extractor = PdfExtractor.of({ extract: () => Effect.fail(expected) })
    const runtime = ManagedRuntime.make(replacementLayer(replacementFileSystem(), extractor))

    try {
      //when
      const exit = await runtime.runPromise(Effect.exit(readPdf('/input.pdf')))

      //then
      assert.equal(Exit.isFailure(exit), true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        assert.ok(failure)
        if (failure) {
          assert.equal(failure.error, expected)
          assert.ok(failure.error instanceof PdfExtractionError)
          assert.equal(failure.error.cause, 'invalid PDF')
        }
      }
    } finally {
      await runtime.dispose()
    }
  })

  test('writes complete output when the pipeline truncates the result', async () => {
    //given
    const root = await mkdtemp(join(tmpdir(), 'pi-read-pdf-truncation-test-'))
    const input = join(root, 'sample.pdf')
    await writeFile(input, pdfWithText('ignored'))
    const pages = Array.from({ length: 1200 }, (_, index) => `line ${index + 1}`)
    const fullMarkdown = pagesToMarkdown(pages)
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(FileSystemLive, Layer.succeed(PdfExtractor, replacementPdfExtractor(pages, pages.length))),
    )
    let fullOutputPath: string | undefined

    try {
      //when
      const result = await runtime.runPromise(readPdf(input))

      //then
      fullOutputPath = result.details.fullOutputPath
      assert.equal(result.details.truncated, true)
      assert.ok(fullOutputPath)
      assert.match(result.text, /Output truncated/)
      assert.equal(result.details.markdownBytes, Buffer.byteLength(fullMarkdown))
      assert.equal(await readFile(fullOutputPath, 'utf8'), fullMarkdown)
    } finally {
      await runtime.dispose()
      if (fullOutputPath) await rm(fullOutputPath, { force: true })
      await rm(root, { recursive: true, force: true })
    }
  })

  test('cancels the pipeline through the runtime signal option', async () => {
    //given
    const controller = new AbortController()
    controller.abort()
    const fileSystem = FileSystem.of({
      readFile: () => Effect.never,
      writeTemporaryMarkdown: () => Effect.succeed('/tmp/pi-read-pdf-test.md'),
    })
    const runtime = ManagedRuntime.make(replacementLayer(fileSystem, replacementPdfExtractor(['unused'])))

    try {
      //when
      const promise = runtime.runPromise(readPdf('/input.pdf'), { signal: controller.signal })

      //then
      await assert.rejects(promise)
    } finally {
      await runtime.dispose()
    }
  })
})

describe('read-pdf tool', () => {
  test('renders compact and expanded results', async () => {
    //given
    const root = await mkdtemp(join(tmpdir(), 'pi-read-pdf-render-test-'))
    const path = join(root, 'sample.pdf')
    await writeFile(path, pdfWithText('Hello PDF'))
    initTheme('dark')
    const loaded = loadTool()

    try {
      //when
      const result = await loaded.tool.execute('call-1', { path: 'sample.pdf' }, undefined, undefined, { cwd: root })

      //then
      const output = result as ReadPdfToolResult
      assert.equal(output.content[0]?.type, 'text')
      assert.equal(output.details.pages, 1)
      const compact = loaded.tool.renderResult(output, { expanded: false, isPartial: false }, theme, { isError: false })
      const expanded = loaded.tool.renderResult(output, { expanded: true, isPartial: false }, theme, { isError: false })
      assert.match(compact.render(80).join('\n'), /1 page/)
      assert.match(expanded.render(80).join('\n'), /# Page 1[\s\S]*Hello PDF/)
      await loaded.shutdown()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('disposes the runtime during session shutdown', async () => {
    //given
    const loaded = loadTool()

    //when
    await loaded.shutdown()

    //then
    await assert.rejects(loaded.tool.execute('call-1', { path: 'sample.pdf' }, undefined, undefined, { cwd: tmpdir() }))
  })
})
