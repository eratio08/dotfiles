import { Cause, Clock, Effect, Schema } from 'effect'
import type { Scope } from 'effect/Scope'
import type { CodeModeCore, CodeModeDefinition, CodeModeEffectHostRequirement, CodeModeRunOptions } from './contract.ts'
import { CodeModeEffectHost, findCodeModeMethod } from './contract.ts'
import { type CodeModeFailure, createCodeModeFailure, isCodeModeFailure, isCodeModeHostError } from './failure.ts'
import { CodeModeRequestQueueService, createCodeModeRequestQueue } from './request-queue.ts'
import {
  CodeModeDefinitionSchema,
  CodeModeRunOptionsSchema,
  CodeModeSourceSchema,
  getCodeModeSchemaFailureMessage,
} from './schema.ts'
import {
  createCodeModeApi,
  createCodeModeFilename,
  createCodeModeJiti,
  runCodeModeVm,
  transformCodeModeProgram,
  validateCodeModeImports,
} from './vm.ts'
import { runCodeModeWorkerEvaluation } from './worker-runner.ts'

interface CodeModeDeadline {
  readonly remainingTimeoutMs: () => number
  readonly signal: AbortSignal
  readonly isTimedOut: () => boolean
  readonly dispose: () => void
}

function createCodeModeCore<R, E>(): CodeModeCore<R, E> {
  const jiti = createCodeModeJiti()
  const hostService = CodeModeEffectHost<R, E>()
  let evaluationNumber = 0

  const evaluate = Effect.fnUntraced(
    function* (
      definitionInput: CodeModeDefinition,
      codeInput: string,
      optionsInput: CodeModeRunOptions,
    ): Effect.fn.Return<unknown, CodeModeFailure | E, R | CodeModeEffectHostRequirement<R, E> | Scope> {
      const definition = yield* Schema.decodeUnknownEffect(CodeModeDefinitionSchema)(definitionInput).pipe(
        Effect.mapError((cause) =>
          createCodeModeFailure({
            _tag: 'validation',
            operation: 'definition',
            message: getCodeModeSchemaFailureMessage(cause, 'The code mode definition is invalid.'),
          }),
        ),
      )
      const options = yield* Schema.decodeUnknownEffect(CodeModeRunOptionsSchema)(optionsInput).pipe(
        Effect.mapError((cause) =>
          createCodeModeFailure({
            _tag: 'validation',
            operation: 'options',
            message: getCodeModeSchemaFailureMessage(cause, 'The code mode run options are invalid.'),
          }),
        ),
      )
      const code = yield* Schema.decodeUnknownEffect(CodeModeSourceSchema)(codeInput).pipe(
        Effect.mapError((cause) =>
          createCodeModeFailure({
            _tag: 'validation',
            operation: 'source',
            message: getCodeModeSchemaFailureMessage(cause, 'The code mode source is invalid.'),
          }),
        ),
      )

      const deadline = yield* createCodeModeDeadline(options.signal, options.timeoutMs)
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

      const host = yield* hostService
      const queue = yield* createCodeModeRequestQueue<R, E>()
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
          try: () =>
            runCodeModeVm(
              transformed,
              api,
              filename,
              options.timeoutMs,
              undefined,
              deadline.signal,
              deadline.remainingTimeoutMs,
            ),
          catch: (cause) => mapCodeModeCause(cause, deadline, options.timeoutMs, 'invoke'),
        })
      }

      function runInWorker(): Effect.Effect<unknown, CodeModeFailure | E, R | CodeModeEffectHostRequirement<R, E>> {
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
