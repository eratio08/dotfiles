import type { AgentToolResult, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { Effect } from 'effect'
import type { Static, TSchema } from 'typebox'
import type { PiToolContext } from './services.ts'

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

export type { EffectToolDefinition, PiToolResult }
