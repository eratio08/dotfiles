import type { ExecResult, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, ManagedRuntime, Schema } from 'effect'

class RtkError extends Schema.TaggedError<RtkError>()('RtkError', {
  message: Schema.String,
}) {}

class Rtk extends Context.Service<
  Rtk,
  {
    readonly rewrite: (command: string) => Effect.Effect<string | null, RtkError>
  }
>()('rtk/Rtk') {}

function normalizeRewrite(command: string, stdout: string): string | null {
  const rewritten = stdout.trim()
  if (!rewritten || rewritten === command) {
    return null
  }
  return rewritten
}

function toRtkError(cause: unknown): RtkError {
  return new RtkError({ message: String(cause) })
}

function RtkFromProcess(pi: ExtensionAPI): Layer.Layer<Rtk, RtkError> {
  return Layer.effect(
    Rtk,
    Effect.gen(function* () {
      const version = yield* Effect.tryPromise({
        try: (signal): Promise<ExecResult> => pi.exec('rtk', ['--version'], { signal }),
        catch: toRtkError,
      })
      if (version.code !== 0) {
        return yield* Effect.fail(new RtkError({ message: 'rtk binary not found in PATH' }))
      }

      return Rtk.of({
        rewrite: (command: string): Effect.Effect<string | null, RtkError> =>
          Effect.tryPromise({
            try: (signal): Promise<ExecResult> => pi.exec('rtk', ['rewrite', command], { signal }),
            catch: toRtkError,
          }).pipe(Effect.map((result): string | null => normalizeRewrite(command, result.stdout))),
      })
    }),
  )
}

function rewriteRtkCommand(command: string): Effect.Effect<string | null, RtkError, Rtk> {
  return Effect.gen(function* () {
    const rtk = yield* Rtk
    return yield* rtk.rewrite(command)
  })
}

export default async function rtk(pi: ExtensionAPI) {
  const runtime = ManagedRuntime.make(RtkFromProcess(pi))
  try {
    await runtime.runPromise(Rtk)
  } catch {
    await runtime.dispose()
    console.warn('[rtk] rtk binary not found in PATH — extension disabled')
    return
  }

  pi.on('session_shutdown', async (): Promise<void> => {
    await runtime.dispose()
  })

  pi.on('tool_call', async (event, ctx): Promise<void> => {
    if (event.toolName !== 'bash') {
      return
    }

    const command = event.input?.command
    if (typeof command !== 'string' || !command) {
      return
    }

    const rewritten = await runtime
      .runPromise(rewriteRtkCommand(command), {
        signal: ctx.signal,
      })
      .catch((): null => null)

    if (rewritten) {
      event.input.command = rewritten
    }
  })
}
