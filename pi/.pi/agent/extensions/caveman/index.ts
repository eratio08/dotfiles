import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Effect, ManagedRuntime } from 'effect'
import { Caveman, CavemanContext, CavemanLayer } from './src/effects.ts'

export default function cavemanExtension(pi: ExtensionAPI): void {
  const runtime = ManagedRuntime.make(CavemanLayer(pi))
  let shuttingDown = false

  const sendAlias = (skillName: string, args: string, ctx: ExtensionContext): Promise<void> =>
    runtime.runPromise(
      Effect.provideService(
        Caveman.use((caveman) => caveman.sendAlias(skillName, args)),
        CavemanContext,
        ctx,
      ),
      { signal: ctx.signal },
    )

  pi.registerCommand('caveman', {
    description: 'Set caveman mode: off|lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra',
    handler: async (args, ctx) =>
      runtime.runPromise(
        Effect.provideService(
          Caveman.use((caveman) => caveman.handleCommand(args)),
          CavemanContext,
          ctx,
        ),
        { signal: ctx.signal },
      ),
  })

  pi.registerCommand('caveman-commit', {
    description: 'Run /skill:caveman-commit',
    handler: async (args, ctx) => sendAlias('caveman-commit', args, ctx),
  })

  pi.registerCommand('caveman-review', {
    description: 'Run /skill:caveman-review',
    handler: async (args, ctx) => sendAlias('caveman-review', args, ctx),
  })

  pi.registerCommand('caveman-compress', {
    description: 'Run /skill:caveman-compress',
    handler: async (args, ctx) => sendAlias('caveman-compress', args, ctx),
  })

  pi.on('session_start', async (_event, ctx) => {
    if (shuttingDown) return
    await runtime.runPromise(
      Effect.provideService(
        Caveman.use((caveman) => caveman.restoreMode()),
        CavemanContext,
        ctx,
      ),
      { signal: ctx.signal },
    )
  })

  pi.on('session_tree', async (_event, ctx) => {
    if (shuttingDown) return
    await runtime.runPromise(
      Effect.provideService(
        Caveman.use((caveman) => caveman.restoreMode()),
        CavemanContext,
        ctx,
      ),
      { signal: ctx.signal },
    )
  })

  pi.on('agent_start', async (_event, ctx) => {
    if (shuttingDown) return
    await runtime.runPromise(
      Effect.provideService(
        Caveman.use((caveman) => caveman.setAgentActive(true)),
        CavemanContext,
        ctx,
      ),
      { signal: ctx.signal },
    )
  })

  pi.on('agent_end', async (_event, ctx) => {
    if (shuttingDown) return
    await runtime.runPromise(
      Effect.provideService(
        Caveman.use((caveman) => caveman.setAgentActive(false)),
        CavemanContext,
        ctx,
      ),
      { signal: ctx.signal },
    )
  })

  pi.on('input', async (event, ctx) => {
    if (shuttingDown || event.source === 'extension') return { action: 'continue' }
    await runtime.runPromise(
      Effect.provideService(
        Caveman.use((caveman) => caveman.handleInput(event.text)),
        CavemanContext,
        ctx,
      ),
      { signal: ctx.signal },
    )
    return { action: 'continue' }
  })

  pi.on('before_agent_start', async (event, ctx) => {
    if (shuttingDown) return
    const systemPrompt = await runtime.runPromise(
      Caveman.use((caveman) => caveman.buildSystemPrompt(event.systemPrompt)),
      { signal: ctx.signal },
    )
    if (!systemPrompt) return
    return { systemPrompt }
  })

  pi.on('session_shutdown', async (_event, ctx) => {
    if (shuttingDown) return
    shuttingDown = true
    try {
      await runtime.runPromise(
        Effect.provideService(
          Caveman.use((caveman) => caveman.shutdown()),
          CavemanContext,
          ctx,
        ),
        { signal: ctx.signal },
      )
    } finally {
      await runtime.dispose()
    }
  })
}
