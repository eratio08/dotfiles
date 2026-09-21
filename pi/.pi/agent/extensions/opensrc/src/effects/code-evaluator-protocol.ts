import type { MessagePort } from 'node:worker_threads'
import { createOpensrcFailure, type OpensrcFailure } from '../core/model.ts'
import { decodeOpensrcFailure } from './failure.ts'

type SyncApiMethod = 'list' | 'has' | 'get' | 'resolve'
type AsyncApiMethod = 'files' | 'tree' | 'grep' | 'astGrep' | 'read' | 'readMany' | 'fetch' | 'remove' | 'clean'

interface CodeEvaluatorWorkerStart {
  readonly type: 'start'
  readonly code: string
  readonly filename: string
  readonly timeoutMs: number
  readonly syncState: SharedArrayBuffer
  readonly syncPort: MessagePort
}

interface CodeEvaluatorSyncRequest {
  readonly type: 'sync-call'
  readonly id: number
  readonly method: SyncApiMethod
  readonly args: readonly unknown[]
}

interface CodeEvaluatorAsyncRequest {
  readonly type: 'async-call'
  readonly id: number
  readonly method: AsyncApiMethod
  readonly args: readonly unknown[]
}

interface CodeEvaluatorSyncResponse {
  readonly type: 'sync-result'
  readonly id: number
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: CodeEvaluatorWorkerError
}

interface CodeEvaluatorAsyncResponse {
  readonly type: 'async-result'
  readonly id: number
  readonly ok: boolean
  readonly value?: unknown
  readonly error?: CodeEvaluatorWorkerError
}

interface CodeEvaluatorWorkerResult {
  readonly type: 'result'
  readonly value: unknown
}

interface CodeEvaluatorWorkerFailure {
  readonly type: 'error'
  readonly error: CodeEvaluatorWorkerError
}

interface CodeEvaluatorFailureValue {
  readonly kind: 'failure'
  readonly failure: {
    readonly _tag: string
    readonly operation: string
    readonly message: string
    readonly cause?: unknown
  }
}

interface CodeEvaluatorExceptionValue {
  readonly kind: 'exception'
  readonly name: string
  readonly message: string
  readonly stack?: string
}

type CodeEvaluatorWorkerError = CodeEvaluatorFailureValue | CodeEvaluatorExceptionValue

type CodeEvaluatorWorkerMessage =
  | CodeEvaluatorSyncRequest
  | CodeEvaluatorAsyncRequest
  | CodeEvaluatorWorkerResult
  | CodeEvaluatorWorkerFailure

type CodeEvaluatorParentMessage = CodeEvaluatorWorkerStart | CodeEvaluatorSyncResponse | CodeEvaluatorAsyncResponse

function serializeCodeEvaluatorError(cause: unknown): CodeEvaluatorWorkerError {
  const failure = decodeOpensrcFailure(cause)
  if (failure !== undefined) {
    return {
      kind: 'failure',
      failure: {
        _tag: failure._tag,
        operation: failure.operation,
        message: failure.message,
        cause: failure.cause,
      },
    }
  }
  if (cause instanceof Error) {
    return { kind: 'exception', name: cause.name, message: cause.message, stack: cause.stack }
  }
  return { kind: 'exception', name: 'Error', message: String(cause) }
}

function deserializeCodeEvaluatorError(error: CodeEvaluatorWorkerError | undefined): OpensrcFailure {
  if (error === undefined) {
    return createOpensrcFailure({
      _tag: 'code-evaluation',
      operation: 'deserialize',
      message: 'The opensrc API returned an unknown error.',
    })
  }
  if (error.kind === 'failure') {
    return (
      decodeOpensrcFailure(error.failure) ??
      createOpensrcFailure({
        _tag: 'code-evaluation',
        operation: 'deserialize',
        message: 'The opensrc API returned an invalid failure.',
        cause: error.failure,
      })
    )
  }
  return createOpensrcFailure({
    _tag: 'code-evaluation',
    operation: 'worker',
    message: error.message,
    cause: { name: error.name, stack: error.stack },
  })
}

export {
  type AsyncApiMethod,
  type CodeEvaluatorAsyncRequest,
  type CodeEvaluatorAsyncResponse,
  type CodeEvaluatorExceptionValue,
  type CodeEvaluatorFailureValue,
  type CodeEvaluatorParentMessage,
  type CodeEvaluatorSyncRequest,
  type CodeEvaluatorSyncResponse,
  type CodeEvaluatorWorkerError,
  type CodeEvaluatorWorkerFailure,
  type CodeEvaluatorWorkerMessage,
  type CodeEvaluatorWorkerResult,
  type CodeEvaluatorWorkerStart,
  deserializeCodeEvaluatorError,
  type SyncApiMethod,
  serializeCodeEvaluatorError,
}
