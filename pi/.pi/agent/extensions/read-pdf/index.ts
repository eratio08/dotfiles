import { resolve } from 'node:path'

import { type ExtensionAPI, formatSize, keyHint } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { Layer, ManagedRuntime } from 'effect'
import { Type } from 'typebox'
import { type PdfReaderDetails, pagesToMarkdown, readPdf } from './src/effects.ts'
import { FileSystemLive } from './src/services/fs.ts'
import { PdfExtractorLive } from './src/services/pdf.ts'

const parameters = Type.Object({
  path: Type.String({ description: 'Path to a PDF file, relative to the current working directory' }),
})

function readPdfExtension(pi: ExtensionAPI): void {
  const runtime = ManagedRuntime.make(Layer.mergeAll(FileSystemLive, PdfExtractorLive))
  let shuttingDown = false

  pi.on('session_shutdown', async () => {
    if (shuttingDown) return
    shuttingDown = true
    await runtime.dispose()
  })

  pi.registerTool({
    name: 'read-pdf',
    label: 'read-pdf',
    description:
      'Read a PDF file and convert its extracted text to Markdown. Output is limited to 50KB or 2000 lines; truncated output is saved to a temporary Markdown file.',
    promptSnippet: 'Read a PDF file and convert it to Markdown',
    promptGuidelines: ['Use read-pdf instead of treating a PDF as plain text.'],
    parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const path = params.path.startsWith('@') ? params.path.slice(1) : params.path
      const absolutePath = resolve(ctx.cwd, path)
      const result = await runtime.runPromise(readPdf(absolutePath, params.path), { signal })
      return {
        content: [{ type: 'text', text: result.text }],
        details: result.details,
      }
    },
    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0)
      text.setText(theme.fg('toolTitle', theme.bold('read-pdf ')) + theme.fg('muted', args.path))
      return text
    },
    renderResult(result, { expanded, isPartial }, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0)
      if (isPartial) {
        text.setText(theme.fg('warning', 'Reading PDF...'))
        return text
      }
      const content = result.content.find((item) => item.type === 'text')
      const details = result.details as PdfReaderDetails | undefined
      if (!details || context.isError) {
        text.setText(theme.fg(context.isError ? 'error' : 'muted', content?.type === 'text' ? content.text : ''))
        return text
      }
      if (expanded) {
        text.setText(theme.fg('toolOutput', content?.type === 'text' ? content.text : ''))
        return text
      }
      const size = formatSize(details.markdownBytes)
      text.setText(
        `${theme.fg('success', '✓')} ${details.pages} page${details.pages === 1 ? '' : 's'}, ${size}${theme.fg('muted', ` (${keyHint('app.tools.expand', 'to expand')})`)}`,
      )
      return text
    },
  })
}

export { type PdfReaderDetails, pagesToMarkdown, readPdf, readPdfExtension as default }
