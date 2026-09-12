import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Effect, ManagedRuntime } from 'effect'
import { HandoffEffects, HandoffEffectsLayer, type HandoffRestoreResult, type HandoffRunResult } from './src/effects.ts'

function notify(ctx: ExtensionContext, message: string, type: 'info' | 'warning' | 'error'): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, type)
  }
}

function runResultMessage(result: HandoffRunResult): { message: string; type: 'info' | 'error' } | undefined {
  if (result.status === 'cancelled') {
    return {
      message: result.stage === 'navigation' ? 'Branch cancelled' : 'Cancelled',
      type: 'info',
    }
  }
  if (result.status === 'skipped') {
    const messages = {
      'no-model': 'No model selected',
      'no-conversation': 'No conversation to hand off',
    } as const
    return { message: messages[result.reason], type: 'error' }
  }
  return undefined
}

function restoreResultMessage(result: HandoffRestoreResult): string | undefined {
  return result.status === 'warning' ? result.message : undefined
}

export default function handoffExtension(pi: ExtensionAPI): void {
  const runtime = ManagedRuntime.make(HandoffEffectsLayer(pi))
  let shuttingDown = false

  pi.on('before_agent_start', async (_event, ctx) => {
    if (shuttingDown) {
      return
    }

    try {
      const result = await runtime.runPromise(
        HandoffEffects.use((effects) => effects.restoreModel(ctx)),
        {
          signal: ctx.signal,
        },
      )
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
        const result = await runtime.runPromise(
          HandoffEffects.use((effects) => effects.run(ctx)),
          {
            signal: ctx.signal,
          },
        )
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
