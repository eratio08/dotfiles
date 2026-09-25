import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExecResult } from '@earendil-works/pi-coding-agent'
import {
  PiCommandContext,
  PiContext,
  PiExtension,
  type PiHostError,
  PiProcess,
  type PiRegistrationContext,
  PiUi,
  type PiUiUnavailableError,
} from '@eratio/pi-effect'
import { Effect, Schema } from 'effect'

class HerdrBranchError extends Schema.TaggedError<HerdrBranchError>()('HerdrBranchError', {
  stage: Schema.String,
  message: Schema.String,
  details: Schema.optional(Schema.String),
  paneId: Schema.optional(Schema.String),
}) {}

type ForkStage = 'pane-split' | 'agent-start'

const extensionPath = fileURLToPath(import.meta.url)

function parsePaneId(output: string): string | undefined {
  try {
    const response = JSON.parse(output) as {
      result?: { pane?: { pane_id?: unknown } }
    }
    const paneId = response?.result?.pane?.pane_id
    return typeof paneId === 'string' && paneId.trim().length > 0 ? paneId : undefined
  } catch {
    return undefined
  }
}

function runExternalCommand(options: {
  readonly args: readonly string[]
  readonly stage: ForkStage
  readonly cwd: string
  readonly signal: AbortSignal | undefined
  readonly paneId?: string
}): Effect.Effect<ExecResult, HerdrBranchError, PiProcess> {
  const binary = process.env.HERDR_BIN_PATH?.trim() || 'herdr'
  const message = {
    'pane-split': 'Herdr could not split the current pane.',
    'agent-start': 'Herdr could not start Pi.',
  }[options.stage]
  const timeout = 45_000

  return Effect.gen(function* () {
    const process = yield* PiProcess
    const result = yield* process
      .exec(binary, options.args, {
        cwd: options.cwd,
        signal: options.signal,
        timeout,
      })
      .pipe(
        Effect.catchTag('PiHostError', (error) =>
          Effect.fail(
            new HerdrBranchError({
              stage: options.stage,
              message,
              details: error.message,
              paneId: options.paneId,
            }),
          ),
        ),
      )

    if (result.killed || result.code !== 0) {
      const details =
        result.stderr.trim() ||
        (result.killed ? 'Herdr command was cancelled or timed out.' : `Herdr exited with code ${result.code}.`)
      return yield* Effect.fail(
        new HerdrBranchError({
          stage: options.stage,
          message,
          details,
          paneId: options.paneId,
        }),
      )
    }

    return result
  })
}

function handleHerdrFork(
  args: string,
): Effect.Effect<void, PiHostError | PiUiUnavailableError, PiContext | PiCommandContext | PiUi | PiProcess> {
  return Effect.gen(function* () {
    const context = yield* PiContext
    const command = yield* PiCommandContext
    const ui = yield* PiUi

    if (context.mode !== 'tui') {
      if (context.hasUI) yield* ui.notify('/herdr-fork requires Pi TUI mode.', 'error')
      return
    }

    if (!context.hasUI) return

    if (process.env.HERDR_ENV !== '1' || !process.env.HERDR_PANE_ID) {
      yield* ui.notify('/herdr-fork must run inside a Herdr pane.', 'error')
      return
    }

    const name = args.trim()

    if (name.startsWith('-')) {
      yield* ui.notify('The optional name must not start with a hyphen.', 'error')
      return
    }

    yield* command.waitForIdle()

    if (!(yield* context.isIdle())) {
      yield* ui.notify('Wait until Pi is idle, then run /herdr-fork again.', 'warning')
      return
    }

    const session = command.session
    const sessionId = session.id
    const sessionFile = session.file
    const cwd = session.cwd

    if (session.leafId === null) {
      yield* ui.notify('Cannot fork an empty Pi session. Send a message first, then run /herdr-fork again.', 'warning')
      return
    }

    if (!sessionId || !sessionFile || !isAbsolute(sessionFile) || !isAbsolute(cwd)) {
      yield* ui.notify(
        'Cannot fork because the current Pi session file, ID, or working directory is unavailable.',
        'error',
      )
      return
    }

    yield* Effect.tryPromise({
      try: () => access(sessionFile, constants.R_OK),
      catch: (cause: unknown) => {
        const missingSessionFile = cause instanceof Error && 'code' in cause && cause.code === 'ENOENT'
        return new HerdrBranchError({
          stage: missingSessionFile ? 'session-file-missing' : 'session-file',
          message: missingSessionFile
            ? 'The Pi session file does not exist yet. Send a message first, then run /herdr-fork again.'
            : 'The Pi session file is not readable.',
          details: missingSessionFile ? undefined : String(cause),
        })
      },
    })

    const paneResult = yield* runExternalCommand({
      args: ['pane', 'split', '--current', '--direction', 'right', '--cwd', cwd, '--focus'],
      stage: 'pane-split',
      cwd,
      signal: context.signal,
    })
    const paneId = parsePaneId(paneResult.stdout)

    if (!paneId) {
      return yield* Effect.fail(
        new HerdrBranchError({
          stage: 'pane-split',
          message: 'Herdr did not return the split pane ID.',
        }),
      )
    }

    const agentName = name || `pi-fork-${randomUUID().slice(0, 8)}`
    yield* runExternalCommand({
      args: [
        'agent',
        'start',
        agentName,
        '--kind',
        'pi',
        '--pane',
        paneId,
        '--timeout',
        '30000',
        '--',
        '--fork',
        sessionFile,
        '--extension',
        extensionPath,
      ],
      stage: 'agent-start',
      cwd,
      signal: context.signal,
      paneId,
    })

    yield* ui.notify(
      `Started a fork of Pi session ${sessionId} as ${agentName} in Herdr pane ${paneId} in the current tab and workspace at ${cwd}. The child has a separate session file and shares the working directory. Use /tree in the child to choose an earlier branch point.`,
      'info',
    )
  }).pipe(
    Effect.catchTag('HerdrBranchError', (error) =>
      Effect.gen(function* () {
        const ui = yield* PiUi
        const pane = error.paneId ? ` Pane ${error.paneId} remains open.` : ''
        const details = error.details ? ` ${error.details}` : ''
        const severity = error.stage === 'session-file-missing' ? 'warning' : 'error'
        yield* ui.notify(`${error.message}${pane}${details}`, severity)
      }),
    ),
  )
}

const herdrBranchPlugin = PiExtension.define<HerdrBranchError | PiHostError | PiUiUnavailableError>({
  id: 'herdr-fork',
  effect: (context: PiRegistrationContext<never, HerdrBranchError | PiHostError | PiUiUnavailableError>) =>
    Effect.gen(function* () {
      yield* context.commands.register('herdr-fork', {
        description: 'Fork this Pi session into a new pane in the current Herdr tab.',
        handler: (args: string) => handleHerdrFork(args),
      })
    }),
})

const herdrForkExtension = PiExtension.install(herdrBranchPlugin)

export { herdrForkExtension as default }
