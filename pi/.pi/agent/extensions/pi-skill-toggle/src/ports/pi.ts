import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, Schema } from 'effect'
import type { SkillRecord, SkillToggleUiResult } from '../types.ts'
import { showSkillToggleUi } from '../ui/overlay.ts'

type NotificationType = 'info' | 'warning' | 'error'

export class PiHostError extends Schema.TaggedError<PiHostError>()('PiHostError', {
  operation: Schema.String,
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

export class PiHost extends Context.Service<
  PiHost,
  {
    readonly notify: (message: string, type?: NotificationType) => Effect.Effect<void, PiHostError>
    readonly showToggleUi: (skills: SkillRecord[]) => Effect.Effect<SkillToggleUiResult, PiHostError>
    readonly reload: () => Effect.Effect<void, PiHostError>
  }
>()('pi-skill-toggle/ports/PiHost') {}

function toPiHostError(operation: string, cause: unknown): PiHostError {
  return new PiHostError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  })
}

export function PiHostLive(ctx: ExtensionCommandContext): Layer.Layer<PiHost> {
  return Layer.succeed(
    PiHost,
    PiHost.of({
      notify: (message, type) =>
        Effect.try({
          try: () => {
            if (ctx.hasUI) ctx.ui.notify(message, type)
          },
          catch: (cause) => toPiHostError('notify', cause),
        }),
      showToggleUi: (skills) => {
        if (!ctx.hasUI) return Effect.fail(toPiHostError('showToggleUi', 'interactive UI is not available'))
        return Effect.tryPromise({
          try: () => showSkillToggleUi(ctx, skills),
          catch: (cause) => toPiHostError('showToggleUi', cause),
        })
      },
      reload: () =>
        Effect.tryPromise({
          try: () => ctx.reload(),
          catch: (cause) => toPiHostError('reload', cause),
        }),
    }),
  )
}
