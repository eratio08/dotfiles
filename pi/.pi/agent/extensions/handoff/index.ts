import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { type HandoffRestoreResult, type HandoffRunResult, restoreResultMessage, runResultMessage } from './src/core.ts'
import { HandoffCommandContext, HandoffContext, HandoffEffects, HandoffEffectsLayer, HandoffPi } from './src/effects.ts'

function notify(ctx: ExtensionContext, message: string, type: 'info' | 'warning' | 'error'): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, type)
  }
}

function handoffExtension(pi: ExtensionAPI): void {
  const runtime = ManagedRuntime.make(Layer.mergeAll(HandoffEffectsLayer, Layer.succeed(HandoffPi, pi)))
  let shuttingDown = false

  const runCommand = (ctx: ExtensionCommandContext): Promise<HandoffRunResult> =>
    runtime.runPromise(
      HandoffEffects.use((effects) => effects.run()).pipe(Effect.provide(Layer.succeed(HandoffCommandContext, ctx))),
      { signal: ctx.signal },
    )

  const restoreModel = (ctx: ExtensionContext): Promise<HandoffRestoreResult> =>
    runtime.runPromise(
      HandoffEffects.use((effects) => effects.restoreModel()).pipe(Effect.provide(Layer.succeed(HandoffContext, ctx))),
      { signal: ctx.signal },
    )

  pi.on('before_agent_start', async (_event, ctx) => {
    if (shuttingDown) {
      return
    }

    try {
      const result = await restoreModel(ctx)
      const message = restoreResultMessage(result)
      if (message) {
        notify(ctx, message, 'warning')
      }
    } catch (error) {
      notify(ctx, error instanceof Error ? error.message : String(error), 'warning')
    }
  })

  pi.registerCommand('handoff', {
    description: 'Compact the current conversation so a fresh session can continue the work',
    handler: async (_args, ctx) => {
      if (ctx.mode !== 'tui') {
        notify(ctx, 'handoff requires interactive mode', 'error')
        return
      }

      try {
        const result = await runCommand(ctx)
        const message = runResultMessage(result)
        if (message) {
          notify(ctx, message.message, message.type)
        }
      } catch (error) {
        notify(ctx, error instanceof Error ? error.message : 'Handoff failed', 'error')
      }
    },
  })

  pi.on('session_shutdown', async (_event, ctx) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    try {
      await runtime.runPromise(Effect.void, { signal: ctx.signal })
    } finally {
      await runtime.dispose()
    }
  })
}

export { handoffExtension as default }
