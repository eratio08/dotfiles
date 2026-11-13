import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs/promises'
import * as Os from 'node:os'
import * as Path from 'node:path'
import * as Pi from '@earendil-works/pi-coding-agent'
import * as Tui from '@earendil-works/pi-tui'
import * as TypeBox from 'typebox'

const addTasksParameters = TypeBox.Type.Object({
  summaries: TypeBox.Type.Array(TypeBox.Type.String({ description: 'A task summary to add.' }), {
    description: 'One or more task summaries.',
    minItems: 1,
    maxItems: 1000,
  }),
})

const listTasksParameters = TypeBox.Type.Object({
  limit: TypeBox.Type.Optional(
    TypeBox.Type.Integer({
      description: 'The maximum number of summaries to list.',
      minimum: 1,
      maximum: 255,
    }),
  ),
})

type OmmCreateTaskDetails = {
  readonly summaries: string[]
}

type OmmTaskListDetails = {
  readonly summaries: string[]
  readonly truncated: boolean
  readonly savedOutputPath?: string
}

type OmmListTasksRenderContext = Parameters<
  NonNullable<Pi.ToolDefinition<typeof listTasksParameters, OmmTaskListDetails>['renderResult']>
>[3]

function validateOmmTaskSummary(rawSummary: string): string {
  const summary = rawSummary.trim()

  if (summary.length === 0) {
    throw new Error('OMM task summary is invalid: summary is empty')
  }

  if (summary.includes('\n') || summary.includes('\r')) {
    throw new Error('OMM task summary is invalid: line breaks are not supported')
  }

  if (new TextEncoder().encode(summary).byteLength > 300) {
    throw new Error('OMM task summary is invalid: summary exceeds 300 bytes')
  }

  const prefixDelimiterIndex = summary.indexOf(':')
  if (prefixDelimiterIndex !== -1) {
    if (summary.slice(0, prefixDelimiterIndex).trim().length === 0) {
      throw new Error('OMM task summary is invalid: prefix is empty')
    }

    if (summary.slice(prefixDelimiterIndex + 1).trim().length === 0) {
      throw new Error('OMM task summary is invalid: task text is empty')
    }
  }

  return summary
}

async function runOmmCliCommand(
  pi: Pi.ExtensionAPI,
  args: string[],
  signal: AbortSignal | undefined,
): Promise<Pi.ExecResult> {
  let result: Pi.ExecResult
  try {
    result = await pi.exec('omm', args, { signal })
  } catch (error) {
    if (signal?.aborted) {
      throw new Error('OMM command was cancelled')
    }

    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`OMM command failed: ${message}`)
  }

  if (signal?.aborted || result.killed) {
    throw new Error('OMM command was cancelled')
  }

  if (result.code !== 0) {
    const message = result.stderr.trim() || `exit code ${result.code}`
    throw new Error(`OMM command failed: ${message}`)
  }

  return result
}

function runOmmImport(summaries: string[], signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new Error('OMM command was cancelled'))
  }

  return new Promise<void>((resolve, reject) => {
    let child: ChildProcess.ChildProcessWithoutNullStreams
    try {
      child = ChildProcess.spawn('omm', ['import'], { signal, stdio: 'pipe' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      reject(new Error(`OMM command failed: ${message}`))
      return
    }

    let stderr = ''
    let processError: Error | undefined
    let inputError: Error | undefined

    child.stdout.resume()
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.stdin.on('error', (error: Error) => {
      inputError = error
    })
    child.once('error', (error: Error) => {
      processError = error
    })
    child.once('close', (code: number | null, exitSignal: NodeJS.Signals | null) => {
      if (signal?.aborted) {
        reject(new Error('OMM command was cancelled'))
        return
      }

      if (processError) {
        reject(new Error(`OMM command failed: ${processError.message}`))
        return
      }

      if (inputError) {
        reject(new Error(`OMM command failed: ${inputError.message}`))
        return
      }

      if (exitSignal !== null) {
        reject(new Error(`OMM command failed: process terminated by ${exitSignal}`))
        return
      }

      if (code !== 0) {
        const message = stderr.trim() || `exit code ${code ?? 'unknown'}`
        reject(new Error(`OMM command failed: ${message}`))
        return
      }

      resolve()
    })

    child.stdin.end(`${summaries.join('\n')}\n`)
  })
}

function piOmmExtension(pi: Pi.ExtensionAPI): void {
  pi.registerTool({
    name: 'omm_add_tasks',
    label: 'Add OMM tasks',
    description: "Add one or more task summaries to OMM's active list.",
    promptSnippet: 'Add one or more task summaries to OMM',
    promptGuidelines: [
      'Use omm_add_tasks when the user asks to add one or more OMM tasks.',
      'Do not use omm_add_tasks to change an existing task.',
    ],
    parameters: addTasksParameters,
    async execute(
      _toolCallId: string,
      params: TypeBox.Static<typeof addTasksParameters>,
      signal: AbortSignal | undefined,
    ): Promise<Pi.AgentToolResult<OmmCreateTaskDetails>> {
      if (params.summaries.length === 0) {
        throw new Error('OMM task batch is invalid: batch is empty')
      }

      if (params.summaries.length > 1000) {
        throw new Error('OMM task batch is invalid: batch exceeds 1000 summaries')
      }

      const summaries = params.summaries.map(validateOmmTaskSummary)
      if (summaries.length === 1) {
        await runOmmCliCommand(pi, [summaries[0]], signal)
      } else {
        await runOmmImport(summaries, signal)
      }

      const text = summaries.length === 1 ? `Added task: ${summaries[0]}` : `Added ${summaries.length} OMM tasks.`

      return {
        content: [{ type: 'text', text }],
        details: { summaries },
      }
    },
  })

  pi.registerTool({
    name: 'omm_list_tasks',
    label: 'List OMM tasks',
    description:
      'List active task summaries in OMM task order. The default limit is 20. Limits range from 1 to 255. Large results are truncated, with full output saved to a temporary file.',
    promptSnippet: 'List active OMM task summaries',
    promptGuidelines: ['Use omm_list_tasks when the user asks to view active OMM tasks.'],
    parameters: listTasksParameters,
    async execute(
      _toolCallId: string,
      params: TypeBox.Static<typeof listTasksParameters>,
      signal: AbortSignal | undefined,
    ): Promise<Pi.AgentToolResult<OmmTaskListDetails>> {
      const result = await runOmmCliCommand(pi, ['tasks', '--num', String(params.limit ?? 20)], signal)
      const summaries = result.stdout.split(/\r?\n/).filter((summary) => summary.length > 0)
      const output = summaries.join('\n')
      const truncation = Pi.truncateHead(output, {
        maxLines: Pi.DEFAULT_MAX_LINES,
        maxBytes: Pi.DEFAULT_MAX_BYTES,
      })
      let savedOutputPath: string | undefined
      let outputText = truncation.content

      if (truncation.truncated) {
        try {
          const tempDirectory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'pi-omm-'))
          savedOutputPath = Path.join(tempDirectory, 'active-task-summaries.txt')
          await Fs.writeFile(savedOutputPath, output, { mode: 0o600 })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(`OMM task output could not be saved: ${message}`)
        }

        outputText += `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${Pi.formatSize(truncation.outputBytes)} of ${Pi.formatSize(truncation.totalBytes)}). Full output saved to: ${savedOutputPath}]`
      }

      return {
        content: summaries.length === 0 ? [] : [{ type: 'text', text: outputText }],
        details: { summaries, truncated: truncation.truncated, savedOutputPath },
      }
    },
    renderResult(
      result: Pi.AgentToolResult<OmmTaskListDetails>,
      { expanded, isPartial }: Pi.ToolRenderResultOptions,
      theme: Pi.Theme,
      context: OmmListTasksRenderContext,
    ): Tui.Text {
      const text = (context.lastComponent as Tui.Text | undefined) ?? new Tui.Text('', 0, 0)
      if (isPartial) {
        text.setText(theme.fg('warning', 'Listing OMM tasks...'))
        return text
      }

      const content = result.content.find((item) => item.type === 'text')
      const details = result.details as OmmTaskListDetails | undefined
      if (!details || context.isError) {
        text.setText(theme.fg(context.isError ? 'error' : 'muted', content?.type === 'text' ? content.text : ''))
        return text
      }

      if (expanded) {
        text.setText(theme.fg('toolOutput', details.summaries.join('\n')))
        return text
      }

      const count = details.summaries.length
      const noun = count === 1 ? 'summary' : 'summaries'
      const keyHint = (
        context as OmmListTasksRenderContext & {
          keyHint?: (keybinding: string, description: string) => string
        }
      ).keyHint
      const expandHint = keyHint?.('app.tools.expand', 'to expand')
      const hintText = expandHint ? theme.fg('muted', ` (${expandHint})`) : ''
      text.setText(`${theme.fg('success', `${count} active task ${noun}`)}${hintText}`)
      return text
    },
  })
}

export { piOmmExtension, piOmmExtension as default }
