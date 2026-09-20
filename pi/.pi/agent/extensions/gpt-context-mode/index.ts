import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Effect, Layer, ManagedRuntime } from 'effect'
import {
  GPT5_HIGH_CONTEXT_WINDOW,
  type GptContextMode,
  parseGptContextCommand,
  restoreGptContextMode,
} from './src/core.ts'
import {
  GptContextModeContext,
  GptContextModeLayer,
  GptContextModePi,
  GptContextModeService,
  GptContextModeState,
} from './src/effects.ts'

function gptContextModeExtension(pi: ExtensionAPI): void {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(GptContextModeLayer, GptContextModeState.layer, Layer.succeed(GptContextModePi, pi)),
  )
  let shuttingDown = false

  const run = <A, E>(
    use: (
      service: GptContextModeService['Service'],
    ) => Effect.Effect<A, E, GptContextModeContext | GptContextModePi | GptContextModeState>,
    ctx: ExtensionContext,
  ): Promise<A> =>
    runtime.runPromise(Effect.provideService(GptContextModeService.use(use), GptContextModeContext, ctx), {
      signal: ctx.signal,
    })

  pi.registerCommand('gpt-context-mode', {
    description: 'Switch GPT-5.6 between default and long context windows',
    handler: (args, ctx) => run((service) => service.handleCommand(args), ctx),
  })

  pi.on('session_start', async (_event, ctx) => {
    await run((service) => service.restore().pipe(Effect.as(undefined)), ctx)
  })

  pi.on('session_tree', async (_event, ctx) => {
    await run((service) => service.restore().pipe(Effect.as(undefined)), ctx)
  })

  pi.on('model_select', async (event, ctx) => {
    await run((service) => service.applyModel(event.model).pipe(Effect.as(undefined)), ctx)
  })

  pi.on('session_shutdown', async (_event, ctx) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    try {
      await run((service) => service.shutdown(), ctx)
    } finally {
      await runtime.dispose()
    }
  })
}

export {
  GPT5_HIGH_CONTEXT_WINDOW,
  type GptContextMode,
  gptContextModeExtension as default,
  parseGptContextCommand,
  restoreGptContextMode,
}
