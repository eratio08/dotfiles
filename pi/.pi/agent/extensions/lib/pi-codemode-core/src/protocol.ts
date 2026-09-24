import type { MessagePort } from 'node:worker_threads'
import type { CodeModeMethod, CodeModeWireValue } from './contract.ts'
import type { CodeModeFailureWireValue } from './schema.ts'

type CodeModeWorkerError = CodeModeWorkerFailureValue | CodeModeWorkerExceptionValue | CodeModeWorkerHostErrorValue

interface CodeModeWorkerFailureValue {
  readonly kind: 'failure'
  readonly failure: CodeModeFailureWireValue
}

interface CodeModeWorkerExceptionValue {
  readonly kind: 'exception'
  readonly name: string
  readonly message: string
  readonly stack?: string
}

interface CodeModeWorkerHostErrorValue {
  readonly kind: 'host'
  readonly value: CodeModeWireValue
}

interface CodeModeWorkerStart {
  readonly type: 'start'
  readonly code: string
  readonly filename: string
  readonly timeoutMs: number
  readonly remainingTimeoutMs: number
  readonly methods: readonly CodeModeMethod[]
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
  readonly error: CodeModeWorkerError
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
  readonly error: CodeModeWorkerError
}

type CodeModeAsyncResponse = CodeModeAsyncSuccessResponse | CodeModeAsyncFailureResponse

interface CodeModeWorkerResult {
  readonly type: 'result'
  readonly value: unknown
}

interface CodeModeWorkerFailure {
  readonly type: 'error'
  readonly error: CodeModeWorkerError
}

type CodeModeWorkerMessage = CodeModeSyncRequest | CodeModeAsyncRequest | CodeModeWorkerResult | CodeModeWorkerFailure

type CodeModeParentMessage = CodeModeWorkerStart | CodeModeSyncResponse | CodeModeAsyncResponse

export type {
  CodeModeAsyncRequest,
  CodeModeAsyncResponse,
  CodeModeParentMessage,
  CodeModeSyncRequest,
  CodeModeSyncResponse,
  CodeModeWorkerError,
  CodeModeWorkerExceptionValue,
  CodeModeWorkerFailure,
  CodeModeWorkerFailureValue,
  CodeModeWorkerHostErrorValue,
  CodeModeWorkerMessage,
  CodeModeWorkerResult,
  CodeModeWorkerStart,
}
