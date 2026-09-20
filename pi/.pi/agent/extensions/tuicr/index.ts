import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  formatSize,
  keyHint,
  truncateHead,
} from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { type Effect, Layer, ManagedRuntime, Schema } from 'effect'
import { Type } from 'typebox'
import { type CommentData, type TuicrToolInput, TuicrToolInputSchema } from './src/core.ts'
import { Tuicr, TuicrConfig, TuicrLayer, type TuicrOpenResult, TuicrPi } from './src/effects.ts'

const Parameters = Type.Object({
  scope: Type.Union([
    Type.Object({ type: Type.Literal('working-tree') }),
    Type.Object({ type: Type.Literal('revisions'), revset: Type.String({ minLength: 1 }) }),
  ]),
})

type TuicrToolDetails = {
  readonly paneId: string
  readonly sessionSlug?: string
  readonly scope: TuicrOpenResult['pane']['scope']
  readonly comments: readonly CommentData[]
}

function commentOutput(comments: readonly CommentData[]): string {
  if (comments.length === 0) return 'No user comments.'
  const output = comments.map((comment) => `${comment.location}: ${comment.content}`).join('\n')
  const truncation = truncateHead(output, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES })
  if (!truncation.truncated) return output
  return `${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`
}

function resultText(result: {
  readonly content: readonly { readonly type: string; readonly text?: string }[]
}): string {
  const text = result.content.find((item) => item.type === 'text')
  return text?.text ?? ''
}

function failureMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error)
}

function reviewText(details: TuicrToolDetails): string {
  const session = details.sessionSlug ? ` for session ${details.sessionSlug}` : ''
  return `User completed the tuicr review${session}.\n${commentOutput(details.comments)}`
}

async function resolveRepositoryRoot(pi: ExtensionAPI, cwd: string, signal?: AbortSignal): Promise<string> {
  try {
    const result = await pi.exec('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { signal })
    const root = result.stdout.trim()
    if (result.code === 0 && root) return root
  } catch {
    return cwd
  }
  return cwd
}

function tuicrExtension(pi: ExtensionAPI): void {
  const runtime = ManagedRuntime.make(
    TuicrLayer.pipe(Layer.provide(Layer.succeed(TuicrPi, pi)), Layer.provide(Layer.succeed(TuicrConfig, {}))),
  )
  let shuttingDown = false

  const run = <A, E>(
    use: (service: Tuicr['Service']) => Effect.Effect<A, E, Tuicr>,
    signal?: AbortSignal,
  ): Promise<A> => runtime.runPromise(Tuicr.use(use), { signal })

  pi.registerTool({
    name: 'tuicr',
    label: 'tuicr user review',
    description:
      'Open tuicr in a Herdr pane for a user-led review, wait for the user to exit, and return user comments. Never inspect diffs or write review findings.',
    promptSnippet: 'Use tuicr for a blocking user-led review that returns comments when the user exits',
    promptGuidelines: [
      'Use tuicr when the user asks to start a review; it blocks until the user exits the TUI.',
      'The user performs the review manually in the tuicr TUI.',
      'tuicr returns normalized user comments after the user exits.',
      'Never inspect diffs, generate findings, suggest findings, or write review comments.',
    ],
    parameters: Parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const input = Schema.decodeUnknownSync(TuicrToolInputSchema)(params as unknown) as TuicrToolInput
      if (ctx.mode !== 'tui') {
        throw new Error('tuicr requires Pi TUI mode')
      }

      try {
        const repo = await resolveRepositoryRoot(pi, ctx.cwd, signal)
        const opened = await run((service) => service.open(repo, input.scope), signal)
        const details: TuicrToolDetails = {
          paneId: opened.pane.paneId,
          sessionSlug: opened.session?.slug,
          scope: opened.pane.scope,
          comments: opened.comments,
        }
        return { content: [{ type: 'text', text: reviewText(details) }], details }
      } catch (error) {
        throw new Error(failureMessage(error))
      }
    },
    renderCall(_args, theme) {
      return new Text(theme.fg('toolTitle', theme.bold('tuicr review')), 0, 0)
    },
    renderResult(result, { expanded }, theme, context) {
      const content = resultText(result)
      if (context.isError) return new Text(theme.fg('error', content), 0, 0)
      const details = result.details as TuicrToolDetails | undefined
      if (!details) return new Text(theme.fg('muted', content), 0, 0)
      if (expanded) return new Text(theme.fg('toolOutput', content), 0, 0)

      const session = details.sessionSlug ? ` session ${theme.fg('muted', details.sessionSlug)}` : ''
      return new Text(
        `${theme.fg('success', '✓')} tuicr${session} · ${details.comments.length} comment${details.comments.length === 1 ? '' : 's'}${theme.fg('muted', ` (${keyHint('app.tools.expand', 'to expand')})`)}`,
        0,
        0,
      )
    },
  })

  pi.on('session_shutdown', async (_event, ctx) => {
    if (shuttingDown) return
    shuttingDown = true
    try {
      await run((service) => service.shutdown(), ctx.signal)
    } finally {
      await runtime.dispose()
    }
  })
}

export { tuicrExtension as default }
