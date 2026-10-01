import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import {
  analyzeSession,
  buildCurrentSystemMessage,
  type MeteringReportServer,
  openReportUrl,
  parseSavedSession,
  renderContextMeteringReport,
  selectCurrentSession,
  startMeteringReportServer,
} from './src/extension.ts'

type InspectArguments = { sessionFile?: string; leafId?: string }

const INSPECT_WIDGET_KEY = 'inspect'

function parseInspectArguments(args: string): InspectArguments {
  const trimmedArgs = args.trim()
  if (!trimmedArgs) return {}

  const match = /^(?:"([^"]+)"|'([^']+)'|(\S+))(?:\s+--leaf\s+(\S+))?$/.exec(trimmedArgs)
  const sessionFile = match?.[1] ?? match?.[2] ?? match?.[3]
  const leafId = match?.[4]

  if (!sessionFile || sessionFile.startsWith('--') || leafId?.startsWith('--')) {
    throw new Error('Usage: /inspect [<session-file> [--leaf <entry-id>]]')
  }

  return { sessionFile, ...(leafId ? { leafId } : {}) }
}

async function createInspectReport(
  args: string,
  context: ExtensionCommandContext,
  pi: ExtensionAPI,
): Promise<MeteringReportServer> {
  const commandArgs = parseInspectArguments(args)

  context.ui.setWidget(INSPECT_WIDGET_KEY, ['Generating Inspect report…'], { placement: 'aboveEditor' })
  let reportServer: MeteringReportServer | undefined

  try {
    await new Promise<void>((resume) => setTimeout(resume, 0))
    context.signal?.throwIfAborted()

    let session: ReturnType<typeof selectCurrentSession>
    if (commandArgs.sessionFile === undefined) {
      session = selectCurrentSession(context.sessionManager)
    } else {
      const sessionPath = resolve(context.cwd, commandArgs.sessionFile)
      const content = await readFile(sessionPath, { encoding: 'utf8', signal: context.signal })
      session = parseSavedSession(content, commandArgs.leafId, sessionPath)
    }

    const fallbackSystemMessage =
      session.source === 'current'
        ? buildCurrentSystemMessage(
            context.getSystemPrompt(),
            context.getSystemPromptOptions(),
            pi.getActiveTools(),
            pi.getAllTools(),
          )
        : undefined
    const analysis = analyzeSession(session, { fallbackSystemMessage, signal: context.signal })
    const activeModel = context.model
    const latestRequestModel = analysis.requests.at(-1)?.model
    const contextWindowTokens =
      activeModel && latestRequestModel === `${activeModel.provider}/${activeModel.id}`
        ? activeModel.contextWindow
        : undefined
    const runtimeContextUsage =
      session.source === 'current' && contextWindowTokens !== undefined ? context.getContextUsage() : undefined
    const html = renderContextMeteringReport(analysis, contextWindowTokens, runtimeContextUsage)
    const startedServer = await startMeteringReportServer(html)
    reportServer = startedServer

    try {
      context.ui.setWidget(INSPECT_WIDGET_KEY, ['Inspect server running · /inspect again to stop'], {
        placement: 'aboveEditor',
      })
    } catch (error) {
      reportServer = undefined
      await startedServer.close()
      throw error
    }

    return startedServer
  } finally {
    if (!reportServer) context.ui.setWidget(INSPECT_WIDGET_KEY, undefined)
  }
}

function inspectExtension(pi: ExtensionAPI, openUrl: (url: string) => Promise<void> = openReportUrl): void {
  let activeServer: MeteringReportServer | undefined

  pi.on('session_shutdown', async (_event, context) => {
    const server = activeServer
    activeServer = undefined
    if (context.hasUI) context.ui.setWidget(INSPECT_WIDGET_KEY, undefined)
    await server?.close()
  })

  pi.registerCommand('inspect', {
    description: 'Serve a local HTML report. Run /inspect again to stop the server.',
    handler: async (args: string, context: ExtensionCommandContext): Promise<void> => {
      try {
        const hasDialogUi = (context.mode === 'tui' || context.mode === 'rpc') && context.hasUI
        if (!hasDialogUi) throw new Error('/inspect needs a TUI or RPC interface.')

        if (activeServer) {
          const server = activeServer
          try {
            await server.close()
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            context.ui.notify(`Could not stop the Inspect server: ${message}`, 'error')
            return
          }

          activeServer = undefined
          context.ui.setWidget(INSPECT_WIDGET_KEY, undefined)
          context.ui.notify('Inspect server stopped.', 'info')
          return
        }

        const server = await createInspectReport(args, context, pi)
        activeServer = server

        try {
          await openUrl(server.url)
        } catch (error) {
          if (activeServer !== server) return
          const message = error instanceof Error ? error.message : String(error)
          context.ui.notify(
            `The server is running at ${server.url}, but the browser could not open it: ${message}. Run /inspect again to stop it.`,
            'warning',
          )
          return
        }

        if (activeServer !== server) return
        context.ui.notify(
          `Inspect report is available at ${server.url}. Run /inspect again to stop the server.`,
          'info',
        )
      } catch (error) {
        if (!context.hasUI || (context.mode !== 'tui' && context.mode !== 'rpc')) throw error
        const message = error instanceof Error ? error.message : String(error)
        context.ui.notify(`Could not create Inspect report: ${message}`, 'error')
      }
    },
  })
}

export { inspectExtension as default }
