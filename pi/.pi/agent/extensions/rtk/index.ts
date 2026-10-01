import type { PiContextTag, PiExtensionError, PiRegistrationContext, PiStableServices } from '@eratio/pi-effect'
import { PiContext, PiExtension, PiProcess } from '@eratio/pi-effect'
import { Effect } from 'effect'

function normalizeRewrite(command: string, stdout: string): string | null {
  const rewritten = stdout.trim()
  if (!rewritten || rewritten === command) {
    return null
  }
  return rewritten
}

const rtk = PiExtension.install(
  PiExtension.define({
    id: 'rtk',
    effect: ({ events }: PiRegistrationContext<never>): Effect.Effect<void, PiExtensionError, PiStableServices> =>
      Effect.gen(function* () {
        const process = yield* PiProcess
        const version = yield* process
          .exec('rtk', ['--version'])
          .pipe(Effect.catchTag('PiOperationsError', () => Effect.succeed(null)))
        if (version?.code !== 0) {
          yield* Effect.sync(() => console.warn('[rtk] rtk binary not found in PATH — extension disabled'))
          return
        }

        yield* events.on(
          'tool_call',
          (event): Effect.Effect<void, never, PiProcess | PiContextTag> => {
            if (event.toolName !== 'bash') {
              return Effect.void
            }

            const command = event.input?.command
            if (typeof command !== 'string' || !command) {
              return Effect.void
            }

            return Effect.gen(function* () {
              const context = yield* PiContext
              const process = yield* PiProcess
              const result = yield* process
                .exec('rtk', ['rewrite', command], { signal: context.signal })
                .pipe(Effect.catchTag('PiOperationsError', () => Effect.succeed(null)))
              if (!result) {
                return
              }

              const rewritten = normalizeRewrite(command, result.stdout)
              if (rewritten !== null) {
                event.input.command = rewritten
              }
            })
          },
          { failure: 'neutral' },
        )
      }),
  }),
)

export { rtk as default }
