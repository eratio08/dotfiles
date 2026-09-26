import { Cause, Context, Effect, Exit, Fiber, Queue, Result } from 'effect'
import type { Scope } from 'effect/Scope'
import type { ProgramHostRequirement } from './contract.ts'
import { ProgramHost } from './contract.ts'
import { createCodeModeHostError, createProgramFailure, isProgramFailure, type ProgramFailure } from './failure.ts'

/** Handles asynchronous host calls for one code mode evaluation. */
type CodeModeRequestQueue = {
  readonly invoke: (method: string, args: readonly unknown[], signal: AbortSignal) => Promise<unknown>
}

declare const codeModeRequestQueueTag: unique symbol

/** Marks effects that require the request queue scoped to one evaluation. */
type CodeModeRequestQueueRequirement = {
  readonly [codeModeRequestQueueTag]: CodeModeRequestQueue
}

/** Provides the request queue scoped to one code mode evaluation. */
const CodeModeRequestQueueService = Context.Service<CodeModeRequestQueueRequirement, CodeModeRequestQueue>(
  '@eratio/pi-codemode-core/CodeModeRequestQueue',
)

type CodeModeQueuedRequest = {
  readonly method: string
  readonly args: readonly unknown[]
  readonly signal: AbortSignal
  readonly resolve: (value: unknown) => void
  readonly reject: (cause: unknown) => void
  removeAbortListener: () => void
  settled: boolean
  cancelled: boolean
}

/** Creates a scoped queue that runs asynchronous host calls in order. */
const createCodeModeRequestQueue = Effect.fnUntraced(function* <R, E>(): Effect.fn.Return<
  CodeModeRequestQueue,
  never,
  R | ProgramHostRequirement<R, E> | Scope
> {
  const requests = yield* Queue.unbounded<CodeModeQueuedRequest>()
  const pending = new Set<CodeModeQueuedRequest>()
  let closed = false

  const worker = yield* Effect.forkChild(
    Effect.forever(
      Effect.gen(function* () {
        const request = yield* Queue.take(requests)
        if (request.cancelled || closed) {
          pending.delete(request)
        } else {
          const exit = yield* Effect.exit(runCodeModeHostRequest<R, E>(request))
          pending.delete(request)
          request.removeAbortListener()
          if (!request.settled) {
            request.settled = true
            if (Exit.isSuccess(exit)) request.resolve(exit.value)
            else {
              const error = Cause.findError(exit.cause)
              if (Result.isSuccess(error))
                request.reject(isProgramFailure(error.success) ? error.success : createCodeModeHostError(error.success))
              else request.reject(Cause.squash(exit.cause))
            }
          }
        }
      }),
    ),
  )

  const createCodeModeQueueClosedFailure = (): ProgramFailure =>
    createProgramFailure({
      _tag: 'cancellation',
      operation: 'queue',
      message: 'The code mode request queue is closed.',
    })

  const invoke = (method: string, args: readonly unknown[], signal: AbortSignal): Promise<unknown> => {
    if (closed) return Promise.reject(createCodeModeQueueClosedFailure())
    return new Promise((resolve, reject) => {
      if (closed) {
        reject(createCodeModeQueueClosedFailure())
        return
      }
      const request: CodeModeQueuedRequest = {
        method,
        args,
        signal,
        resolve,
        reject,
        removeAbortListener: () => undefined,
        settled: false,
        cancelled: false,
      }
      const abort = (): void => {
        request.cancelled = true
        request.removeAbortListener()
        if (request.settled) return
        request.settled = true
        reject(
          createProgramFailure({
            _tag: 'cancellation',
            operation: method,
            message: 'The code mode call was cancelled.',
          }),
        )
      }
      request.removeAbortListener = () => signal.removeEventListener('abort', abort)
      if (signal.aborted) {
        abort()
        return
      }
      signal.addEventListener('abort', abort, { once: true })
      pending.add(request)
      if (!Queue.offerUnsafe(requests, request)) {
        pending.delete(request)
        request.removeAbortListener()
        abort()
      }
    })
  }

  return yield* Effect.acquireRelease(Effect.succeed({ invoke }), () =>
    Effect.gen(function* () {
      closed = true
      const failure = createCodeModeQueueClosedFailure()
      for (const request of pending) {
        request.cancelled = true
        request.removeAbortListener()
        if (!request.settled) {
          request.settled = true
          request.reject(failure)
        }
      }
      pending.clear()
      yield* Fiber.interrupt(worker)
      yield* Queue.shutdown(requests)
    }),
  )
})

const runCodeModeHostRequest = Effect.fnUntraced(function* <R, E>(
  request: CodeModeQueuedRequest,
): Effect.fn.Return<unknown, E | ProgramFailure, R | ProgramHostRequirement<R, E>> {
  const host = yield* ProgramHost<R, E>()
  const effect = yield* Effect.try({
    try: () => host.invoke(request.method, request.args, request.signal),
    catch: (cause: unknown) =>
      createProgramFailure({
        _tag: 'invoke',
        operation: request.method,
        message: 'The code mode host failed before returning an Effect.',
        cause,
      }),
  })
  return yield* Effect.raceFirst(effect, waitForCodeModeAbort(request.signal))
})

function waitForCodeModeAbort(signal: AbortSignal): Effect.Effect<never, ProgramFailure> {
  return Effect.callback((resume) => {
    const abort = (): void =>
      resume(
        Effect.fail(
          createProgramFailure({
            _tag: 'cancellation',
            operation: 'host',
            message: 'The code mode host call was cancelled.',
          }),
        ),
      )
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    return Effect.sync(() => signal.removeEventListener('abort', abort))
  })
}

export {
  type CodeModeRequestQueue,
  type CodeModeRequestQueueRequirement,
  CodeModeRequestQueueService,
  createCodeModeRequestQueue,
}
