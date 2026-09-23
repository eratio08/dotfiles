import { Context, Effect, Layer, Ref, Semaphore } from 'effect'
import { cloneTodos, extractLatestTodoSnapshot, type Todo, TodoUpdateError } from './state.ts'
import { validateTodoGraph } from './state-engine.ts'

interface TodoStoreState {
  readonly todos: readonly Todo[]
  readonly suspended: boolean
  readonly wasActiveBeforeSuspend: boolean
}

interface TodoTransactionDraft {
  readonly snapshot: () => readonly Todo[]
  readonly replace: (todos: readonly Todo[]) => void
}

interface TodoTransactionResult<A> {
  readonly value: A
  readonly todos: readonly Todo[]
  readonly changed: boolean
}

interface TodoResumeResult {
  resumed: boolean
  wasActiveBeforeSuspend: boolean
  todos: readonly Todo[]
}

function snapshotKey(todos: readonly Todo[]): string {
  return JSON.stringify(todos)
}

class TodoStore extends Context.Service<
  TodoStore,
  {
    readonly snapshot: Effect.Effect<readonly Todo[]>
    readonly restore: (entries: readonly unknown[]) => Effect.Effect<readonly Todo[]>
    readonly replace: (next: readonly Todo[]) => Effect.Effect<readonly Todo[], TodoUpdateError>
    readonly transact: <A>(
      run: (draft: TodoTransactionDraft, signal: AbortSignal) => Effect.Effect<A, TodoUpdateError>,
      signal?: AbortSignal,
    ) => Effect.Effect<TodoTransactionResult<A>, TodoUpdateError>
    readonly isSuspended: Effect.Effect<boolean>
    readonly suspend: (wasActiveBeforeSuspend: boolean) => Effect.Effect<boolean>
    readonly resume: Effect.Effect<TodoResumeResult>
  }
>()('todo/TodoStore') {
  static readonly layer = Layer.effect(
    TodoStore,
    Effect.gen(function* () {
      const state = yield* Ref.make<TodoStoreState>({
        todos: [],
        suspended: false,
        wasActiveBeforeSuspend: false,
      })
      const lock = yield* Semaphore.make(1)
      const withLock = <A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, E> => Semaphore.withPermit(lock)(effect)

      const snapshot = withLock(Ref.get(state).pipe(Effect.map((value) => cloneTodos(value.todos))))

      const restore = Effect.fnUntraced(function* (
        entries: readonly unknown[],
      ): Effect.fn.Return<readonly Todo[], never> {
        return yield* withLock(
          Effect.gen(function* () {
            const todos = extractLatestTodoSnapshot(entries)
            yield* Ref.update(state, (value) => ({ ...value, todos: cloneTodos(todos) }))
            return cloneTodos(todos)
          }),
        )
      })

      const replace = Effect.fnUntraced(function* (
        next: readonly Todo[],
      ): Effect.fn.Return<readonly Todo[], TodoUpdateError> {
        return yield* withLock(
          Effect.gen(function* () {
            const error = validateTodoGraph(next)
            if (error) return yield* Effect.fail(new TodoUpdateError({ message: error }))
            const todos = cloneTodos(next)
            yield* Ref.update(state, (value) => ({ ...value, todos }))
            return cloneTodos(todos)
          }),
        )
      })

      const transact = Effect.fnUntraced(function* <A>(
        run: (draft: TodoTransactionDraft, signal: AbortSignal) => Effect.Effect<A, TodoUpdateError>,
        signal?: AbortSignal,
      ): Effect.fn.Return<TodoTransactionResult<A>, TodoUpdateError> {
        return yield* withLock(
          Effect.gen(function* () {
            if (signal?.aborted) {
              return yield* Effect.fail(new TodoUpdateError({ message: 'Todo transaction was aborted.' }))
            }

            const before = yield* Ref.get(state).pipe(Effect.map((value) => cloneTodos(value.todos)))
            let draftTodos = cloneTodos(before)
            const draft: TodoTransactionDraft = {
              snapshot: () => cloneTodos(draftTodos),
              replace: (todos) => {
                draftTodos = cloneTodos(todos)
              },
            }
            const controller = new AbortController()
            const abort = (cause: unknown): void => {
              if (!controller.signal.aborted) controller.abort(cause)
            }
            const abortFromCaller = (): void => abort(signal?.reason)
            const cleanup = (): void => signal?.removeEventListener('abort', abortFromCaller)
            signal?.addEventListener('abort', abortFromCaller, { once: true })
            if (signal?.aborted) abortFromCaller()
            const transactionSignal = controller.signal
            const transaction = Effect.try({
              try: () => run(draft, transactionSignal),
              catch: (cause) =>
                new TodoUpdateError({
                  message: cause instanceof Error ? cause.message : String(cause),
                  cause,
                }),
            }).pipe(
              Effect.flatten,
              Effect.onInterrupt(() => Effect.sync(() => abort(undefined))),
              Effect.ensuring(Effect.sync(cleanup)),
            )
            const value = yield* transaction

            if (signal?.aborted || transactionSignal.aborted) {
              return yield* Effect.fail(new TodoUpdateError({ message: 'Todo transaction was aborted.' }))
            }
            const error = validateTodoGraph(draftTodos)
            if (error) return yield* Effect.fail(new TodoUpdateError({ message: error }))

            const changed = snapshotKey(before) !== snapshotKey(draftTodos)
            if (changed) {
              yield* Ref.update(state, (current) => ({ ...current, todos: cloneTodos(draftTodos) }))
            }
            return { value, todos: cloneTodos(draftTodos), changed }
          }),
        )
      })

      const isSuspended = withLock(Ref.get(state).pipe(Effect.map((value) => value.suspended)))

      const suspend = (wasActiveBeforeSuspend: boolean) =>
        withLock(
          Ref.modify(state, (value) =>
            value.suspended ? [false, value] : [true, { ...value, suspended: true, wasActiveBeforeSuspend }],
          ),
        )

      const resume = withLock(
        Ref.modify(state, (value): readonly [TodoResumeResult, TodoStoreState] => {
          if (!value.suspended) {
            return [{ resumed: false, wasActiveBeforeSuspend: false, todos: cloneTodos(value.todos) }, value]
          }

          return [
            {
              resumed: true,
              wasActiveBeforeSuspend: value.wasActiveBeforeSuspend,
              todos: cloneTodos(value.todos),
            },
            { ...value, suspended: false, wasActiveBeforeSuspend: false },
          ]
        }),
      )

      return TodoStore.of({ snapshot, restore, replace, transact, isSuspended, suspend, resume })
    }),
  )
}

export { type TodoResumeResult, TodoStore, type TodoTransactionDraft, type TodoTransactionResult }
