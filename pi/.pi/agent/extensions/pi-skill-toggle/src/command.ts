import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { Effect, type ManagedRuntime, Schema } from 'effect'
import { SkillTogglePlanner } from './apply/planner.ts'
import { SkillChangeWriter } from './apply/writer.ts'
import { SkillInventory } from './inventory/loader.ts'
import { PiHost, PiHostLive } from './ports/pi.ts'
import type { ApplyResult } from './types.ts'

const CommandPhaseSchema = Schema.Literals(['scan', 'plan', 'ui', 'reload'])
type CommandPhase = (typeof CommandPhaseSchema)['Type']

class ToggleSkillsCommandError extends Schema.TaggedError<ToggleSkillsCommandError>()('ToggleSkillsCommandError', {
  phase: CommandPhaseSchema,
  message: Schema.String,
  cause: Schema.Unknown,
}) {}

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function commandError(phase: CommandPhase, cause: unknown): ToggleSkillsCommandError {
  return new ToggleSkillsCommandError({ phase, message: causeMessage(cause), cause })
}

function notify(host: PiHost['Service'], message: string, type: 'info' | 'warning' | 'error'): Effect.Effect<void> {
  return host.notify(message, type).pipe(Effect.catch(() => Effect.void))
}

export function runToggleSkillsCommand(
  ctx: ExtensionCommandContext,
  runtime: ManagedRuntime.ManagedRuntime<SkillInventory | SkillTogglePlanner | SkillChangeWriter, never>,
): Promise<void> {
  const program = Effect.gen(function* (): Effect.fn.Return<
    void,
    ToggleSkillsCommandError,
    SkillInventory | SkillTogglePlanner | SkillChangeWriter | PiHost
  > {
    const host = yield* PiHost
    const inventory = yield* SkillInventory
    const planner = yield* SkillTogglePlanner
    const writer = yield* SkillChangeWriter

    if (ctx.mode !== 'tui' || !ctx.hasUI) {
      yield* notify(host, '/toggle-skills requires interactive mode', 'error')
      return
    }

    const skills = yield* inventory.load(ctx.cwd).pipe(Effect.mapError((error) => commandError('scan', error)))
    if (skills.length === 0) {
      yield* notify(host, 'Pi Skill Toggle: no skills found in global, user, or project skill directories', 'info')
      return
    }

    const result = yield* host.showToggleUi(skills).pipe(Effect.mapError((error) => commandError('ui', error)))
    if (result.action !== 'apply') return

    const changes = yield* planner
      .plan(skills, result.drafts)
      .pipe(Effect.mapError((error) => commandError('plan', error)))
    if (changes.length === 0) {
      yield* notify(host, 'Pi Skill Toggle: no changes to apply', 'info')
      return
    }

    const applied = yield* writer.apply(changes)
    yield* notify(host, formatApplyResult(applied), applied.errors.length > 0 ? 'warning' : 'info')
    if (applied.applied.length > 0) {
      yield* host.reload().pipe(Effect.mapError((error) => commandError('reload', error)))
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const host = yield* PiHost
        yield* notify(host, formatCommandError(error), 'error')
      }),
    ),
    Effect.provide(PiHostLive(ctx)),
  )

  return runtime.runPromise(program, { signal: ctx.signal })
}

function formatCommandError(error: ToggleSkillsCommandError): string {
  const prefix = {
    scan: 'Pi Skill Toggle failed to scan skills',
    plan: 'Pi Skill Toggle failed to plan changes',
    ui: 'Pi Skill Toggle failed to open the skill toggle UI',
    reload: 'Pi Skill Toggle failed to reload skills',
  }[error.phase]
  return `${prefix}: ${error.message}`
}

function formatApplyResult(result: ApplyResult): string {
  const lines = [`Pi Skill Toggle applied ${result.applied.length} change${result.applied.length === 1 ? '' : 's'}.`]
  for (const change of result.applied.slice(0, 6)) {
    lines.push(`- ${change.skill.name}: ${change.from} → ${change.to}`)
  }
  if (result.applied.length > 6) {
    lines.push(`- … ${result.applied.length - 6} more`)
  }
  if (result.errors.length > 0) {
    lines.push(`Errors/skipped: ${result.errors.length}`)
    for (const error of result.errors.slice(0, 4)) {
      lines.push(`- ${error.message}`)
    }
  }
  if (result.applied.length > 0) {
    lines.push('Reloaded skills, prompts, extensions, and themes.')
  }
  return lines.join('\n')
}
