import type { MessagePort } from 'node:worker_threads'
import type { ProgramMethod, ProgramWireValue } from './contract.ts'
import type { ProgramFailureWireValue } from './schema.ts'

type WorkerError = WorkerFailureValue | WorkerExceptionValue | WorkerHostErrorValue

type WorkerFailureValue = {
  readonly kind: 'failure'
  readonly failure: ProgramFailureWireValue
}

type WorkerExceptionValue = {
  readonly kind: 'exception'
  readonly name: string
  readonly message: string
  readonly stack?: string
}

type WorkerHostErrorValue = {
  readonly kind: 'host'
  readonly value: ProgramWireValue
}

type CodeModeWorkerStart = {
  readonly type: 'start'
  readonly code: string
  readonly filename: string
  readonly timeoutMs: number
  readonly remainingTimeoutMs: number
  readonly methods: readonly ProgramMethod[]
  readonly syncState: SharedArrayBuffer
  readonly syncPort: MessagePort
}

type CodeModeSyncRequest = {
  readonly type: 'sync-call'
  readonly id: number
  readonly method: string
  readonly args: readonly unknown[]
}

type CodeModeAsyncRequest = {
  readonly type: 'async-call'
  readonly id: number
  readonly method: string
  readonly args: readonly unknown[]
}

type CodeModeSyncSuccessResponse = {
  readonly type: 'sync-result'
  readonly id: number
  readonly ok: true
  readonly value: unknown
}

type CodeModeSyncFailureResponse = {
  readonly type: 'sync-result'
  readonly id: number
  readonly ok: false
  readonly error: WorkerError
}

type CodeModeSyncResponse = CodeModeSyncSuccessResponse | CodeModeSyncFailureResponse

type CodeModeAsyncSuccessResponse = {
  readonly type: 'async-result'
  readonly id: number
  readonly ok: true
  readonly value: unknown
}

type CodeModeAsyncFailureResponse = {
  readonly type: 'async-result'
  readonly id: number
  readonly ok: false
  readonly error: WorkerError
}

type CodeModeAsyncResponse = CodeModeAsyncSuccessResponse | CodeModeAsyncFailureResponse

type CodeModeWorkerResult = {
  readonly type: 'result'
  readonly value: unknown
}

type CodeModeWorkerFailure = {
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
