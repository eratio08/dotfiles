import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type ExecResult,
  formatSize,
  keyHint,
  type TruncationResult,
  truncateHead,
} from '@earendil-works/pi-coding-agent'
import { Text } from '@earendil-works/pi-tui'
import {
  type EffectToolDefinition,
  PiExtension,
  PiOperationsError,
  type PiPlugin,
  PiProcess,
  type PiRegistrationContext,
  PiToolContext,
  PiToolError,
  type PiToolResult,
} from '@eratio/pi-effect'
import { Effect } from 'effect'
import { type Static, Type } from 'typebox'

type AstGrepToolName = 'ast_grep_search' | 'ast_grep_rewrite'

type AstGrepDetails = {
  readonly output: string
  readonly summary: string
  readonly truncated: boolean
  readonly fullOutputPath?: string
  readonly truncationNotice?: string
}

type AstGrepFailure = PiOperationsError | PiToolError

type FormattedAstGrepOutput = {
  readonly text: string
  readonly notice?: string
}

const astGrepSearchParameters = Type.Object({
  pattern: Type.String({ description: 'AST pattern to match' }),
  path: Type.Optional(Type.String({ description: 'Path to search' })),
  lang: Type.Optional(
    Type.Union([
      Type.Literal('typescript'),
      Type.Literal('tsx'),
      Type.Literal('javascript'),
      Type.Literal('python'),
      Type.Literal('rust'),
      Type.Literal('go'),
      Type.Literal('java'),
      Type.Literal('c'),
      Type.Literal('cpp'),
      Type.Literal('csharp'),
      Type.Literal('kotlin'),
      Type.Literal('swift'),
      Type.Literal('ruby'),
      Type.Literal('lua'),
      Type.Literal('elixir'),
      Type.Literal('html'),
      Type.Literal('css'),
      Type.Literal('json'),
      Type.Literal('yaml'),
    ]),
  ),
  json: Type.Optional(Type.Boolean({ description: 'Output as JSON' })),
})

const astGrepRewriteParameters = Type.Object({
  pattern: Type.String({ description: 'AST pattern to match' }),
  rewrite: Type.String({ description: 'Replacement pattern' }),
  path: Type.Optional(Type.String({ description: 'Path to transform' })),
  lang: Type.Optional(Type.String({ description: 'Language hint' })),
})

type AstGrepSearchToolDefinition = EffectToolDefinition<
  typeof astGrepSearchParameters,
  PiProcess,
  AstGrepFailure,
  AstGrepDetails
>

type AstGrepRewriteToolDefinition = EffectToolDefinition<
  typeof astGrepRewriteParameters,
  PiProcess,
  AstGrepFailure,
  AstGrepDetails
>

type AstGrepSearchRenderParameters = Parameters<NonNullable<AstGrepSearchToolDefinition['renderResult']>>

type AstGrepRewriteRenderParameters = Parameters<NonNullable<AstGrepRewriteToolDefinition['renderResult']>>

type AstGrepRenderParameters = AstGrepSearchRenderParameters | AstGrepRewriteRenderParameters

type AstGrepParameters = Static<typeof astGrepSearchParameters> | Static<typeof astGrepRewriteParameters>

function createAstGrepCommandArgs(params: AstGrepParameters): string[] {
  const args = ['--pattern', params.pattern]
  if ('rewrite' in params) args.push('--rewrite', params.rewrite, '--update-all')
  if (params.lang) args.push('--lang', params.lang)
  if ('json' in params && params.json) args.push('--json')
  args.push(params.path ?? '.')
  return args
}

function formatAstGrepOutput(truncation: TruncationResult, fullOutputPath?: string): FormattedAstGrepOutput {
  if (!truncation.truncated) return { text: truncation.content }

  const omittedLines = truncation.totalLines - truncation.outputLines
  const omittedBytes = truncation.totalBytes - truncation.outputBytes
  const savedOutput = fullOutputPath ? ` Full output saved to: ${fullOutputPath}.` : ''
  const notice = `[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ${omittedLines} lines (${formatSize(omittedBytes)}) omitted.${savedOutput}]`
  return { text: `${truncation.content}\n\n${notice}`, notice }
}

function createAstGrepToolResult(
  output: string,
  truncation: TruncationResult,
  successSummary: string,
  emptyOutput: string,
  fullOutputPath?: string,
): PiToolResult<AstGrepDetails> {
  const formattedOutput = formatAstGrepOutput(truncation, fullOutputPath)
  const hasOutput = output.length > 0

  return {
    content: [{ type: 'text', text: hasOutput ? formattedOutput.text : emptyOutput }],
    details: {
      output: truncation.content,
      summary: hasOutput ? successSummary : emptyOutput,
      truncated: truncation.truncated,
      ...(fullOutputPath ? { fullOutputPath } : {}),
      ...(formattedOutput.notice ? { truncationNotice: formattedOutput.notice } : {}),
    },
  }
}

const runAstGrep: (
  args: string[],
  signal: AbortSignal | undefined,
) => Effect.Effect<ExecResult, PiOperationsError, PiProcess> = Effect.fnUntraced(function* (
  args: string[],
  signal: AbortSignal | undefined,
) {
  const piProcess = yield* PiProcess
  return yield* piProcess.exec('ast-grep', args, { signal })
})

const saveAstGrepOutput = Effect.fnUntraced(function* (output: string) {
  return yield* Effect.tryPromise({
    try: async () => {
      const directory = await mkdtemp(join(tmpdir(), 'pi-ast-grep-'))
      const outputPath = join(directory, 'output.txt')
      await writeFile(outputPath, output, 'utf8')
      return outputPath
    },
    catch: (cause: unknown) =>
      new PiOperationsError({
        operation: 'save full ast-grep output',
        message: `Could not save full ast-grep output: ${String(cause)}`,
        cause,
      }),
  })
})

const executeAstGrepTool: (
  toolName: AstGrepToolName,
  args: string[],
  successSummary: string,
  emptyOutput: string,
  signal: AbortSignal | undefined,
) => Effect.Effect<PiToolResult<AstGrepDetails>, AstGrepFailure, PiProcess> = Effect.fnUntraced(function* (
  toolName: AstGrepToolName,
  args: string[],
  successSummary: string,
  emptyOutput: string,
  signal: AbortSignal | undefined,
) {
  const result = yield* runAstGrep(args, signal)
  if (result.code !== 0) {
    const stderr = result.stderr.trim()
    const error = stderr || `ast-grep exited with code ${result.code}`
    const truncation = truncateHead(error, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES })
    const fullOutputPath = truncation.truncated && stderr ? yield* saveAstGrepOutput(result.stderr) : undefined
    const formattedError = formatAstGrepOutput(truncation, fullOutputPath)
    return yield* Effect.fail(
      new PiToolError({
        tool: toolName,
        operation: 'execute',
        message: `ast-grep command failed: ${formattedError.text}`,
      }),
    )
  }

  const output = result.stdout.trim()
  const truncation = truncateHead(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES })
  const fullOutputPath = truncation.truncated ? yield* saveAstGrepOutput(result.stdout) : undefined
  return createAstGrepToolResult(output, truncation, successSummary, emptyOutput, fullOutputPath)
})

function renderAstGrepToolResult(
  result: AstGrepRenderParameters[0],
  { expanded, isPartial }: AstGrepRenderParameters[1],
  theme: AstGrepRenderParameters[2],
  context: AstGrepRenderParameters[3],
  pendingText: string,
): Text {
  const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0)
  if (isPartial) {
    text.setText(theme.fg('warning', pendingText))
    return text
  }

  const details = result.details as AstGrepDetails | undefined
  const content = result.content.find((item) => item.type === 'text')
  const output = details?.output ?? (content?.type === 'text' ? content.text : '')
  const summary = details?.summary ?? 'Ast-grep completed.'

  if (!expanded) {
    const truncationLabel = details?.truncated ? theme.fg('warning', ' (truncated)') : ''
    text.setText(
      `${theme.fg('success', summary)}${truncationLabel}${theme.fg('muted', ` (${keyHint('app.tools.expand', 'to expand')})`)}`,
    )
    return text
  }

  const expandedOutput = details?.truncationNotice ? `${output}\n\n${details.truncationNotice}` : output
  text.setText(expandedOutput ? theme.fg('toolOutput', expandedOutput) : theme.fg('success', summary))
  return text
}

const outputLimitDescription = `Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}. If truncated, read the complete output from the saved path in the result.`

const astGrepSearchTool: AstGrepSearchToolDefinition = {
  name: 'ast_grep_search',
  label: 'AST Grep Search',
  exposure: 'codemode',
  description:
    'Structurally search code with ast-grep. Use `$NAME` for one AST node and `$$$NAMES` for zero or more nodes. Set `lang` for reliable parsing, narrow `path` when possible, and set `json: true` for structured match locations. Use this before ast_grep_rewrite. ' +
    outputLimitDescription,
  promptSnippet: 'Search source structurally with ast-grep',
  promptGuidelines: [
    'Set lang to match the source language and narrow path when possible.',
    'If the result is truncated, read the saved output path.',
  ],
  parameters: astGrepSearchParameters,
  execute: Effect.fnUntraced(function* (params: Static<typeof astGrepSearchParameters>) {
    const { toolSignal } = yield* PiToolContext
    return yield* executeAstGrepTool(
      'ast_grep_search',
      createAstGrepCommandArgs(params),
      'Search completed.',
      'No matches found.',
      toolSignal,
    )
  }),
  renderResult(
    result: AstGrepSearchRenderParameters[0],
    { expanded, isPartial }: AstGrepSearchRenderParameters[1],
    theme: AstGrepSearchRenderParameters[2],
    context: AstGrepSearchRenderParameters[3],
  ): Text {
    return renderAstGrepToolResult(result, { expanded, isPartial }, theme, context, 'Searching...')
  },
}

const astGrepRewriteTool: AstGrepRewriteToolDefinition = {
  name: 'ast_grep_rewrite',
  label: 'AST Grep Rewrite',
  exposure: 'codemode',
  description:
    'Structurally rewrite code with ast-grep and update matching files in place. First use ast_grep_search with the same `pattern`, `path`, and `lang` to verify matches. Use `$NAME` and `$$$NAMES` consistently between `pattern` and `rewrite`. Narrow `path` to avoid unintended edits. ' +
    outputLimitDescription,
  promptSnippet: 'Rewrite source structurally with ast-grep',
  promptGuidelines: [
    'Search the same pattern, path, and language with ast_grep_search first.',
    'This tool updates files in place. Keep path narrow.',
    'If the result is truncated, read the saved output path.',
  ],
  parameters: astGrepRewriteParameters,
  execute: Effect.fnUntraced(function* (params: Static<typeof astGrepRewriteParameters>) {
    const { toolSignal } = yield* PiToolContext
    return yield* executeAstGrepTool(
      'ast_grep_rewrite',
      createAstGrepCommandArgs(params),
      'Rewrite completed.',
      'Rewrite completed.',
      toolSignal,
    )
  }),
  renderResult(
    result: AstGrepRewriteRenderParameters[0],
    { expanded, isPartial }: AstGrepRewriteRenderParameters[1],
    theme: AstGrepRewriteRenderParameters[2],
    context: AstGrepRewriteRenderParameters[3],
  ): Text {
    return renderAstGrepToolResult(result, { expanded, isPartial }, theme, context, 'Rewriting...')
  },
}

const astGrepPlugin: PiPlugin<never, AstGrepFailure> = PiExtension.define({
  id: 'ast-grep',
  effect: Effect.fnUntraced(function* (context: PiRegistrationContext<never, AstGrepFailure>) {
    yield* context.tools.register(astGrepSearchTool)
    yield* context.tools.register(astGrepRewriteTool)
  }),
})

/** Registers the ast-grep search and rewrite tools through Pi Effect. */
export { astGrepPlugin }
