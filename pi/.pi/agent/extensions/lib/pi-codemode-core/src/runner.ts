import { randomUUID } from 'node:crypto'
import { MessageChannel, Worker } from 'node:worker_threads'
import { Cause, Clock, Context, Effect, Exit, Fiber, Queue, Result, Schema } from 'effect'
import type { Scope } from 'effect/Scope'
import * as Program from './program.ts'
import * as Vm from './vm.ts'
import * as WorkerProtocol from './worker-protocol.ts'

type CodeModeDeadline = {
  readonly remainingTimeoutMs: () => number
  readonly signal: AbortSignal
  readonly isTimedOut: () => boolean
  readonly dispose: () => void
}

/**
 * Creates a runner that validates and evaluates programs using an operation invoker from the Effect environment.
 */
function createProgramRunner<R, E>(): Program.ProgramRunner<R, E> {
  const operationInvokerService = Program.ProgramOperationInvoker<R, E>()

  const evaluate = Effect.fnUntraced(
    function* (
      definitionInput: Program.ProgramDefinition,
      codeInput: string,
      optionsInput: Program.ProgramRunOptions,
    ): Effect.fn.Return<
      unknown,
      Program.ProgramFailure | E,
      R | Program.ProgramOperationInvokerRequirement<R, E> | Scope
    > {
      const definition = yield* Schema.decodeUnknownEffect(Program.CodeModeDefinitionSchema)(definitionInput).pipe(
        Effect.mapError((cause) =>
          Program.createProgramFailure({
            _tag: 'validation',
            operation: 'definition',
            message: Program.getCodeModeSchemaFailureMessage(cause, 'The code mode definition is invalid.'),
          }),
        ),
      )
      const options = yield* Schema.decodeUnknownEffect(Program.CodeModeRunOptionsSchema)(optionsInput).pipe(
        Effect.mapError((cause) =>
          Program.createProgramFailure({
            _tag: 'validation',
            operation: 'options',
            message: Program.getCodeModeSchemaFailureMessage(cause, 'The code mode run options are invalid.'),
          }),
        ),
      )
      const code = yield* Schema.decodeUnknownEffect(Program.CodeModeSourceSchema)(codeInput).pipe(
        Effect.mapError((cause) =>
          Program.createProgramFailure({
            _tag: 'validation',
            operation: 'source',
            message: Program.getCodeModeSchemaFailureMessage(cause, 'The code mode source is invalid.'),
          }),
        ),
      )

      const deadline = yield* createCodeModeDeadline(options.signal, options.timeoutMs)
      const deadlineFailure = getCodeModeDeadlineFailure(deadline, options.timeoutMs)
      if (deadlineFailure !== undefined) return yield* Effect.fail(deadlineFailure)

      const importError = Vm.validateCodeModeImports(code)
      if (importError !== undefined) return yield* Effect.fail(importError)
      const { filename, transformed } = yield* Effect.try({
        try: () => {
          const filename = Vm.createCodeModeFilename(options.cwd, options.filenamePrefix, randomUUID())
          return {
            filename,
            transformed: Vm.transformCodeModeProgram(Vm.createCodeModeJiti(), definition, code, filename),
          }
        },
        catch: (cause: unknown) =>
          Program.createProgramFailure({
            _tag: 'transform',
            operation: 'transform',
            message: 'The TypeScript program could not be prepared.',
            cause,
          }),
      })
      if (deadline.isTimedOut())
        return yield* Effect.fail(createCodeModeTimeoutFailure('evaluation', options.timeoutMs))

      const operationInvoker = yield* operationInvokerService
      const queue = yield* createCodeModeRequestQueue<R, E>()
      const invokeSync = (method: string, args: readonly unknown[]): unknown => {
        const methodDefinition = Program.findProgramMethod(definition, method)
        if (methodDefinition === undefined || methodDefinition.kind !== 'sync')
          throw Program.createProgramFailure({
            _tag: 'validation',
            operation: 'method',
            message: `The code mode method ${method} is not synchronous.`,
          })
        if (operationInvoker.invokeSync === undefined)
          throw Program.createProgramFailure({
            _tag: 'invoke',
            operation: method,
            message: `The program operation invoker does not implement synchronous method ${method}.`,
          })
        return operationInvoker.invokeSync(method, args)
      }
      const api = Vm.createCodeModeApi(definition.methods, invokeSync, (method, args) =>
        queue.invoke(method, args, deadline.signal),
      )
      const execution = options.execution === 'in-process' ? runInProcess() : runInWorker()
      const result = yield* Effect.catchCause(execution, (cause) =>
        recoverCodeModeCause(cause, deadline, options.timeoutMs),
      )
      const executionDeadlineFailure = getCodeModeDeadlineFailure(deadline, options.timeoutMs)
      if (executionDeadlineFailure !== undefined) return yield* Effect.fail(executionDeadlineFailure)
      return yield* Effect.try({
        try: () => {
          structuredClone(result)
          return result
        },
        catch: (cause: unknown) =>
          Program.createProgramFailure({
            _tag: 'serialize',
            operation: 'result',
            message: 'The code mode result is not structured-cloneable.',
            cause,
          }),
      })

      function runInProcess(): Effect.Effect<unknown, Program.ProgramFailure | E, R> {
        return Effect.tryPromise<unknown, Program.ProgramFailure | E>({
          try: () =>
            Vm.runCodeModeVm(
              transformed,
              api,
              filename,
              options.timeoutMs,
              undefined,
              deadline.signal,
              deadline.remainingTimeoutMs,
            ),
          catch: (cause: unknown) => mapCodeModeCause(cause, deadline, options.timeoutMs, 'invoke'),
        })
      }

      function runInWorker(): Effect.Effect<
        unknown,
        Program.ProgramFailure | E,
        R | Program.ProgramOperationInvokerRequirement<R, E>
      > {
        return runCodeModeWorkerEvaluation<R, E>(
          definition,
          transformed,
          filename,
          options.timeoutMs,
          deadline.remainingTimeoutMs,
          deadline.signal,
        ).pipe(
          Effect.provideService(CodeModeRequestQueueService, queue),
          Effect.catch((cause) => Effect.fail(mapCodeModeCause(cause, deadline, options.timeoutMs, 'worker'))),
        )
      }
    },
    (effect) => Effect.scoped(effect),
  )

  return { evaluate }
}

const createCodeModeDeadline = Effect.fnUntraced(function* (
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): Effect.fn.Return<CodeModeDeadline, never, Scope> {
  const effectSignal = yield* Effect.abortSignal
  return yield* Clock.clockWith((clock) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const controller = new AbortController()
        const signals = [effectSignal, callerSignal].filter((signal): signal is AbortSignal => signal !== undefined)
        const startedAt = clock.monotonicTimeNanosUnsafe()
        let timedOut = false
        let cancelled = signals.some((signal) => signal.aborted)
        const remainingTimeoutMs = (): number =>
          Math.max(0, Math.ceil(timeoutMs - Number(clock.monotonicTimeNanosUnsafe() - startedAt) / 1_000_000))
        const abort = (): void => {
          if (!timedOut && !cancelled) {
            if (remainingTimeoutMs() === 0) timedOut = true
            else cancelled = true
          }
          controller.abort()
        }
        const timeoutId = setTimeout(() => {
          if (!cancelled) timedOut = true
          controller.abort()
        }, timeoutMs)
        if (cancelled) controller.abort()
        else for (const signal of signals) signal.addEventListener('abort', abort, { once: true })
        return {
          remainingTimeoutMs,
          signal: controller.signal,
          isTimedOut: () => timedOut || (!cancelled && remainingTimeoutMs() === 0),
          dispose: () => {
            clearTimeout(timeoutId)
            for (const signal of signals) signal.removeEventListener('abort', abort)
          },
        }
      }),
      (deadline) => Effect.sync(deadline.dispose),
    ),
  )
})

function getCodeModeDeadlineFailure(deadline: CodeModeDeadline, timeoutMs: number): Program.ProgramFailure | undefined {
  if (deadline.isTimedOut()) return createCodeModeTimeoutFailure('evaluation', timeoutMs)
  if (deadline.signal.aborted) return createCodeModeCancellationFailure('evaluation')
  return undefined
}

function mapCodeModeCause<E>(
  cause: unknown,
  deadline: CodeModeDeadline,
  timeoutMs: number,
  operation: 'invoke' | 'worker',
): Program.ProgramFailure | E {
  const deadlineFailure = getCodeModeDeadlineFailure(deadline, timeoutMs)
  if (deadlineFailure !== undefined) return deadlineFailure
  if (Program.isCodeModeHostError<E>(cause)) return cause.value
  if (Program.isProgramFailure(cause)) return cause
  return Program.createProgramFailure({
    _tag: operation,
    operation,
    message: `The code mode program failed during ${operation}.`,
    cause,
  })
}

function recoverCodeModeCause<E>(
  cause: Cause.Cause<Program.ProgramFailure | E>,
  deadline: CodeModeDeadline,
  timeoutMs: number,
): Effect.Effect<never, Program.ProgramFailure | E> {
  if (Cause.hasInterrupts(cause))
    return Effect.fail(
      getCodeModeDeadlineFailure(deadline, timeoutMs) ?? createCodeModeCancellationFailure('evaluation'),
    )
  return Effect.failCause(cause)
}

function createCodeModeCancellationFailure(operation: 'evaluation' | 'worker'): Program.ProgramFailure {
  return Program.createProgramFailure({
    _tag: 'cancellation',
    operation,
    message: 'The code mode evaluation was cancelled.',
  })
}

function createCodeModeTimeoutFailure(operation: 'evaluation' | 'worker', timeoutMs: number): Program.ProgramFailure {
  return Program.createProgramFailure({
    _tag: 'timeout',
    operation,
    message: `The code mode evaluation timed out after ${timeoutMs}ms.`,
  })
}

type CodeModeRequestQueue = {
  readonly invoke: (method: string, args: readonly unknown[], signal: AbortSignal) => Promise<unknown>
}

declare const codeModeRequestQueueTag: unique symbol

type CodeModeRequestQueueRequirement = {
  readonly [codeModeRequestQueueTag]: CodeModeRequestQueue
}

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

const createCodeModeRequestQueue = Effect.fnUntraced(function* <R, E>(): Effect.fn.Return<
  CodeModeRequestQueue,
  never,
  R | Program.ProgramOperationInvokerRequirement<R, E> | Scope
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
                request.reject(
                  Program.isProgramFailure(error.success)
                    ? error.success
                    : Program.createCodeModeHostError(error.success),
                )
              else request.reject(Cause.squash(exit.cause))
            }
          }
        }
      }),
    ),
  )

  const createCodeModeQueueClosedFailure = (): Program.ProgramFailure =>
    Program.createProgramFailure({
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
          Program.createProgramFailure({
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
): Effect.fn.Return<unknown, E | Program.ProgramFailure, R | Program.ProgramOperationInvokerRequirement<R, E>> {
  const operationInvoker = yield* Program.ProgramOperationInvoker<R, E>()
  const effect = yield* Effect.try({
    try: () => operationInvoker.invoke(request.method, request.args, request.signal),
    catch: (cause: unknown) =>
      Program.createProgramFailure({
        _tag: 'invoke',
        operation: request.method,
        message: 'The program operation invoker failed before returning an Effect.',
        cause,
      }),
  })
  return yield* Effect.raceFirst(effect, waitForCodeModeAbort(request.signal))
})

function waitForCodeModeAbort(signal: AbortSignal): Effect.Effect<never, Program.ProgramFailure> {
  return Effect.callback((resume) => {
    const abort = (): void =>
      resume(
        Effect.fail(
          Program.createProgramFailure({
            _tag: 'cancellation',
            operation: 'host',
            message: 'The program operation invoker call was cancelled.',
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

type CodeModeFailureLike = ReturnType<typeof Program.createProgramFailure>

const runCodeModeWorkerEvaluation = Effect.fnUntraced(function* <R, E>(
  definition: Program.ProgramDefinition,
  code: string,
  filename: string,
  timeoutMs: number,
  remainingTimeoutMs: () => number,
  signal: AbortSignal,
): Effect.fn.Return<
  unknown,
  CodeModeFailureLike | Program.CodeModeHostError<E> | E,
  R | Program.ProgramOperationInvokerRequirement<R, E> | CodeModeRequestQueueRequirement
> {
  const operationInvoker = yield* Program.ProgramOperationInvoker<R, E>()
  const queue = yield* CodeModeRequestQueueService
  const invokeSync: Vm.CodeModeSyncInvoker =
    operationInvoker.invokeSync ??
    ((method: string): unknown => {
      throw Program.createProgramFailure({
        _tag: 'invoke',
        operation: method,
        message: `The program operation invoker does not implement synchronous method ${method}.`,
      })
    })
  const acquireWorker: Effect.Effect<Worker, CodeModeFailureLike> = signal.aborted
    ? Effect.fail(createCodeModeCancellationFailure('worker'))
    : Effect.try({
        try: () => {
          const workerExtension = import.meta.url.endsWith('.ts') ? 'ts' : 'js'
          const workerUrl = new URL(`./worker.${workerExtension}`, import.meta.url)
          const workerOptions = createCodeModeWorkerOptions()
          return new Worker(workerUrl, workerOptions)
        },
        catch: (cause: unknown) =>
          Program.createProgramFailure({
            _tag: 'worker',
            operation: 'start',
            message: 'The code mode worker could not start.',
            cause,
          }),
      })

  return yield* Effect.acquireUseRelease(
    acquireWorker,
    (worker) =>
      Effect.callback<unknown, CodeModeFailureLike | Program.CodeModeHostError<E> | E>((resume, effectSignal) => {
        let channel: MessageChannel
        let syncState: SharedArrayBuffer
        try {
          channel = new MessageChannel()
          syncState = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
        } catch (cause) {
          resume(
            Effect.fail(
              Program.createProgramFailure({
                _tag: 'worker',
                operation: 'start',
                message: 'The code mode worker resources could not be created.',
                cause,
              }),
            ),
          )
          return
        }
        const syncPort = channel.port1
        const workerSyncPort = channel.port2
        let settled = false
        let cleaned = false
        let lastRequestId = 0
        let timeoutId: ReturnType<typeof setTimeout> | undefined
        let abort: () => void = () => undefined

        const cleanup = (): void => {
          if (cleaned) return
          cleaned = true
          if (timeoutId !== undefined) clearTimeout(timeoutId)
          signal.removeEventListener('abort', abort)
          effectSignal.removeEventListener('abort', abort)
          syncPort.close()
          worker.removeAllListeners()
        }

        const finishSuccess = (value: unknown): void => {
          if (settled) return
          settled = true
          cleanup()
          resume(Effect.succeed(value))
        }

        const finishFailure = (error: CodeModeFailureLike | Program.CodeModeHostError<E> | E): void => {
          if (settled) return
          settled = true
          cleanup()
          resume(Effect.fail(error))
        }

        abort = (): void => finishFailure(createCodeModeCancellationFailure('worker'))

        const notifySyncWaiter = (): void => {
          const state = new Int32Array(syncState)
          Atomics.store(state, 0, 1)
          Atomics.notify(state, 0)
        }

        const postSyncResponse = (response: WorkerProtocol.CodeModeSyncResponse): void => {
          try {
            syncPort.postMessage(response)
          } catch (cause) {
            try {
              syncPort.postMessage({
                type: 'sync-result',
                id: response.id,
                ok: false,
                error: WorkerProtocol.serializeProgramError(
                  Program.createProgramFailure({
                    _tag: 'serialize',
                    operation: 'sync-result',
                    message: 'The code mode parent could not serialize a synchronous response.',
                    cause,
                  }),
                ),
              })
            } catch (postCause) {
              finishFailure(
                Program.createProgramFailure({
                  _tag: 'transport',
                  operation: 'sync-result',
                  message: 'The code mode parent could not send a synchronous response.',
                  cause: postCause,
                }),
              )
            }
          } finally {
            notifySyncWaiter()
          }
        }

        const handleSyncRequest = (message: unknown): void => {
          let request: WorkerProtocol.CodeModeSyncRequest
          try {
            request = Schema.decodeUnknownSync(WorkerProtocol.CodeModeSyncRequestSchema)(message)
          } catch {
            notifySyncWaiter()
            finishFailure(
              Program.createProgramFailure({
                _tag: 'transport',
                operation: 'sync-call',
                message: 'The code mode worker sent an invalid synchronous request.',
              }),
            )
            return
          }
          if (!acceptCodeModeRequestId(request.id)) {
            postSyncResponse({
              type: 'sync-result',
              id: request.id,
              ok: false,
              error: WorkerProtocol.serializeProgramError(
                Program.createProgramFailure({
                  _tag: 'transport',
                  operation: 'sync-call',
                  message: 'The code mode worker sent a non-monotonic request id.',
                }),
              ),
            })
            return
          }
          const method = definition.methods.find((candidate) => candidate.name === request.method)
          let response: WorkerProtocol.CodeModeSyncResponse
          try {
            if (method === undefined || method.kind !== 'sync')
              throw Program.createProgramFailure({
                _tag: 'validation',
                operation: 'method',
                message: `The code mode method ${request.method} is not a synchronous method.`,
              })
            const value = invokeSync(request.method, request.args)
            if (Vm.isCodeModePromiseLike(value))
              throw Program.createProgramFailure({
                _tag: 'transport',
                operation: request.method,
                message: `The synchronous code mode method ${request.method} returned a Promise.`,
              })
            response = { type: 'sync-result', id: request.id, ok: true, value }
          } catch (cause) {
            response = {
              type: 'sync-result',
              id: request.id,
              ok: false,
              error: WorkerProtocol.serializeProgramError(cause, operationInvoker.errorCodec),
            }
          }
          postSyncResponse(response)
        }

        const postAsyncResponse = (response: WorkerProtocol.CodeModeAsyncResponse): void => {
          if (settled) return
          try {
            worker.postMessage(response)
          } catch (cause) {
            try {
              worker.postMessage({
                type: 'async-result',
                id: response.id,
                ok: false,
                error: WorkerProtocol.serializeProgramError(
                  Program.createProgramFailure({
                    _tag: 'serialize',
                    operation: 'async-result',
                    message: 'The code mode parent could not serialize an asynchronous response.',
                    cause,
                  }),
                ),
              } satisfies WorkerProtocol.CodeModeAsyncResponse)
            } catch (postCause) {
              finishFailure(
                Program.createProgramFailure({
                  _tag: 'transport',
                  operation: 'async-result',
                  message: 'The code mode parent could not send an asynchronous response.',
                  cause: postCause,
                }),
              )
            }
          }
        }

        const handleAsyncRequest = (message: unknown): void => {
          let request: WorkerProtocol.CodeModeAsyncRequest
          try {
            request = Schema.decodeUnknownSync(WorkerProtocol.CodeModeAsyncRequestSchema)(message)
          } catch {
            finishFailure(
              Program.createProgramFailure({
                _tag: 'transport',
                operation: 'async-call',
                message: 'The code mode worker sent an invalid asynchronous request.',
              }),
            )
            return
          }
          if (!acceptCodeModeRequestId(request.id)) {
            postAsyncResponse({
              type: 'async-result',
              id: request.id,
              ok: false,
              error: WorkerProtocol.serializeProgramError(
                Program.createProgramFailure({
                  _tag: 'transport',
                  operation: 'async-call',
                  message: 'The code mode worker sent a non-monotonic request id.',
                }),
              ),
            })
            return
          }
          const method = definition.methods.find((candidate) => candidate.name === request.method)
          if (method === undefined || method.kind !== 'async') {
            postAsyncResponse({
              type: 'async-result',
              id: request.id,
              ok: false,
              error: WorkerProtocol.serializeProgramError(
                Program.createProgramFailure({
                  _tag: 'validation',
                  operation: 'method',
                  message: `The code mode method ${request.method} is not an asynchronous method.`,
                }),
              ),
            })
            return
          }
          queue.invoke(request.method, request.args, signal).then(
            (value) => postAsyncResponse({ type: 'async-result', id: request.id, ok: true, value }),
            (cause) =>
              postAsyncResponse({
                type: 'async-result',
                id: request.id,
                ok: false,
                error: WorkerProtocol.serializeProgramError(cause, operationInvoker.errorCodec),
              }),
          )
        }

        const acceptCodeModeRequestId = (id: number): boolean => {
          if (id <= lastRequestId) return false
          lastRequestId = id
          return true
        }

        const handleWorkerMessage = (message: unknown): void => {
          try {
            const decoded = Schema.decodeUnknownSync(WorkerProtocol.CodeModeWorkerMessageSchema)(message)
            if (decoded.type === 'async-call') {
              handleAsyncRequest(decoded)
            } else if (decoded.type === 'result') {
              finishSuccess(decoded.value)
            } else if (decoded.type === 'error') {
              finishFailure(
                decoded.error.kind === 'host'
                  ? WorkerProtocol.deserializeCodeModeHostError(decoded.error, operationInvoker.errorCodec)
                  : WorkerProtocol.deserializeProgramError(decoded.error),
              )
            } else {
              finishFailure(
                Program.createProgramFailure({
                  _tag: 'transport',
                  operation: 'worker-message',
                  message: 'The code mode worker sent an unexpected message type.',
                }),
              )
            }
            return
          } catch {
            try {
              const decoded = Schema.decodeUnknownSync(WorkerProtocol.CodeModeWorkerFailureMessageSchema)(message)
              finishFailure(WorkerProtocol.deserializeProgramError(decoded.error, operationInvoker.errorCodec))
              return
            } catch {
              finishFailure(
                Program.createProgramFailure({
                  _tag: 'transport',
                  operation: 'worker-message',
                  message: 'The code mode worker sent an invalid message.',
                }),
              )
            }
          }
        }

        try {
          syncPort.on('message', handleSyncRequest)
          worker.on('message', handleWorkerMessage)
          worker.on('error', (cause) =>
            finishFailure(
              Program.createProgramFailure({
                _tag: 'worker',
                operation: 'runtime',
                message: 'The code mode worker failed.',
                cause,
              }),
            ),
          )
          worker.on('exit', (code) => {
            if (!settled)
              finishFailure(
                Program.createProgramFailure({
                  _tag: 'worker',
                  operation: 'exit',
                  message: `The code mode worker exited with code ${code}.`,
                }),
              )
          })
          signal.addEventListener('abort', abort, { once: true })
          effectSignal.addEventListener('abort', abort, { once: true })
          const remainingMs = remainingTimeoutMs()
          if (remainingMs === 0) finishFailure(createCodeModeTimeoutFailure('worker', timeoutMs))
          else {
            timeoutId = setTimeout(() => finishFailure(createCodeModeTimeoutFailure('worker', timeoutMs)), remainingMs)
            if (signal.aborted || effectSignal.aborted) abort()
            if (!settled)
              worker.postMessage(
                {
                  type: 'start',
                  code,
                  filename,
                  timeoutMs,
                  remainingTimeoutMs: remainingMs,
                  methods: definition.methods,
                  syncState,
                  syncPort: workerSyncPort,
                } satisfies WorkerProtocol.CodeModeWorkerStart,
                [workerSyncPort],
              )
          }
        } catch (cause) {
          finishFailure(
            Program.createProgramFailure({
              _tag: 'worker',
              operation: 'start',
              message: 'The worker start message failed.',
              cause,
            }),
          )
        }
        return Effect.sync(cleanup)
      }),
    (worker) =>
      Effect.tryPromise({
        try: () => worker.terminate(),
        catch: (cause: unknown) =>
          Program.createProgramFailure({
            _tag: 'worker',
            operation: 'terminate',
            message: 'The code mode worker could not terminate.',
            cause,
          }),
      }).pipe(Effect.ignoreCause),
  )
})

function createCodeModeWorkerOptions(): { readonly execArgv?: string[] } | undefined {
  const execArgv = process.execArgv.filter((argument) => !argument.startsWith('--input-type'))
  return execArgv.length === process.execArgv.length ? undefined : { execArgv }
}

export { createProgramRunner }
