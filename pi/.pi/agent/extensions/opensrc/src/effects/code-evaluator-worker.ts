import { createContext, Script } from 'node:vm'
import { isMainThread, type MessagePort, parentPort, receiveMessageOnPort } from 'node:worker_threads'
import { isOpensrcProgram } from '../core/code-mode.ts'
import {
  type AstGrepMatch,
  createOpensrcFailure,
  type FetchedSource,
  type FileEntry,
  type GrepResult,
  type OpensrcApi,
  type OpensrcFailure,
  type ParsedSpec,
  type RemoveResult,
  type Source,
  type TreeNode,
} from '../core/model.ts'
import type {
  AsyncApiMethod,
  CodeEvaluatorAsyncRequest,
  CodeEvaluatorParentMessage,
  CodeEvaluatorSyncRequest,
  CodeEvaluatorSyncResponse,
  CodeEvaluatorWorkerMessage,
  CodeEvaluatorWorkerStart,
  SyncApiMethod,
} from './code-evaluator-protocol.ts'
import { deserializeCodeEvaluatorError, serializeCodeEvaluatorError } from './code-evaluator-protocol.ts'

interface EvaluatedModule {
  readonly exports: { default?: unknown }
}

interface PendingAsyncCall {
  readonly resolve: (value: unknown) => void
  readonly reject: (error: OpensrcFailure) => void
}

function runCodeEvaluatorWorker(): void {
  if (parentPort === null) return
  const workerPort = parentPort
  workerPort.once('message', (message: CodeEvaluatorWorkerStart) => {
    if (message.type !== 'start') return
    const api = createWorkerApi(workerPort, message.syncPort, message.syncState)
    Promise.resolve()
      .then(() => evaluateWorkerCode(message.code, api, message.filename, message.timeoutMs))
      .then(
        (value) => workerPort.postMessage({ type: 'result', value } satisfies CodeEvaluatorWorkerMessage),
        (cause) =>
          workerPort.postMessage({
            type: 'error',
            error: serializeCodeEvaluatorError(cause),
          } satisfies CodeEvaluatorWorkerMessage),
      )
  })
}

function createWorkerApi(workerPort: MessagePort, syncPort: MessagePort, syncState: SharedArrayBuffer): OpensrcApi {
  const pending = new Map<number, PendingAsyncCall>()
  let nextCallId = 1
  workerPort.on('message', (message: CodeEvaluatorParentMessage) => {
    if (message.type !== 'async-result') return
    const call = pending.get(message.id)
    if (call === undefined) return
    pending.delete(message.id)
    if (message.ok) call.resolve(message.value)
    else call.reject(deserializeCodeEvaluatorError(message.error))
  })

  const callSync = (method: SyncApiMethod, args: readonly unknown[]): unknown => {
    const id = nextCallId++
    const state = new Int32Array(syncState)
    Atomics.store(state, 0, 0)
    syncPort.postMessage({ type: 'sync-call', id, method, args } satisfies CodeEvaluatorSyncRequest)
    while (true) {
      const response = receiveMessageOnPort(syncPort)
      if (response !== undefined) {
        const message = response.message as CodeEvaluatorSyncResponse
        if (message.type !== 'sync-result' || message.id !== id) {
          throw createOpensrcFailure({
            _tag: 'code-evaluation',
            operation: 'sync-response',
            message: 'The opensrc API returned an invalid synchronous response.',
          })
        }
        Atomics.store(state, 0, 0)
        if (message.ok) return message.value
        throw deserializeCodeEvaluatorError(message.error)
      }
      Atomics.wait(state, 0, Atomics.load(state, 0), 10)
    }
  }

  const callAsync = (method: AsyncApiMethod, args: readonly unknown[]): Promise<unknown> => {
    const id = nextCallId++
    const result = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      workerPort.postMessage({ type: 'async-call', id, method, args } satisfies CodeEvaluatorAsyncRequest)
    })
    return result.catch((error) => {
      pending.delete(id)
      return Promise.reject(error)
    })
  }

  return {
    list: () => callSync('list', []) as readonly Source[],
    has: (name, version) => callSync('has', [name, version]) as boolean,
    get: (name) => callSync('get', [name]) as Source | undefined,
    files: (sourceName, glob) => callAsync('files', [sourceName, glob]) as Promise<readonly FileEntry[]>,
    tree: (sourceName, options) => callAsync('tree', [sourceName, options]) as Promise<TreeNode>,
    grep: (pattern, options) => callAsync('grep', [pattern, options]) as Promise<readonly GrepResult[]>,
    astGrep: (sourceName, pattern, options) =>
      callAsync('astGrep', [sourceName, pattern, options]) as Promise<readonly AstGrepMatch[]>,
    read: (sourceName, filePath) => callAsync('read', [sourceName, filePath]) as Promise<string>,
    readMany: (sourceName, paths) =>
      callAsync('readMany', [sourceName, paths]) as Promise<Readonly<Record<string, string>>>,
    resolve: (spec) => callSync('resolve', [spec]) as ParsedSpec,
    fetch: (specs) => callAsync('fetch', [specs]) as Promise<readonly FetchedSource[]>,
    remove: (names) => callAsync('remove', [names]) as Promise<RemoveResult>,
    clean: (options) => callAsync('clean', [options]) as Promise<RemoveResult>,
  }
}

function evaluateWorkerCode(code: string, api: OpensrcApi, filename: string, timeoutMs: number): unknown {
  const module: EvaluatedModule = { exports: {} }
  const context = createWorkerContext(api, module)
  new Script(code, { filename }).runInContext(context, { timeout: timeoutMs })
  if (!isOpensrcProgram(module.exports.default)) {
    throw createOpensrcFailure({
      _tag: 'code-evaluation',
      operation: 'evaluate',
      message: 'code must export a default function',
    })
  }
  return new Script('module.exports.default(api)', { filename: `${filename}:invoke` }).runInContext(context, {
    timeout: timeoutMs,
  })
}

function createWorkerContext(api: OpensrcApi, module: EvaluatedModule): object {
  return createContext(
    {
      api: Object.freeze(api),
      console: Object.freeze({ log: () => undefined, warn: () => undefined, error: () => undefined }),
      exports: module.exports,
      fetch: undefined,
      global: undefined,
      globalThis: undefined,
      module,
      process: undefined,
      require: undefined,
      setImmediate: undefined,
      setInterval: undefined,
      setTimeout: undefined,
    },
    { codeGeneration: { strings: false, wasm: false } },
  )
}

export { runCodeEvaluatorWorker }

if (!isMainThread) runCodeEvaluatorWorker()
