import { Effect } from 'effect'
import type { PiCommandContextValue, PiContextValue, PiSessionContextValue, PiToolContextValue } from './services.ts'
import { PiCommandContext, PiContext, PiSessionContext, PiToolContext } from './services.ts'

type PiInvocationSignals = readonly (AbortSignal | undefined)[]

function combinePiAbortSignals(...signals: PiInvocationSignals): AbortSignal | undefined {
  const defined = signals.filter((signal): signal is AbortSignal => signal !== undefined)
  if (defined.length === 0) return undefined
  if (defined.length === 1) return defined[0]
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(defined)

  const controller = new AbortController()
  const abort = (): void => controller.abort()
  for (const signal of defined) {
    if (signal.aborted) {
      abort()
      break
    }
    signal.addEventListener('abort', abort, { once: true })
  }
  return controller.signal
}

function providePiContext<A, E, R>(
  program: Effect.Effect<A, E, R>,
  context: PiContextValue,
): Effect.Effect<A, E, Exclude<R, PiContext>> {
  return Effect.provideService(program, PiContext, context)
}

function providePiSessionContext<A, E, R>(
  program: Effect.Effect<A, E, R>,
  context: PiSessionContextValue,
): Effect.Effect<A, E, Exclude<R, PiSessionContext>> {
  return Effect.provideService(program, PiSessionContext, context)
}

function providePiCommandContext<A, E, R>(
  program: Effect.Effect<A, E, R>,
  context: PiCommandContextValue,
): Effect.Effect<A, E, Exclude<R, PiCommandContext>> {
  return Effect.provideService(program, PiCommandContext, context)
}

function providePiToolContext<A, E, R>(
  program: Effect.Effect<A, E, R>,
  context: PiToolContextValue,
): Effect.Effect<A, E, Exclude<R, PiToolContext>> {
  return Effect.provideService(program, PiToolContext, context)
}

export {
  combinePiAbortSignals,
  type PiInvocationSignals,
  providePiCommandContext,
  providePiContext,
  providePiSessionContext,
  providePiToolContext,
}
