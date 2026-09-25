import type { MessagePort } from 'node:worker_threads'
import type { ProgramMethod, ProgramWireValue } from './contract.ts'
import type { ProgramFailureWireValue } from './schema.ts'

type WorkerError = WorkerFailureValue | WorkerExceptionValue | WorkerHostErrorValue

interface WorkerFailureValue {
  readonly kind: 'failure'
  readonly failure: ProgramFailureWireValue
}

interface WorkerExceptionValue {
  readonly kind: 'exception'
  readonly name: string
  readonly message: string
  readonly stack?: string
}

interface WorkerHostErrorValue {
  readonly kind: 'host'
  readonly value: ProgramWireValue
}

interface CodeModeWorkerStart {
  readonly type: 'start'
  readonly code: string
  readonly filename: string
  readonly timeoutMs: number
  readonly remainingTimeoutMs: number
  readonly methods: readonly ProgramMethod[]
  readonly syncState: SharedArrayBuffer
  readonly syncPort: MessagePort
}

interface CodeModeSyncRequest {
  readonly type: 'sync-call'
  readonly id: number
  readonly method: string
  readonly args: readonly unknown[]
}

interface CodeModeAsyncRequest {
  readonly type: 'async-call'
  readonly id: number
  readonly method: string
  readonly args: readonly unknown[]
}

interface CodeModeSyncSuccessResponse {
  readonly type: 'sync-result'
  readonly id: number
  readonly ok: true
  readonly value: unknown
}

interface CodeModeSyncFailureResponse {
  readonly type: 'sync-result'
  readonly id: number
  readonly ok: false
  readonly error: WorkerError
}

type CodeModeSyncResponse = CodeModeSyncSuccessResponse | CodeModeSyncFailureResponse

interface CodeModeAsyncSuccessResponse {
  readonly type: 'async-result'
  readonly id: number
  readonly ok: true
  readonly value: unknown
}

interface CodeModeAsyncFailureResponse {
  readonly type: 'async-result'
  readonly id: number
  readonly ok: false
  readonly error: WorkerError
}

type CodeModeAsyncResponse = CodeModeAsyncSuccessResponse | CodeModeAsyncFailureResponse

interface CodeModeWorkerResult {
  readonly type: 'result'
  readonly value: unknown
}

interface CodeModeWorkerFailure {
  readonly type: 'error'
  readonly error: WorkerError
}

type CodeModeWorkerMessage = CodeModeSyncRequest | CodeModeAsyncRequest | CodeModeWorkerResult | CodeModeWorkerFailure

type CodeModeParentMessage = CodeModeWorkerStart | CodeModeSyncResponse | CodeModeAsyncResponse

export type {
  CodeModeAsyncRequest,
  CodeModeAsyncResponse,
  CodeModeParentMessage,
  CodeModeSyncRequest,
  CodeModeSyncResponse,
  CodeModeWorkerFailure,
  CodeModeWorkerMessage,
  CodeModeWorkerResult,
  CodeModeWorkerStart,
  WorkerError,
  WorkerExceptionValue,
  WorkerFailureValue,
  WorkerHostErrorValue,
}
