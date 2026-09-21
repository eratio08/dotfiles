import assert from 'node:assert/strict'
import test from 'node:test'
import { Effect, ManagedRuntime } from 'effect'
import type { Todo } from '../src/model.ts'
import {
  cloneTodos,
  extractLatestTodoSnapshot,
  formatTodoContext,
  formatTodoReminder,
  getTodoCounts,
  getTodoHandoffSnapshot,
  summarizeTodos,
  todoDescriptionLines,
} from '../src/state.ts'
import { TodoStore } from '../src/store.ts'

const firstId = '018f0000-0000-7000-8000-000000000001'
const secondId = '018f0000-0001-7000-8000-000000000002'
const thirdId = '018f0000-0002-7000-8000-000000000003'

function todo(
  id: string,
  content: string,
  status: Todo['status'] = 'pending',
  dependsOn: string[] = [],
  details?: string,
): Todo {
  return { id, content, status, dependsOn, ...(details === undefined ? {} : { details }) }
}

function sessionEntry(todos: readonly Todo[]): unknown {
  return { type: 'custom', customType: 'todo', data: { todos } }
}

test('migrates legacy description fields during snapshot restore', () => {
  //given
  const legacy = sessionEntry([
    {
      id: firstId,
      content: 'legacy task',
      status: 'pending',
      dependsOn: [],
      description: 'legacy details',
    } as unknown as Todo,
  ])

  //when
  const todos = extractLatestTodoSnapshot([legacy])

  //then
  assert.equal(todos[0]?.details, 'legacy details')
})

test('restores the latest valid todo snapshot and derives blocked state', () => {
  //given
  const first = todo(firstId, 'first', 'completed')
  const second = todo(secondId, 'second', 'pending', [firstId], 'details')
  const older = sessionEntry([todo(thirdId, 'older')])
  const latest = sessionEntry([first, second])

  //when
  const todos = extractLatestTodoSnapshot([older, latest])

  //then
  assert.equal(todos[1]?.status, 'pending')
  assert.equal(todos[1]?.details, 'details')
  assert.deepEqual(todos[1]?.dependsOn, [firstId])
})

test('formats task details and lifecycle counts', () => {
  //given
  const todos = [
    todo(firstId, 'active', 'in_progress', [], ' line one\n\n line two '),
    todo(secondId, 'blocked', 'blocked', [firstId]),
    todo(thirdId, 'done', 'completed'),
  ]

  //when
  const lines = todoDescriptionLines(todos[0] as Todo)

  //then
  assert.deepEqual(lines, ['line one', 'line two'])
  assert.match(formatTodoContext(todos), /details=/)
  assert.match(formatTodoReminder(todos), /Current item: active/)
  assert.deepEqual(getTodoCounts(todos), {
    total: 3,
    pending: 0,
    inProgress: 1,
    blocked: 1,
    completed: 1,
    omitted: 0,
    open: 2,
    closed: 1,
  })
  assert.match(summarizeTodos(todos), /1 in progress/)
})

test('handoff keeps open tasks and trims closed dependencies', () => {
  //given
  const completed = todo(firstId, 'completed', 'completed')
  const active = todo(secondId, 'active', 'in_progress', [firstId])
  const blocked = todo(thirdId, 'blocked', 'blocked', [secondId])

  //when
  const handoff = getTodoHandoffSnapshot([completed, active, blocked])

  //then
  assert.deepEqual(
    handoff.map((item) => item.id),
    [secondId, thirdId],
  )
  assert.deepEqual(handoff[0]?.dependsOn, [])
  assert.deepEqual(handoff[1]?.dependsOn, [secondId])
})

test('serializes store restore and rejects invalid replacement without changing state', async () => {
  //given
  const runtime = ManagedRuntime.make(TodoStore.layer)
  const initial = [todo(firstId, 'initial')]

  //when
  const result = await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* TodoStore
      yield* store.restore([sessionEntry(initial)])
      const rejected = yield* Effect.match(store.replace([todo(firstId, 'invalid', 'pending', [secondId])]), {
        onFailure: (error) => ({ kind: 'error' as const, message: error.message }),
        onSuccess: () => ({ kind: 'success' as const }),
      })
      return { rejected, snapshot: yield* store.snapshot }
    }),
  )

  //then
  assert.equal(result.rejected.kind, 'error')
  assert.deepEqual(result.snapshot, initial)
  await runtime.dispose()
})

test('preserves suspension state across resume', async () => {
  //given
  const runtime = ManagedRuntime.make(TodoStore.layer)

  //when
  const result = await runtime.runPromise(
    Effect.gen(function* () {
      const store = yield* TodoStore
      const firstSuspend = yield* store.suspend(true)
      const secondSuspend = yield* store.suspend(true)
      const resumed = yield* store.resume
      const secondResume = yield* store.resume
      return { firstSuspend, secondSuspend, resumed, secondResume }
    }),
  )

  //then
  assert.equal(result.firstSuspend, true)
  assert.equal(result.secondSuspend, false)
  assert.equal(result.resumed.wasActiveBeforeSuspend, true)
  assert.equal(result.secondResume.resumed, false)
  await runtime.dispose()
})

test('clones snapshots before returning them', () => {
  //given
  const source = [todo(firstId, 'task', 'pending', [secondId])]

  //when
  const clone = cloneTodos(source)
  const changed = [...(clone[0]?.dependsOn ?? []), thirdId]

  //then
  assert.deepEqual(changed, [secondId, thirdId])
  assert.deepEqual(source[0]?.dependsOn, [secondId])
})
