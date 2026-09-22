import type { AgentToolResult, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { Effect } from 'effect'
import type { Static, TSchema } from 'typebox'
import type { PiToolContext } from './services.ts'

type PiToolResult<Details = unknown> = Pick<AgentToolResult<Details>, 'content' | 'details'>

type EffectToolDefinition<Params extends TSchema, Services, Failure, Details = unknown> = Omit<
  ToolDefinition<Params, Details>,
  'execute'
> & {
  readonly promptSnippet: string
  readonly promptGuidelines: readonly string[]
  readonly execute: (params: Static<Params>) => Effect.Effect<PiToolResult<Details>, Failure, Services | PiToolContext>
}

export type { EffectToolDefinition, PiToolResult }
