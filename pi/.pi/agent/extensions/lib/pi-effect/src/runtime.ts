import { type Effect, type Layer, ManagedRuntime } from 'effect'
import { combinePiAbortSignals } from './context.ts'
import { PiRuntimeDisposedError } from './errors.ts'

/** Layer used to provide the services managed by a Pi runtime. */
type PiRuntimeLayer<Services, LayerError = never> = Layer.Layer<Services, LayerError, never>

/** Managed Effect runtime with abort-signal support and an explicit shutdown phase. */
type PiManagedRuntime<Services, _LayerError = never> = {
  /** Runs a program unless shutdown has begun and combines its abort signals.
   * Rejects with `PiRuntimeDisposedError` after `beginShutdown`.
   */
  readonly run: <A, E>(
    program: Effect.Effect<A, E, Services>,
    signals?: readonly (AbortSignal | undefined)[],
  ) => Promise<A>
  /** Runs a shutdown program without checking the closing flag.
   * Use this for cleanup work before calling `dispose`.
   */
  readonly runShutdown: <A, E>(
    program: Effect.Effect<A, E, Services>,
    signals?: readonly (AbortSignal | undefined)[],
  ) => Promise<A>
  /** Prevents later calls to `run` while allowing `runShutdown` calls. */
  readonly beginShutdown: () => void
  /** Begins shutdown and disposes the managed runtime once. */
  readonly dispose: () => Promise<void>
  /** Reports whether shutdown has begun. */
  readonly isClosing: () => boolean
}

/**
 * Creates a managed runtime for a layer that has no unsatisfied service requirements.
 * @param layer Layer that provides the runtime services.
 * @returns Runtime operations for running programs and managing shutdown.
 */
function createPiManagedRuntime<Services, LayerError>(
  layer: PiRuntimeLayer<Services, LayerError>,
): PiManagedRuntime<Services, LayerError> {
  const managed = ManagedRuntime.make(layer)
  let closing = false
  let disposal: Promise<void> | undefined

  const beginShutdown = (): void => {
    closing = true
  }

  const dispose = (): Promise<void> => {
    if (disposal) return disposal
    beginShutdown()
    disposal = managed.dispose()
    return disposal
  }

  const runManaged = <A, E>(
    program: Effect.Effect<A, E, Services>,
    signals: readonly (AbortSignal | undefined)[] = [],
  ): Promise<A> => {
    const signal = combinePiAbortSignals(...signals)
    return managed.runPromise(program, signal === undefined ? undefined : { signal })
  }

  const run = <A, E>(
    program: Effect.Effect<A, E, Services>,
    signals: readonly (AbortSignal | undefined)[] = [],
  ): Promise<A> => {
    if (closing) {
      return Promise.reject(
        new PiRuntimeDisposedError({
          operation: 'run',
          message: 'The Pi Effect runtime has been disposed.',
        }),
      )
    }
    return runManaged(program, signals)
  }

  return {
    run,
    runShutdown: runManaged,
    beginShutdown,
    dispose,
    isClosing: () => closing,
  }
}

export { createPiManagedRuntime, type PiManagedRuntime, type PiRuntimeLayer }
