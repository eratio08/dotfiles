import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExtensionAPI,
  formatSize,
  keyHint,
  truncateHead,
} from '@earendil-works/pi-coding-agent'
import { Container, Text } from '@earendil-works/pi-tui'
import { Effect } from 'effect'
import { type Static, Type } from 'typebox'
import { OPENSRC_PROMPT } from './src/core/code-mode.ts'
import type { OpensrcFailure, OpensrcToolDetails } from './src/core/model.ts'
import { createOpensrcFailure } from './src/core/model.ts'
import { decodeOpensrcFailure, failureFromUnknown } from './src/effects/failure.ts'
import { serializeValue } from './src/effects/output.ts'
import { createOpensrcRuntime, type OpensrcRuntimeResult } from './src/effects/runtime.ts'

type OpensrcInput = Static<typeof OpensrcParameters>

interface OpensrcRendererState {
  call?: Text
  callText?: string
  hasResult?: boolean
  summary?: string
}

const OpensrcParameters = Type.Object({
  code: Type.String({
    description: 'TypeScript module that exports a default async function receiving OpensrcApi.',
    minLength: 1,
  }),
})

const OPENSRC_ERROR_PREFIX = 'opensrc execution failed'

function opensrcExtension(pi: ExtensionAPI): void {
  const runtime = createOpensrcRuntime()
  pi.registerTool({
    name: 'opensrc',
    label: 'OpenSrc',
    description: "Give coding agents access to any package's source code.",
    promptSnippet: 'Compose dependency source queries and fetches in one TypeScript program',
    promptGuidelines: [OPENSRC_PROMPT],
    parameters: OpensrcParameters,
    executionMode: 'sequential',
    execute(_toolCallId, params: OpensrcInput, signal, _onUpdate, context) {
      return runtime
        .run(params.code, pi, context, signal, (execution: OpensrcRuntimeResult) =>
          Effect.gen(function* () {
            const output = yield* formatOpensrcOutput(execution.value)
            const code = yield* Effect.try({
              try: () => formatSubmittedCode(params.code),
              catch: (cause) =>
                failureFromUnknown(cause, 'runtime', 'format', 'The opensrc output could not be formatted.'),
            })
            return {
              content: [{ type: 'text' as const, text: output.output }],
              details: {
                ...output,
                code: code.output,
                codeTruncated: code.truncated,
                operations: execution.operations,
              },
            }
          }),
        )
        .catch((cause) =>
          Promise.reject(
            createOpensrcFailure({
              _tag: 'runtime',
              operation: 'execute',
              message: `${OPENSRC_ERROR_PREFIX}: ${formatFailure(cause)}`,
              cause,
            }),
          ),
        )
    },
    renderCall(_args, theme, context) {
      const state = (context.state ?? {}) as OpensrcRendererState
      const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0)
      state.call = text
      state.callText = theme.fg('toolTitle', theme.bold('opensrc'))
      const summary = !context.expanded && state.hasResult && state.summary ? ` · ${state.summary}` : ''
      const hint =
        !context.expanded && state.hasResult
          ? ` ${theme.fg('muted', `(${keyHint('app.tools.expand', 'to expand')})`)}`
          : ''
      text.setText(`${state.callText}${summary}${hint}`)
      return text
    },
    renderResult(result, { expanded }, theme, context) {
      const state = (context.state ?? {}) as OpensrcRendererState
      const details = result.details as Partial<OpensrcToolDetails> | undefined
      const output = typeof details?.output === 'string' ? details.output : resultText(result)
      const summary = details?.operations ? formatOperationSummary(details.operations) : undefined
      state.hasResult = true
      state.summary = summary
      if (context.isError) return new Text(theme.fg('error', output), 0, 0)
      if (expanded) {
        const code = typeof details?.code === 'string' ? details.code : ''
        return new Text(
          `${theme.fg('toolTitle', 'Source')}
${theme.fg('toolOutput', code)}

${theme.fg('toolTitle', 'Response')}
${theme.fg('toolOutput', output)}`,
          0,
          0,
        )
      }
      if (state.call && state.callText) {
        const collapsedSummary = summary ? ` · ${summary}` : ''
        state.call.setText(
          `${state.callText}${collapsedSummary} ${theme.fg('muted', `(${keyHint('app.tools.expand', 'to expand')})`)}`,
        )
      }
      return new Container()
    },
  })
  pi.on('session_shutdown', async () => {
    await runtime.dispose()
  })
}

function formatOpensrcOutput(value: unknown): Effect.Effect<{ output: string; truncated: boolean }, OpensrcFailure> {
  return serializeValue(value).pipe(
    Effect.mapError((cause) =>
      createOpensrcFailure({
        _tag: 'runtime',
        operation: 'format',
        message: 'The opensrc output could not be formatted.',
        cause,
      }),
    ),
    Effect.map((rawOutput) => {
      const truncation = truncateHead(rawOutput)
      if (!truncation.truncated) return { output: rawOutput, truncated: false }
      return {
        output: `${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`,
        truncated: true,
      }
    }),
  )
}

function formatSubmittedCode(code: string): { output: string; truncated: boolean } {
  const truncation = truncateHead(code, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES })
  if (!truncation.truncated) return { output: code, truncated: false }
  return {
    output: `${truncation.content}\n\n[Code truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`,
    truncated: true,
  }
}

function formatOperationSummary(operations: Readonly<Record<string, number>> | undefined): string {
  const entries = Object.entries(operations ?? {})
  if (entries.length === 0) return 'no operations'
  return entries.map(([operation, count]) => `${operation}: ${count}`).join(', ')
}

function resultText(result: { content: readonly { type: string; text?: string }[] }): string {
  const text = result.content.find((item) => item.type === 'text')
  return text?.text ?? ''
}

function formatFailure(error: unknown): string {
  const failure = decodeOpensrcFailure(error)
  if (failure !== undefined) return `${failure.operation}: ${failure.message}`
  if (error instanceof Error) return error.message
  return 'The TypeScript program failed.'
}

export { opensrcExtension as default }
