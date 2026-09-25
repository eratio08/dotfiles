import { Effect } from 'effect'
import type { PiCommandContextValue, PiContextValue, PiSessionContextValue, PiToolContextValue } from './services.ts'
import { PiCommandContext, PiContext, PiSessionContext, PiToolContext } from './services.ts'

/** Optional abort signals supplied by Pi callbacks and callers. */
type PiInvocationSignals = readonly (AbortSignal | undefined)[]

/**
 * Combines defined signals so the result aborts when any input signal aborts.
 * Returns `undefined` when no signals are defined.
 * @param signals Optional signals from Pi and the caller.
 * @returns A combined signal, or `undefined` when no signals are defined.
 */
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

/**
 * Provides invocation context to an Effect and removes `PiContext` from its requirements.
 * @param program Effect that requires `PiContext`.
 * @param context Context value provided to the Effect.
 * @returns The same Effect with `PiContext` removed from its requirements.
 */
function providePiContext<A, E, R>(
  program: Effect.Effect<A, E, R>,
  context: PiContextValue,
): Effect.Effect<A, E, Exclude<R, PiContext>> {
  return Effect.provideService(program, PiContext, context)
}

/**
 * Provides session context to an Effect and removes `PiSessionContext` from its requirements.
 * @param program Effect that requires `PiSessionContext`.
 * @param context Session context value provided to the Effect.
 * @returns The same Effect with `PiSessionContext` removed from its requirements.
 */
function providePiSessionContext<A, E, R>(
  program: Effect.Effect<A, E, R>,
  context: PiSessionContextValue,
): Effect.Effect<A, E, Exclude<R, PiSessionContext>> {
  return Effect.provideService(program, PiSessionContext, context)
}

/**
 * Provides command context to an Effect and removes `PiCommandContext` from its requirements.
 * @param program Effect that requires `PiCommandContext`.
 * @param context Command context value provided to the Effect.
 * @returns The same Effect with `PiCommandContext` removed from its requirements.
 */
function providePiCommandContext<A, E, R>(
  program: Effect.Effect<A, E, R>,
  context: PiCommandContextValue,
): Effect.Effect<A, E, Exclude<R, PiCommandContext>> {
  return Effect.provideService(program, PiCommandContext, context)
}

/**
 * Provides tool context to an Effect and removes `PiToolContext` from its requirements.
 * @param program Effect that requires `PiToolContext`.
 * @param context Tool context value provided to the Effect.
 * @returns The same Effect with `PiToolContext` removed from its requirements.
 */
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
