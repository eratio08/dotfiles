import { isMainThread, MessagePort, parentPort, receiveMessageOnPort } from 'node:worker_threads'
import { Schema } from 'effect'
import { createProgramFailure, deserializeCodeModeWorkerError, serializeProgramError } from './failure.ts'
import type {
  CodeModeAsyncResponse,
  CodeModeSyncRequest,
  CodeModeSyncResponse,
  CodeModeWorkerMessage,
  CodeModeWorkerStart,
} from './protocol.ts'
import { CodeModeAsyncResponseSchema, CodeModeSyncResponseSchema, CodeModeWorkerStartSchema } from './schema.ts'
import { createCodeModeApi, runCodeModeVm } from './vm.ts'

type CodeModePendingCall = {
  readonly resolve: (value: unknown) => void
  readonly reject: (cause: unknown) => void
}

/**
 * Registers the worker message handler that evaluates one program and posts its result or failure.
 */
function runCodeModeWorker(): void {
  if (parentPort === null) return
  parentPort.once('message', (message: unknown) => {
    const start = decodeCodeModeWorkerStart(message)
    if (start === undefined) {
      postCodeModeWorkerError(
        createProgramFailure({
          _tag: 'transport',
          operation: 'start',
          message: 'The code mode worker received an invalid start message.',
        }),
      )
      return
    }
    const api = createCodeModeWorkerApi(start)
    const startedAt = performance.now() - Math.max(0, start.timeoutMs - start.remainingTimeoutMs)
    void runCodeModeVm(start.code, api, start.filename, start.timeoutMs, startedAt).then(
      (value) => postCodeModeWorkerResult(value),
      (cause) => postCodeModeWorkerError(cause),
    )
  })
}

function createCodeModeWorkerApi(
  start: CodeModeWorkerStart,
): Readonly<Record<string, (...args: readonly unknown[]) => unknown>> {
  const pending = new Map<number, CodeModePendingCall>()
  let nextCallId = 1
  parentPort?.on('message', (message: unknown) => {
    let response: CodeModeAsyncResponse
    try {
      response = Schema.decodeUnknownSync(CodeModeAsyncResponseSchema)(message)
    } catch {
      for (const call of pending.values())
        call.reject(
          createProgramFailure({
            _tag: 'transport',
            operation: 'async-response',
            message: 'The code mode worker received an invalid response type.',
          }),
        )
      pending.clear()
      return
    }
    const call = pending.get(response.id)
    if (call === undefined) {
      for (const pendingCall of pending.values())
        pendingCall.reject(
          createProgramFailure({
            _tag: 'transport',
            operation: 'async-response',
            message: 'The code mode worker received an unknown response id.',
          }),
        )
      pending.clear()
      return
    }
    pending.delete(response.id)
    if (response.ok) call.resolve(response.value)
    else call.reject(deserializeCodeModeWorkerError(response.error))
  })

  const invokeSync = (method: string, args: readonly unknown[]): unknown => {
    const id = nextCallId++
    const state = new Int32Array(start.syncState)
    Atomics.store(state, 0, 0)
    try {
      start.syncPort.postMessage({ type: 'sync-call', id, method, args } satisfies CodeModeSyncRequest)
    } catch (cause) {
      throw createProgramFailure({
        _tag: 'serialize',
        operation: 'sync-call',
        message: 'The code mode worker could not send a synchronous call.',
        cause,
      })
    }
    while (true) {
      const response = receiveMessageOnPort(start.syncPort)
      if (response !== undefined) {
        let message: CodeModeSyncResponse
        try {
          message = Schema.decodeUnknownSync(CodeModeSyncResponseSchema)(response.message)
        } catch {
          throw createProgramFailure({
            _tag: 'transport',
            operation: 'sync-response',
            message: 'The code mode worker received an invalid synchronous response.',
          })
        }
        if (message.id !== id)
          throw createProgramFailure({
            _tag: 'transport',
            operation: 'sync-response',
            message: 'The code mode worker received an invalid synchronous response.',
          })
        Atomics.store(state, 0, 0)
        if (message.ok) return message.value
        throw deserializeCodeModeWorkerError(message.error)
      }
      Atomics.wait(state, 0, Atomics.load(state, 0), 10)
    }
  }

  const invokeAsync = (method: string, args: readonly unknown[]): Promise<unknown> => {
    const id = nextCallId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      try {
        parentPort?.postMessage({ type: 'async-call', id, method, args } satisfies CodeModeWorkerMessage)
      } catch (cause) {
        pending.delete(id)
        reject(
          createProgramFailure({
            _tag: 'serialize',
            operation: 'async-call',
            message: 'The code mode worker could not send an asynchronous call.',
            cause,
          }),
        )
      }
    })
  }

  return createCodeModeApi(start.methods, invokeSync, invokeAsync)
}

function postCodeModeWorkerResult(value: unknown): void {
  try {
    parentPort?.postMessage({ type: 'result', value } satisfies CodeModeWorkerMessage)
  } catch (cause) {
    postCodeModeWorkerError(
      createProgramFailure({
        _tag: 'serialize',
        operation: 'result',
        message: 'The code mode worker could not serialize its result.',
        cause,
      }),
    )
  }
}

function postCodeModeWorkerError(cause: unknown): void {
  try {
    parentPort?.postMessage({ type: 'error', error: serializeProgramError(cause) } satisfies CodeModeWorkerMessage)
  } catch (postCause) {
    try {
      parentPort?.postMessage({
        type: 'error',
        error: {
          kind: 'exception',
          name: 'Error',
          message: String(postCause),
        },
      } satisfies CodeModeWorkerMessage)
    } catch {
      process.exitCode = 1
    }
  }
}

function decodeCodeModeWorkerStart(value: unknown): CodeModeWorkerStart | undefined {
  try {
    const decoded = Schema.decodeUnknownSync(CodeModeWorkerStartSchema)(value)
    const syncState = decoded.syncState
    const syncPort = decoded.syncPort
    if (!(syncState instanceof SharedArrayBuffer)) return undefined
    if (!(syncPort instanceof MessagePort)) return undefined
    return { ...decoded, syncState, syncPort }
  } catch {
    return undefined
  }
}

export { runCodeModeWorker }

if (!isMainThread) runCodeModeWorker()
