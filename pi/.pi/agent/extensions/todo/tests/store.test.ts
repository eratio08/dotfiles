import assert from 'node:assert/strict'
import test from 'node:test'
import { Effect, ManagedRuntime } from 'effect'
import type { Todo } from '../src/model.ts'
import { TodoUpdateError } from '../src/state.ts'
import { TodoStore } from '../src/store.ts'

const firstId = '018f0000-0000-7000-8000-000000000001'
const secondId = '018f0000-0001-7000-8000-000000000002'

function task(id: string, content: string): Todo {
  return { id, content, status: 'pending', dependsOn: [] }
}

test('commits a successful transaction and reports whether it changed state', async () => {
  //given
  const runtime = ManagedRuntime.make(TodoStore.layer)

  //when
  const result = await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* TodoStore
      return yield* store.transact((draft) =>
        Effect.sync(() => {
          draft.replace([task(firstId, 'created')])
          return 'done'
        }),
      )
    }),
  )

  //then
  assert.equal(result.value, 'done')
  assert.equal(result.changed, true)
  assert.equal(result.todos[0]?.content, 'created')
  await runtime.dispose()
})

test('discards every draft mutation when the program throws', async () => {
  //given
  const runtime = ManagedRuntime.make(TodoStore.layer)
  const cause = new Error('program failed')

  //when
  const execution = runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* TodoStore
      return yield* store.transact((draft) =>
        Effect.gen(function* () {
          draft.replace([task(firstId, 'discarded')])
          return yield* Effect.fail(new TodoUpdateError({ message: cause.message, cause }))
        }),
      )
    }),
  )

  //then
  await assert.rejects(execution, (error: unknown) => {
    assert.ok(error instanceof TodoUpdateError)
    assert.equal(error.message, 'program failed')
    assert.equal(error.cause, cause)
    return true
  })
  const snapshot = await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* TodoStore
      return yield* store.snapshot
    }),
  )
  assert.deepEqual(snapshot, [])
  await runtime.dispose()
})

test('serializes concurrent transactions around one shared snapshot', async () => {
  //given
  const runtime = ManagedRuntime.make(TodoStore.layer)
  const first = runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* TodoStore
      return yield* store.transact((draft) =>
        Effect.gen(function* () {
          draft.replace([task(firstId, 'first')])
          yield* Effect.sleep(10)
          return draft.snapshot().length
        }),
      )
    }),
  )
  const second = runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* TodoStore
      return yield* store.transact((draft) =>
        Effect.sync(() => {
          draft.replace([...draft.snapshot(), task(secondId, 'second')])
          return draft.snapshot().length
        }),
      )
    }),
  )

  //when
  await Promise.all([first, second])

  //then
  const snapshot = await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* TodoStore
      return yield* store.snapshot
    }),
  )
  assert.deepEqual(
    snapshot.map((todo) => todo.content),
    ['first', 'second'],
  )
  await runtime.dispose()
})

test('does not append a change for a read-only transaction', async () => {
  //given
  const runtime = ManagedRuntime.make(TodoStore.layer)

  //when
  const result = await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* TodoStore
      return yield* store.transact((draft) => Effect.succeed(draft.snapshot().length))
    }),
  )

  //then
  assert.equal(result.value, 0)
  assert.equal(result.changed, false)
  await runtime.dispose()
})

test('rejects an aborted transaction before it runs', async () => {
  //given
  const runtime = ManagedRuntime.make(TodoStore.layer)
  const controller = new AbortController()
  controller.abort()

  //when
  const execution = runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* TodoStore
      return yield* store.transact(() => Effect.succeed('not run'), controller.signal)
    }),
  )

  //then
  await assert.rejects(execution, /aborted/)
  await runtime.dispose()
})

test('passes the Effect cancellation signal to a transaction and prevents a late commit', async () => {
  //given
  const runtime = ManagedRuntime.make(TodoStore.layer)
  const controller = new AbortController()
  let resolveStarted!: () => void
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve
  })
  let transactionSignal: AbortSignal | undefined
  const execution = runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* TodoStore
      return yield* store.transact((draft, signal) =>
        Effect.tryPromise({
          try: () =>
            new Promise<string>((resolve) => {
              transactionSignal = signal
              resolveStarted()
              signal.addEventListener(
                'abort',
                () => {
                  draft.replace([task(firstId, 'late')])
                  resolve('done')
                },
                { once: true },
              )
            }),
          catch: (cause) => new TodoUpdateError({ message: String(cause), cause }),
        }),
      )
    }),
    { signal: controller.signal },
  )
  await started

  //when
  controller.abort()

  //then
  await assert.rejects(execution)
  assert.equal(transactionSignal?.aborted, true)
  const snapshot = await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* TodoStore
      return yield* store.snapshot
    }),
  )
  assert.deepEqual(snapshot, [])
  await runtime.dispose()
})
