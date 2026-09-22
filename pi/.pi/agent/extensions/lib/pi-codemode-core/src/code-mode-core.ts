import { Cause, Effect, Schema } from 'effect'
import type { Scope } from 'effect/Scope'
import type { CodeModeCore, CodeModeDefinition, CodeModeEffectHost, CodeModeRunOptions } from './code-mode-contract.ts'
import { findCodeModeMethod, validateCodeModeDefinition, validateCodeModeRunOptions } from './code-mode-contract.ts'
import {
  type CodeModeFailure,
  createCodeModeFailure,
  isCodeModeFailure,
  isCodeModeHostError,
} from './code-mode-failure.ts'
import { createCodeModeRequestQueue } from './code-mode-request-queue.ts'
import { CodeModeSourceSchema, getCodeModeSchemaFailureMessage } from './code-mode-schema.ts'
import {
  createCodeModeApi,
  createCodeModeFilename,
  createCodeModeJiti,
  runCodeModeVm,
  transformCodeModeProgram,
  validateCodeModeImports,
} from './code-mode-vm.ts'
import { runCodeModeWorkerEvaluation } from './code-mode-worker-runner.ts'

interface CodeModeDeadline {
  readonly startedAt: number
  readonly signal: AbortSignal
  readonly isTimedOut: () => boolean
  readonly dispose: () => void
}

function createCodeModeCore<R, E>(): CodeModeCore<R, E> {
  const jiti = createCodeModeJiti()
  let evaluationNumber = 0

  const evaluate = Effect.fnUntraced(
    function* (
      definition: CodeModeDefinition,
      host: CodeModeEffectHost<R, E>,
      code: string,
      options: CodeModeRunOptions,
    ): Effect.fn.Return<unknown, CodeModeFailure | E, R | Scope> {
      const definitionError = validateCodeModeDefinition(definition)
      if (definitionError !== undefined) return yield* Effect.fail(definitionError)
      const optionsError = validateCodeModeRunOptions(options)
      if (optionsError !== undefined) return yield* Effect.fail(optionsError)
      try {
        Schema.decodeUnknownSync(CodeModeSourceSchema)(code)
      } catch (cause) {
        return yield* Effect.fail(
          createCodeModeFailure({
            _tag: 'validation',
            operation: 'source',
            message: getCodeModeSchemaFailureMessage(cause, 'The code mode source is invalid.'),
          }),
        )
      }

      const effectSignal = yield* Effect.abortSignal
      const deadline = yield* createCodeModeDeadline(effectSignal, options.signal, options.timeoutMs)
      const deadlineFailure = getCodeModeDeadlineFailure(deadline, options.timeoutMs)
      if (deadlineFailure !== undefined) return yield* Effect.fail(deadlineFailure)

      const filename = createCodeModeFilename(options.cwd, options.filenamePrefix, ++evaluationNumber)
      const importError = validateCodeModeImports(code)
      if (importError !== undefined) return yield* Effect.fail(importError)
      const transformed = yield* Effect.try({
        try: () => transformCodeModeProgram(jiti, definition, code, filename),
        catch: (cause) =>
          createCodeModeFailure({
            _tag: 'transform',
            operation: 'transform',
            message: 'The TypeScript program could not be transformed.',
            cause,
          }),
      })
      if (deadline.isTimedOut()) return yield* Effect.fail(createCodeModeTimeoutFailure(options.timeoutMs))

      const queue = yield* createCodeModeRequestQueue(host)
      const invokeSync = (method: string, args: readonly unknown[]): unknown => {
        const methodDefinition = findCodeModeMethod(definition, method)
        if (methodDefinition === undefined || methodDefinition.kind !== 'sync')
          throw createCodeModeFailure({
            _tag: 'validation',
            operation: 'method',
            message: `The code mode method ${method} is not synchronous.`,
          })
        if (host.invokeSync === undefined)
          throw createCodeModeFailure({
            _tag: 'invoke',
            operation: method,
            message: `The code mode host does not implement synchronous method ${method}.`,
          })
        return host.invokeSync(method, args)
      }
      const api = createCodeModeApi(definition.methods, invokeSync, (method, args) =>
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
        catch: (cause) =>
          createCodeModeFailure({
            _tag: 'serialize',
            operation: 'result',
            message: 'The code mode result is not structured-cloneable.',
            cause,
          }),
      })

      function runInProcess(): Effect.Effect<unknown, CodeModeFailure | E, R> {
        return Effect.tryPromise({
          try: () => runCodeModeVm(transformed, api, filename, options.timeoutMs, deadline.startedAt, deadline.signal),
          catch: (cause) => mapCodeModeCause(cause, deadline, options.timeoutMs, 'invoke'),
        })
      }

      function runInWorker(): Effect.Effect<unknown, CodeModeFailure | E, R> {
        return runCodeModeWorkerEvaluation(
          definition,
          transformed,
          filename,
          options.timeoutMs,
          deadline.startedAt,
          deadline.signal,
          queue,
          invokeSync,
          host.errorCodec,
        ).pipe(Effect.catch((cause) => Effect.fail(mapCodeModeCause(cause, deadline, options.timeoutMs, 'worker'))))
      }
    },
    (effect) => Effect.scoped(effect),
  )

  return { evaluate }
}

function createCodeModeDeadline(
  effectSignal: AbortSignal,
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): Effect.Effect<CodeModeDeadline, never, Scope> {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const controller = new AbortController()
      const startedAt = Date.now()
      let timedOut = false
      const abort = (): void => controller.abort()
      const timeoutId = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
      const signals = [effectSignal, callerSignal].filter((signal): signal is AbortSignal => signal !== undefined)
      for (const signal of signals) {
        if (signal.aborted) controller.abort()
        else signal.addEventListener('abort', abort, { once: true })
      }
      return {
        startedAt,
        signal: controller.signal,
        isTimedOut: () => timedOut,
        dispose: () => {
          clearTimeout(timeoutId)
          for (const signal of signals) signal.removeEventListener('abort', abort)
        },
      }
    }),
    (deadline) => Effect.sync(deadline.dispose),
  )
}

function getCodeModeDeadlineFailure(deadline: CodeModeDeadline, timeoutMs: number): CodeModeFailure | undefined {
  if (deadline.isTimedOut()) return createCodeModeTimeoutFailure(timeoutMs)
  if (deadline.signal.aborted) return createCodeModeCancellationFailure()
  return undefined
}

function mapCodeModeCause<E>(
  cause: unknown,
  deadline: CodeModeDeadline,
  timeoutMs: number,
  operation: 'invoke' | 'worker',
): CodeModeFailure | E {
  const deadlineFailure = getCodeModeDeadlineFailure(deadline, timeoutMs)
  if (deadlineFailure !== undefined) return deadlineFailure
  if (isCodeModeHostError<E>(cause)) return cause.value
  if (isCodeModeFailure(cause)) return cause
  return createCodeModeFailure({
    _tag: operation,
    operation,
    message: `The code mode program failed during ${operation}.`,
    cause,
  })
}

function recoverCodeModeCause<E>(
  cause: Cause.Cause<CodeModeFailure | E>,
  deadline: CodeModeDeadline,
  timeoutMs: number,
): Effect.Effect<never, CodeModeFailure | E> {
  if (Cause.hasInterrupts(cause))
    return Effect.fail(getCodeModeDeadlineFailure(deadline, timeoutMs) ?? createCodeModeCancellationFailure())
  return Effect.failCause(cause)
}

function createCodeModeCancellationFailure(): CodeModeFailure {
  return createCodeModeFailure({
    _tag: 'cancellation',
    operation: 'evaluation',
    message: 'The code mode evaluation was cancelled.',
  })
}

function createCodeModeTimeoutFailure(timeoutMs: number): CodeModeFailure {
  return createCodeModeFailure({
    _tag: 'timeout',
    operation: 'evaluation',
    message: `The code mode evaluation timed out after ${timeoutMs}ms.`,
  })
}

export { createCodeModeCore }
