import { type ExtensionAPI, keyHint } from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import { type Effect, ManagedRuntime, Schema } from 'effect'
import { Type } from 'typebox'
import { type CommentData, type TuicrToolInput, TuicrToolInputSchema } from './core.ts'
import { Tuicr, TuicrLayer, type TuicrOpenResult } from './effects.ts'

const Parameters = Type.Union([
  Type.Object({
    action: Type.Literal('open'),
    scope: Type.Object({ type: Type.Literal('working-tree') }),
  }),
  Type.Object({
    action: Type.Literal('open'),
    scope: Type.Object({ type: Type.Literal('revisions'), revset: Type.String({ minLength: 1 }) }),
  }),
  Type.Object({ action: Type.Literal('comments') }),
  Type.Object({ action: Type.Literal('close') }),
])

type TuicrToolDetails =
  | {
      readonly action: 'open'
      readonly paneId: string
      readonly sessionSlug: string
      readonly scope: TuicrOpenResult['pane']['scope']
      readonly comments: readonly CommentData[]
    }
  | { readonly action: 'comments'; readonly comments: readonly CommentData[] }
  | { readonly action: 'close' }

function commentOutput(comments: readonly CommentData[]): string {
  if (comments.length === 0) return 'No user comments.'
  return comments.map((comment) => `${comment.location}: ${comment.content}`).join('\n')
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

function openText(details: Extract<TuicrToolDetails, { action: 'open' }>): string {
  return `User completed the tuicr review for session ${details.sessionSlug}.\n${commentOutput(details.comments)}`
}

export default function tuicrExtension(pi: ExtensionAPI): void {
  const runtime = ManagedRuntime.make(TuicrLayer(pi))
  let shuttingDown = false

  const run = <A, E>(
    use: (service: Tuicr['Service']) => Effect.Effect<A, E, Tuicr>,
    signal?: AbortSignal,
  ): Promise<A> => runtime.runPromise(Tuicr.use(use), { signal })

  pi.registerTool({
    name: 'tuicr',
    label: 'tuicr user review',
    description:
      'Open tuicr for a user-led review and wait for the user to exit, return the user comments, retrieve comments later, or close the owned Herdr pane. Never inspect diffs or write review findings.',
    promptSnippet: 'Use tuicr for a blocking user-led TUI review that returns comments when the user exits',
    promptGuidelines: [
      'Use open only when the user asks to start a tuicr review; it blocks until the user exits the TUI.',
      'The user performs the review manually in the tuicr TUI.',
      'Open returns normalized user comments after the user exits; use comments to retrieve them again later.',
      'Use close to close only the Herdr pane opened by this extension.',
      'Never inspect diffs, generate findings, suggest findings, or write review comments.',
    ],
    parameters: Parameters,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const input = Schema.decodeUnknownSync(TuicrToolInputSchema)(params as unknown) as TuicrToolInput
      if (ctx.mode !== 'tui') {
        throw new Error('tuicr requires Pi TUI mode')
      }

      try {
        switch (input.action) {
          case 'open': {
            const opened = await run((service) => service.open(ctx.cwd, input.scope), signal)
            const details: TuicrToolDetails = {
              action: 'open',
              paneId: opened.pane.paneId,
              sessionSlug: opened.session.slug,
              scope: opened.pane.scope,
              comments: opened.comments,
            }
            return { content: [{ type: 'text', text: openText(details) }], details }
          }
          case 'comments': {
            const comments = await run((service) => service.comments(), signal)
            const details: TuicrToolDetails = { action: 'comments', comments }
            return { content: [{ type: 'text', text: commentOutput(comments) }], details }
          }
          case 'close': {
            await run((service) => service.close(), signal)
            const details: TuicrToolDetails = { action: 'close' }
            return {
              content: [{ type: 'text', text: 'Closed the tuicr Herdr pane owned by this extension.' }],
              details,
            }
          }
        }
      } catch (error) {
        throw new Error(failureMessage(error))
      }
    },
    renderCall(args, theme) {
      return new Text(theme.fg('toolTitle', theme.bold('tuicr ')) + theme.fg('muted', args.action ?? 'review'), 0, 0)
    },
    renderResult(result, { expanded }, theme, context) {
      const content = resultText(result)
      if (context.isError) return new Text(theme.fg('error', content), 0, 0)
      const details = result.details as TuicrToolDetails | undefined
      if (!details) return new Text(theme.fg('muted', content), 0, 0)
      if (expanded) return new Text(theme.fg('toolOutput', content), 0, 0)

      if (details.action === 'comments') {
        return new Text(
          `${theme.fg('success', '✓')} ${details.comments.length} user comment${details.comments.length === 1 ? '' : 's'}${theme.fg('muted', ` (${keyHint('app.tools.expand', 'to expand')})`)}`,
          0,
          0,
        )
      }
      if (details.action === 'open') {
        return new Text(
          `${theme.fg('success', '✓')} tuicr session ${theme.fg('muted', details.sessionSlug)} · ${details.comments.length} comment${details.comments.length === 1 ? '' : 's'}${theme.fg('muted', ` (${keyHint('app.tools.expand', 'to expand')})`)}`,
          0,
          0,
        )
      }
      return new Text(`${theme.fg('success', '✓')} tuicr pane closed`, 0, 0)
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
