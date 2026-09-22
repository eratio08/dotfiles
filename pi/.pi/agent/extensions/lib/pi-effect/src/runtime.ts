import { type Effect, type Layer, ManagedRuntime } from 'effect'
import { combinePiAbortSignals } from './context.ts'
import { PiRuntimeDisposedError } from './errors.ts'

type PiRuntimeLayer<Services, LayerError = never> = Layer.Layer<Services, LayerError, never>

interface PiManagedRuntime<Services, _LayerError = never> {
  readonly run: <A, E>(
    program: Effect.Effect<A, E, Services>,
    signals?: readonly (AbortSignal | undefined)[],
  ) => Promise<A>
  readonly runShutdown: <A, E>(
    program: Effect.Effect<A, E, Services>,
    signals?: readonly (AbortSignal | undefined)[],
  ) => Promise<A>
  readonly beginShutdown: () => void
  readonly dispose: () => Promise<void>
  readonly isClosing: () => boolean
}

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
