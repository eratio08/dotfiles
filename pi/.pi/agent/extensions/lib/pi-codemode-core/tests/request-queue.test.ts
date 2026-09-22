import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import type { CodeModeEffectHost } from '../src/code-mode-contract.ts'
import { createCodeModeRequestQueue } from '../src/code-mode-request-queue.ts'

describe('code mode request queue', () => {
  test('runs host calls in offer order', async () => {
    //given
    const events: string[] = []
    const host: CodeModeEffectHost<never, never> = {
      invoke: (method) =>
        Effect.promise(async () => {
          events.push(`${method}:start`)
          await Promise.resolve()
          events.push(`${method}:end`)
          return method
        }),
    }
    const signal = new AbortController().signal

    //when
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* createCodeModeRequestQueue(host)
          const first = queue.invoke('first', [], signal)
          const second = queue.invoke('second', [], signal)
          return yield* Effect.promise(() => Promise.all([first, second]))
        }),
      ),
    )

    //then
    expect(result).toEqual(['first', 'second'])
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  test('rejects a call when its signal aborts', async () => {
    //given
    const controller = new AbortController()
    const host: CodeModeEffectHost<never, never> = {
      invoke: () => Effect.never,
    }

    //when
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* createCodeModeRequestQueue(host)
          const promise = queue.invoke('slow', [], controller.signal)
          controller.abort()
          return yield* Effect.promise(() =>
            promise.then(
              () => 'resolved',
              () => 'rejected',
            ),
          )
        }),
      ),
    )

    //then
    expect(result).toBe('rejected')
  })

  test('interrupts the active host call when the scope closes', async () => {
    //given
    let interrupted = false
    let resolveStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const host: CodeModeEffectHost<never, never> = {
      invoke: () => {
        resolveStarted()
        return Effect.never.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              interrupted = true
            }),
          ),
        )
      },
    }
    const signal = new AbortController().signal
    let request!: Promise<unknown>

    //when
    const result = Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* createCodeModeRequestQueue(host)
          request = queue.invoke('active', [], signal)
          yield* Effect.promise(() => started)
          return 'closed'
        }),
      ),
    )
    await result

    //then
    await expect(request).rejects.toMatchObject({ _tag: 'cancellation', operation: 'queue' })
    expect(interrupted).toBe(true)
  })

  test('rejects invocations after the scope closes', async () => {
    //given
    const host: CodeModeEffectHost<never, never> = {
      invoke: () => Effect.never,
    }
    const signal = new AbortController().signal
    const queue = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          return yield* createCodeModeRequestQueue(host)
        }),
      ),
    )

    //when
    const result = queue.invoke('closed', [], signal)

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'cancellation', operation: 'queue' })
  })

  test('rejects pending calls when the scope closes', async () => {
    //given
    const host: CodeModeEffectHost<never, never> = {
      invoke: () => Effect.never,
    }
    const signal = new AbortController().signal

    //when
    const result = Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* createCodeModeRequestQueue(host)
          return queue.invoke('closed', [], signal)
        }),
      ),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'cancellation', operation: 'queue' })
  })
})
