import { Context, Effect, Layer, Ref, Result } from 'effect'
import {
  applyTodoOperation,
  cloneTodos,
  extractLatestTodoSnapshot,
  type Todo,
  type TodoTaskOperation,
  type TodoTransitionResult,
  TodoUpdateError,
  validateTodoUpdate,
} from './state.ts'

interface TodoStoreState {
  readonly todos: readonly Todo[]
  readonly suspended: boolean
  readonly wasActiveBeforeSuspend: boolean
}

interface TodoResumeResult {
  resumed: boolean
  wasActiveBeforeSuspend: boolean
  todos: readonly Todo[]
}

class TodoStore extends Context.Service<
  TodoStore,
  {
    readonly snapshot: Effect.Effect<readonly Todo[]>
    readonly restore: (entries: readonly unknown[]) => Effect.Effect<readonly Todo[]>
    readonly replace: (next: readonly Todo[]) => Effect.Effect<readonly Todo[], TodoUpdateError>
    readonly transition: (operation: TodoTaskOperation) => Effect.Effect<TodoTransitionResult, TodoUpdateError>
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

      const snapshot = Ref.get(state).pipe(Effect.map((value) => cloneTodos(value.todos)))

      const restore = Effect.fnUntraced(function* (entries: readonly unknown[]) {
        const todos = extractLatestTodoSnapshot(entries)
        yield* Ref.update(state, (value) => ({ ...value, todos: cloneTodos(todos) }))
        return cloneTodos(todos)
      })

      const replace = Effect.fnUntraced(function* (next: readonly Todo[]) {
        const result = yield* Ref.modify(
          state,
          (value): readonly [Result.Result<readonly Todo[], TodoUpdateError>, TodoStoreState] => {
            const error = validateTodoUpdate(value.todos, next)
            if (error) {
              return [
                Result.fail(new TodoUpdateError({ message: error })) as Result.Result<readonly Todo[], TodoUpdateError>,
                value,
              ]
            }

            const todos = cloneTodos(next)
            return [Result.succeed(todos) as Result.Result<readonly Todo[], TodoUpdateError>, { ...value, todos }]
          },
        )

        if (Result.isFailure(result)) {
          return yield* Effect.fail(result.failure)
        }
        return cloneTodos(result.success)
      })

      const transition = Effect.fnUntraced(function* (operation: TodoTaskOperation) {
        const result = yield* Ref.modify(
          state,
          (value): readonly [Result.Result<TodoTransitionResult, TodoUpdateError>, TodoStoreState] => {
            const transitionResult = applyTodoOperation(value.todos, operation)
            if (transitionResult.error) {
              return [
                Result.fail(new TodoUpdateError({ message: transitionResult.error })) as Result.Result<
                  TodoTransitionResult,
                  TodoUpdateError
                >,
                value,
              ]
            }

            const todos = cloneTodos(transitionResult.todos)
            return [
              Result.succeed({ todos, changed: transitionResult.changed }) as Result.Result<
                TodoTransitionResult,
                TodoUpdateError
              >,
              { ...value, todos },
            ]
          },
        )

        if (Result.isFailure(result)) {
          return yield* Effect.fail(result.failure)
        }
        return { todos: cloneTodos(result.success.todos), changed: result.success.changed }
      })

      const isSuspended = Ref.get(state).pipe(Effect.map((value) => value.suspended))

      const suspend = Effect.fnUntraced(function* (wasActiveBeforeSuspend: boolean) {
        return yield* Ref.modify(state, (value) =>
          value.suspended ? [false, value] : [true, { ...value, suspended: true, wasActiveBeforeSuspend }],
        )
      })

      const resume: Effect.Effect<TodoResumeResult> = Ref.modify(
        state,
        (value): readonly [TodoResumeResult, TodoStoreState] => {
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
        },
      )

      return TodoStore.of({ snapshot, restore, replace, transition, isSuspended, suspend, resume })
    }),
  )
}

export { type TodoResumeResult, TodoStore }
