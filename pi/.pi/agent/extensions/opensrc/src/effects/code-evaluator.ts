import { resolve } from 'node:path'
import { MessageChannel, Worker } from 'node:worker_threads'
import { Context, Effect, Layer } from 'effect'
import { createJiti } from 'jiti'
import { OPENSRC_CODE_TYPES } from '../core/code-mode.ts'
import type { OpensrcApi, OpensrcFailure } from '../core/model.ts'
import { createOpensrcFailure } from '../core/model.ts'
import type {
  AsyncApiMethod,
  CodeEvaluatorAsyncRequest,
  CodeEvaluatorSyncRequest,
  CodeEvaluatorSyncResponse,
  CodeEvaluatorWorkerMessage,
  SyncApiMethod,
} from './code-evaluator-protocol.ts'
import { deserializeCodeEvaluatorError, serializeCodeEvaluatorError } from './code-evaluator-protocol.ts'
import { decodeOpensrcFailure, failureFromUnknown } from './failure.ts'

interface CodeEvaluatorService {
  readonly evaluate: (
    code: string,
    api: OpensrcApi,
    cwd?: string,
    signal?: AbortSignal,
  ) => Effect.Effect<unknown, OpensrcFailure>
}

class CodeEvaluator extends Context.Service<CodeEvaluator, CodeEvaluatorService>()('opensrc/CodeEvaluator') {}

const OPENSRC_CODE_TIMEOUT_MS = 30_000

type Jiti = ReturnType<typeof createJiti>

function createJitiEffect(): Effect.Effect<Jiti, OpensrcFailure> {
  return Effect.try({
    try: () => createJiti(import.meta.url, { moduleCache: false }),
    catch: (cause) =>
      failureFromUnknown(cause, 'code-evaluation', 'initialize', 'The code evaluator could not initialize.'),
  })
}

function createCodeEvaluator(
  timeoutMs: number = OPENSRC_CODE_TIMEOUT_MS,
  jitiEffect: Effect.Effect<Jiti, OpensrcFailure> = createJitiEffect(),
): CodeEvaluatorService {
  let evaluationNumber = 0
  return {
    evaluate: (code, api, cwd, signal) =>
      Effect.gen(function* () {
        const jiti = yield* jitiEffect
        return yield* evaluateOpensrcCode(code, api, signal, cwd, timeoutMs, jiti, () => (evaluationNumber += 1))
      }),
  }
}

function CodeEvaluatorLive(timeoutMs: number = OPENSRC_CODE_TIMEOUT_MS): Layer.Layer<CodeEvaluator, never, never> {
  return Layer.effect(
    CodeEvaluator,
    Effect.gen(function* () {
      const jiti = yield* Effect.cached(createJitiEffect())
      return CodeEvaluator.of(createCodeEvaluator(timeoutMs, jiti))
    }),
  )
}

function evaluateOpensrcCode(
  code: string,
  api: OpensrcApi,
  signal: AbortSignal | undefined,
  cwd: string | undefined,
  timeoutMs: number,
  jiti: ReturnType<typeof createJiti>,
  nextEvaluationNumber: () => number,
): Effect.Effect<unknown, OpensrcFailure> {
  return Effect.gen(function* () {
    if (signal?.aborted) return yield* Effect.fail(cancellationError())
    if (code.trim().length === 0)
      return yield* Effect.fail(
        createOpensrcFailure({
          _tag: 'code-evaluation',
          operation: 'evaluate',
          message: 'code cannot be empty',
        }),
      )
    const filename = resolve(cwd ?? '.', '.pi', `opensrc-${nextEvaluationNumber()}.ts`)
    const transformedCode = yield* Effect.try({
      try: () =>
        jiti.transform({
          source: createOpensrcCodeSource(code),
          filename,
          ts: true,
          async: true,
        }),
      catch: (cause) =>
        createOpensrcFailure({
          _tag: 'code-evaluation',
          operation: 'transform',
          message: 'The TypeScript program could not be transformed.',
          cause,
        }),
    })
    if (signal?.aborted) return yield* Effect.fail(cancellationError())
    return yield* Effect.tryPromise({
      try: (effectSignal) => evaluateInWorker(transformedCode, api, signal ?? effectSignal, filename, timeoutMs),
      catch: (cause) => {
        if (signal?.aborted) return cancellationError()
        if (isTimeoutFailure(cause)) return timeoutError(timeoutMs)
        return failureFromUnknown(cause, 'code-evaluation', 'evaluate', 'The TypeScript program failed.')
      },
    })
  })
}

function evaluateInWorker(
  code: string,
  api: OpensrcApi,
  signal: AbortSignal | undefined,
  filename: string,
  timeoutMs: number,
): Promise<unknown> {
  const worker = new Worker(new URL('./code-evaluator-worker.ts', import.meta.url))
  const channel = new MessageChannel()
  const syncState = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)

  return new Promise((resolve, reject) => {
    let settled = false
    const timeoutId = setTimeout(() => finishFailure(timeoutError(timeoutMs)), timeoutMs)
    const abortHandler = (): void => finishFailure(cancellationError())

    const cleanup = (): void => {
      clearTimeout(timeoutId)
      signal?.removeEventListener('abort', abortHandler)
      channel.port1.close()
    }

    const finish = (outcome: EvaluationOutcome): void => {
      if (settled) return
      settled = true
      cleanup()
      void worker.terminate().then(
        () => completeOutcome(outcome),
        () => completeOutcome(outcome),
      )
    }

    const finishSuccess = (value: unknown): void => finish({ ok: true, value })
    const finishFailure = (error: OpensrcFailure): void => finish({ ok: false, error })

    const completeOutcome = (outcome: EvaluationOutcome): void => {
      if (outcome.ok) resolve(outcome.value)
      else reject(outcome.error)
    }

    const postPortMessage = (message: CodeEvaluatorSyncResponse): Promise<void> =>
      Promise.resolve().then(() => channel.port1.postMessage(message))

    const postWorkerMessage = (message: unknown): Promise<void> =>
      Promise.resolve().then(() => worker.postMessage(message))

    const notifySyncWaiter = (): void => {
      const state = new Int32Array(syncState)
      Atomics.store(state, 0, 1)
      Atomics.notify(state, 0)
    }

    const sendSyncResponse = (response: CodeEvaluatorSyncResponse): void => {
      postPortMessage(response)
        .catch((cause) =>
          postPortMessage({
            type: 'sync-result',
            id: response.id,
            ok: false,
            error: serializeCodeEvaluatorError(codeEvaluationFailure('postMessage', cause)),
          }),
        )
        .catch(() => undefined)
        .finally(notifySyncWaiter)
    }

    const handleSyncRequest = (request: CodeEvaluatorSyncRequest): void => {
      const response: Promise<CodeEvaluatorSyncResponse> = Promise.resolve()
        .then(
          (): CodeEvaluatorSyncResponse => ({
            type: 'sync-result',
            id: request.id,
            ok: true,
            value: invokeSyncApi(api, request),
          }),
        )
        .catch(
          (cause): CodeEvaluatorSyncResponse => ({
            type: 'sync-result',
            id: request.id,
            ok: false,
            error: serializeCodeEvaluatorError(
              failureFromUnknown(cause, 'code-evaluation', 'invokeSyncApi', 'The opensrc API failed.'),
            ),
          }),
        )
      response.then(sendSyncResponse)
    }

    const sendAsyncResponse = (request: CodeEvaluatorAsyncRequest, value: unknown, error?: OpensrcFailure): void => {
      if (settled) return
      Promise.resolve()
        .then(() =>
          error === undefined
            ? { type: 'async-result', id: request.id, ok: true, value }
            : { type: 'async-result', id: request.id, ok: false, error: serializeCodeEvaluatorError(error) },
        )
        .then(postWorkerMessage)
        .catch((cause) =>
          postWorkerMessage({
            type: 'async-result',
            id: request.id,
            ok: false,
            error: serializeCodeEvaluatorError(codeEvaluationFailure('postMessage', cause)),
          }),
        )
        .catch(() => undefined)
    }

    const handleAsyncRequest = (request: CodeEvaluatorAsyncRequest): void => {
      Promise.resolve()
        .then(() => invokeAsyncApi(api, request))
        .then(
          (value) => sendAsyncResponse(request, value),
          (cause) =>
            sendAsyncResponse(
              request,
              undefined,
              failureFromUnknown(cause, 'code-evaluation', 'invokeAsyncApi', 'The opensrc API failed.'),
            ),
        )
    }

    channel.port1.on('message', handleSyncRequest)
    worker.on('message', (message: CodeEvaluatorWorkerMessage) => {
      if (message.type === 'async-call') {
        handleAsyncRequest(message)
      } else if (message.type === 'result') {
        finishSuccess(message.value)
      } else if (message.type === 'error') {
        finishFailure(deserializeCodeEvaluatorError(message.error))
      }
    })
    worker.on('error', (cause) => finishFailure(codeEvaluationFailure('worker', cause)))
    worker.on('exit', (code) => {
      if (!settled)
        finishFailure(
          createOpensrcFailure({
            _tag: 'code-evaluation',
            operation: 'worker',
            message: `The code evaluator worker exited with code ${code}.`,
          }),
        )
    })
    signal?.addEventListener('abort', abortHandler, { once: true })

    Promise.resolve()
      .then(() =>
        worker.postMessage(
          {
            type: 'start',
            code,
            filename,
            timeoutMs,
            syncState,
            syncPort: channel.port2,
          },
          [channel.port2],
        ),
      )
      .catch((cause) =>
        finishFailure(failureFromUnknown(cause, 'code-evaluation', 'startWorker', 'The worker failed.')),
      )
  })
}

type EvaluationOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: OpensrcFailure }

function invokeSyncApi(api: OpensrcApi, request: CodeEvaluatorSyncRequest): unknown {
  switch (request.method as SyncApiMethod) {
    case 'list':
      return api.list()
    case 'has':
      return api.has(request.args[0] as string, request.args[1] as string | undefined)
    case 'get':
      return api.get(request.args[0] as string)
    case 'resolve':
      return api.resolve(request.args[0] as string)
  }
}

function invokeAsyncApi(api: OpensrcApi, request: CodeEvaluatorAsyncRequest): Promise<unknown> {
  switch (request.method as AsyncApiMethod) {
    case 'files':
      return api.files(request.args[0] as string, request.args[1] as string | undefined)
    case 'tree':
      return api.tree(request.args[0] as string, request.args[1] as Parameters<OpensrcApi['tree']>[1])
    case 'grep':
      return api.grep(request.args[0] as string, request.args[1] as Parameters<OpensrcApi['grep']>[1])
    case 'astGrep':
      return api.astGrep(
        request.args[0] as string,
        request.args[1] as string,
        request.args[2] as Parameters<OpensrcApi['astGrep']>[2],
      )
    case 'read':
      return api.read(request.args[0] as string, request.args[1] as string)
    case 'readMany':
      return api.readMany(request.args[0] as string, request.args[1] as readonly string[])
    case 'fetch':
      return api.fetch(request.args[0] as string | readonly string[])
    case 'remove':
      return api.remove(request.args[0] as readonly string[])
    case 'clean':
      return api.clean(request.args[0] as Parameters<OpensrcApi['clean']>[0])
  }
}

function createOpensrcCodeSource(code: string): string {
  return `${OPENSRC_CODE_TYPES}\n${code}`
}

function isTimeoutFailure(value: unknown): boolean {
  return decodeOpensrcFailure(value)?._tag === 'timeout'
}

function cancellationError(): OpensrcFailure {
  return createOpensrcFailure({
    _tag: 'cancellation',
    operation: 'evaluate',
    message: 'The opensrc operation was cancelled.',
  })
}

function codeEvaluationFailure(operation: string, cause: unknown): OpensrcFailure {
  return failureFromUnknown(cause, 'code-evaluation', operation, 'The code evaluator failed.')
}

function timeoutError(timeoutMs: number): OpensrcFailure {
  return createOpensrcFailure({
    _tag: 'timeout',
    operation: 'evaluate',
    message: `The opensrc program timed out after ${timeoutMs}ms.`,
  })
}

export {
  CodeEvaluator,
  CodeEvaluatorLive,
  type CodeEvaluatorService,
  createCodeEvaluator,
  evaluateOpensrcCode,
  OPENSRC_CODE_TIMEOUT_MS,
}
