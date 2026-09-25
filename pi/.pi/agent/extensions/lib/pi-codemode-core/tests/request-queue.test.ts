import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { ProgramHost } from '../src/contract.ts'
import { createCodeModeRequestQueue } from '../src/request-queue.ts'

describe('code mode request queue', () => {
  test('should run host calls in offer order given queued invocations', async () => {
    //given
    const events: string[] = []
    const host: ProgramHost<never, never> = {
      invoke: (method: string) =>
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
          const queue = yield* Effect.provideService(
            createCodeModeRequestQueue<never, never>(),
            ProgramHost<never, never>(),
            host,
          )
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

  test('should process later requests given a host that throws before returning an Effect', async () => {
    //given
    const host: ProgramHost<never, never> = {
      invoke: (method: string) => {
        if (method === 'throws') throw new Error('Host failed before returning an Effect.')
        return Effect.succeed(method)
      },
    }
    const signal = new AbortController().signal
    const evaluation = Effect.scoped(
      Effect.gen(function* () {
        const queue = yield* Effect.provideService(
          createCodeModeRequestQueue<never, never>(),
          ProgramHost<never, never>(),
          host,
        )
        const failed = queue.invoke('throws', [], signal).then(
          () => 'unexpected',
          (cause: unknown) => cause,
        )
        const next = queue.invoke('next', [], signal)
        return yield* Effect.promise(() => Promise.all([failed, next]))
      }),
    ).pipe(Effect.timeout(250))

    //when
    const result = Effect.runPromise(evaluation)

    //then
    await expect(result).resolves.toEqual([expect.objectContaining({ _tag: 'invoke', operation: 'throws' }), 'next'])
  })

  test('should reject the call given its signal aborts', async () => {
    //given
    const controller = new AbortController()
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.never,
    }

    //when
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* Effect.provideService(
            createCodeModeRequestQueue<never, never>(),
            ProgramHost<never, never>(),
            host,
          )
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

  test('should interrupt the active host call given the scope closes', async () => {
    //given
    let interrupted = false
    let resolveStarted: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve
    })
    const host: ProgramHost<never, never> = {
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
          const queue = yield* Effect.provideService(
            createCodeModeRequestQueue<never, never>(),
            ProgramHost<never, never>(),
            host,
          )
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

  test('should reject invocations given the scope is closed', async () => {
    //given
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.never,
    }
    const signal = new AbortController().signal
    const queue = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          return yield* Effect.provideService(
            createCodeModeRequestQueue<never, never>(),
            ProgramHost<never, never>(),
            host,
          )
        }),
      ),
    )

    //when
    const result = queue.invoke('closed', [], signal)

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'cancellation', operation: 'queue' })
  })

  test('should reject pending calls given the scope closes', async () => {
    //given
    const host: ProgramHost<never, never> = {
      invoke: () => Effect.never,
    }
    const signal = new AbortController().signal

    //when
    const result = Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const queue = yield* Effect.provideService(
            createCodeModeRequestQueue<never, never>(),
            ProgramHost<never, never>(),
            host,
          )
          return queue.invoke('closed', [], signal)
        }),
      ),
    )

    //then
    await expect(result).rejects.toMatchObject({ _tag: 'cancellation', operation: 'queue' })
  })
})
