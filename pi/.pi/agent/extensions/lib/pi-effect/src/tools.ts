import type { AgentToolResult, ToolDefinition, ToolInfo } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Semaphore } from 'effect'
import type { Static, TSchema } from 'typebox'
import type { PiToolContext } from './context.ts'
import { PiOperationsError, piCauseMessage } from './errors.ts'
import type { PiOperationsService } from './pi.ts'

/** Tool result content and optional structured details returned by an Effect tool. */
type PiToolResult<Details = unknown> = Pick<AgentToolResult<Details>, 'content' | 'details'>

/** Pi tool definition whose execution runs as an Effect and can request extension services. */
type EffectToolDefinition<Params extends TSchema, Services, Failure, Details = unknown> = Omit<
  ToolDefinition<Params, Details>,
  'execute'
> & {
  /** Short prompt text that describes the tool to the model. */
  readonly promptSnippet: string
  /** Rules that guide when and how the model uses the tool. */
  readonly promptGuidelines: readonly string[]
  /** Runs the tool with parameters defined by `Params`. */
  readonly execute: (params: Static<Params>) => Effect.Effect<PiToolResult<Details>, Failure, Services | PiToolContext>
}

/** Effect operations for reading and replacing the active tool list. */
type PiToolsService = {
  /** Reads the active tool names. */
  readonly active: () => Effect.Effect<readonly string[], PiOperationsError>
  /** Reads metadata for all tools known to Pi. */
  readonly all: () => Effect.Effect<readonly ToolInfo[], PiOperationsError>
  /** Replaces the active tool list. */
  readonly replaceActive: (toolNames: readonly string[]) => Effect.Effect<void, PiOperationsError>
}

/**
 * Creates the Pi tools service and serializes active-tool replacements.
 * @param operations Low-level Pi operations for reading and replacing tools.
 * @returns The Pi tools service.
 */
const createPiToolsService = (operations: PiOperationsService): PiToolsService => {
  const semaphore = Semaphore.makeUnsafe(1)
  return {
    active: operations.getActiveTools,
    all: operations.getAllTools,
    replaceActive: (toolNames: readonly string[]) =>
      semaphore
        .withPermit(operations.setActiveTools(toolNames))
        .pipe(
          Effect.mapError((cause) =>
            cause instanceof PiOperationsError
              ? cause
              : new PiOperationsError({ operation: 'setActiveTools', message: piCauseMessage(cause), cause }),
          ),
        ),
  }
}

/** Service tag for reading and replacing active tools. */
class PiTools extends Context.Service<PiTools, PiToolsService>()('pi-effect/PiTools') {}

export { createPiToolsService, type EffectToolDefinition, type PiToolResult, PiTools, type PiToolsService }
