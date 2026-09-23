import { MessageChannel, Worker } from 'node:worker_threads'
import { Effect, Schema } from 'effect'
import type { CodeModeDefinition, CodeModeEffectHostRequirement } from './code-mode-contract.ts'
import { CodeModeEffectHost } from './code-mode-contract.ts'
import type { CodeModeHostError } from './code-mode-failure.ts'
import {
  createCodeModeFailure,
  deserializeCodeModeError,
  deserializeCodeModeHostError,
  serializeCodeModeError,
} from './code-mode-failure.ts'
import type {
  CodeModeAsyncRequest,
  CodeModeAsyncResponse,
  CodeModeSyncRequest,
  CodeModeSyncResponse,
} from './code-mode-protocol.ts'
import type { CodeModeRequestQueueRequirement } from './code-mode-request-queue.ts'
import { CodeModeRequestQueueService } from './code-mode-request-queue.ts'
import {
  CodeModeAsyncRequestSchema,
  CodeModeSyncRequestSchema,
  CodeModeWorkerFailureMessageSchema,
  CodeModeWorkerMessageSchema,
} from './code-mode-schema.ts'
import { type CodeModeSyncInvoker, isCodeModePromiseLike } from './code-mode-vm.ts'

/** Runs a worker evaluation with host and queue services from the Effect environment. */
const runCodeModeWorkerEvaluation = Effect.fnUntraced(function* <R, E>(
  definition: CodeModeDefinition,
  code: string,
  filename: string,
  timeoutMs: number,
  remainingTimeoutMs: () => number,
  signal: AbortSignal,
): Effect.fn.Return<
  unknown,
  CodeModeFailureLike | CodeModeHostError<E> | E,
  R | CodeModeEffectHostRequirement<R, E> | CodeModeRequestQueueRequirement
> {
  const host = yield* CodeModeEffectHost<R, E>()
  const queue = yield* CodeModeRequestQueueService
  const invokeSync: CodeModeSyncInvoker =
    host.invokeSync ??
    ((method) => {
      throw createCodeModeFailure({
        _tag: 'invoke',
        operation: method,
        message: `The code mode host does not implement synchronous method ${method}.`,
      })
    })
  const acquireWorker: Effect.Effect<Worker, CodeModeFailureLike> = signal.aborted
    ? Effect.fail(createCodeModeCancellationFailure())
    : Effect.try({
        try: () => {
          const workerUrl = new URL('./code-mode-worker.ts', import.meta.url)
          const workerOptions = createCodeModeWorkerOptions()
          return new Worker(workerUrl, workerOptions)
        },
        catch: (cause) =>
          createCodeModeFailure({
            _tag: 'worker',
            operation: 'start',
            message: 'The code mode worker could not start.',
            cause,
          }),
      })

  return yield* Effect.acquireUseRelease(
    acquireWorker,
    (worker) =>
      Effect.callback<unknown, CodeModeFailureLike | CodeModeHostError<E> | E>((resume, effectSignal) => {
        let channel: MessageChannel
        let syncState: SharedArrayBuffer
        try {
          channel = new MessageChannel()
          syncState = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
        } catch (cause) {
          resume(
            Effect.fail(
              createCodeModeFailure({
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

        const finishFailure = (error: CodeModeFailureLike | CodeModeHostError<E> | E): void => {
          if (settled) return
          settled = true
          cleanup()
          resume(Effect.fail(error))
        }

        abort = (): void => finishFailure(createCodeModeCancellationFailure())

        const notifySyncWaiter = (): void => {
          const state = new Int32Array(syncState)
          Atomics.store(state, 0, 1)
          Atomics.notify(state, 0)
        }

        const postSyncResponse = (response: CodeModeSyncResponse): void => {
          try {
            syncPort.postMessage(response)
          } catch (cause) {
            try {
              syncPort.postMessage({
                type: 'sync-result',
                id: response.id,
                ok: false,
                error: serializeCodeModeError(
                  createCodeModeFailure({
                    _tag: 'serialize',
                    operation: 'sync-result',
                    message: 'The code mode parent could not serialize a synchronous response.',
                    cause,
                  }),
                ),
              })
            } catch (postCause) {
              finishFailure(
                createCodeModeFailure({
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
          let request: CodeModeSyncRequest
          try {
            request = Schema.decodeUnknownSync(CodeModeSyncRequestSchema)(message)
          } catch {
            notifySyncWaiter()
            finishFailure(
              createCodeModeFailure({
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
              error: serializeCodeModeError(
                createCodeModeFailure({
                  _tag: 'transport',
                  operation: 'sync-call',
                  message: 'The code mode worker sent a non-monotonic request id.',
                }),
              ),
            })
            return
          }
          const method = definition.methods.find((candidate) => candidate.name === request.method)
          let response: CodeModeSyncResponse
          try {
            if (method === undefined || method.kind !== 'sync')
              throw createCodeModeFailure({
                _tag: 'validation',
                operation: 'method',
                message: `The code mode method ${request.method} is not a synchronous method.`,
              })
            const value = invokeSync(request.method, request.args)
            if (isCodeModePromiseLike(value))
              throw createCodeModeFailure({
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
              error: serializeCodeModeError(cause, host.errorCodec),
            }
          }
          postSyncResponse(response)
        }

        const postAsyncResponse = (response: CodeModeAsyncResponse): void => {
          if (settled) return
          try {
            worker.postMessage(response)
          } catch (cause) {
            try {
              worker.postMessage({
                type: 'async-result',
                id: response.id,
                ok: false,
                error: serializeCodeModeError(
                  createCodeModeFailure({
                    _tag: 'serialize',
                    operation: 'async-result',
                    message: 'The code mode parent could not serialize an asynchronous response.',
                    cause,
                  }),
                ),
              } satisfies CodeModeAsyncResponse)
            } catch (postCause) {
              finishFailure(
                createCodeModeFailure({
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
          let request: CodeModeAsyncRequest
          try {
            request = Schema.decodeUnknownSync(CodeModeAsyncRequestSchema)(message)
          } catch {
            finishFailure(
              createCodeModeFailure({
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
              error: serializeCodeModeError(
                createCodeModeFailure({
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
              error: serializeCodeModeError(
                createCodeModeFailure({
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
                error: serializeCodeModeError(cause, host.errorCodec),
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
            const decoded = Schema.decodeUnknownSync(CodeModeWorkerMessageSchema)(message)
            if (decoded.type === 'async-call') {
              handleAsyncRequest(decoded)
            } else if (decoded.type === 'result') {
              finishSuccess(decoded.value)
            } else if (decoded.type === 'error') {
              finishFailure(
                decoded.error.kind === 'host'
                  ? deserializeCodeModeHostError(decoded.error, host.errorCodec)
                  : deserializeCodeModeError(decoded.error),
              )
            } else {
              finishFailure(
                createCodeModeFailure({
                  _tag: 'transport',
                  operation: 'worker-message',
                  message: 'The code mode worker sent an unexpected message type.',
                }),
              )
            }
            return
          } catch {
            try {
              const decoded = Schema.decodeUnknownSync(CodeModeWorkerFailureMessageSchema)(message)
              finishFailure(deserializeCodeModeError(decoded.error, host.errorCodec))
              return
            } catch {
              finishFailure(
                createCodeModeFailure({
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
              createCodeModeFailure({
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
                createCodeModeFailure({
                  _tag: 'worker',
                  operation: 'exit',
                  message: `The code mode worker exited with code ${code}.`,
                }),
              )
          })
          signal.addEventListener('abort', abort, { once: true })
          effectSignal.addEventListener('abort', abort, { once: true })
          const remainingMs = remainingTimeoutMs()
          if (remainingMs === 0) finishFailure(createCodeModeTimeoutFailure(timeoutMs))
          else {
            timeoutId = setTimeout(() => finishFailure(createCodeModeTimeoutFailure(timeoutMs)), remainingMs)
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
                },
                [workerSyncPort],
              )
          }
        } catch (cause) {
          finishFailure(
            createCodeModeFailure({
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
        catch: (cause) =>
          createCodeModeFailure({
            _tag: 'worker',
            operation: 'terminate',
            message: 'The code mode worker could not terminate.',
            cause,
          }),
      }).pipe(Effect.ignoreCause),
  )
})

type CodeModeFailureLike = ReturnType<typeof createCodeModeFailure>

function createCodeModeCancellationFailure(): CodeModeFailureLike {
  return createCodeModeFailure({
    _tag: 'cancellation',
    operation: 'worker',
    message: 'The code mode evaluation was cancelled.',
  })
}

function createCodeModeTimeoutFailure(timeoutMs: number): CodeModeFailureLike {
  return createCodeModeFailure({
    _tag: 'timeout',
    operation: 'worker',
    message: `The code mode evaluation timed out after ${timeoutMs}ms.`,
  })
}

function createCodeModeWorkerOptions(): { readonly execArgv?: string[] } | undefined {
  const execArgv = process.execArgv.filter((argument) => !argument.startsWith('--input-type'))
  return execArgv.length === process.execArgv.length ? undefined : { execArgv }
}

export { runCodeModeWorkerEvaluation }
