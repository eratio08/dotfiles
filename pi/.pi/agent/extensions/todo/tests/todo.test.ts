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
const fourthId = '018f0000-0003-7000-8000-000000000004'

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

test('should migrate legacy description fields given a restored snapshot', () => {
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

test('should restore the latest valid snapshot and derive blocked state given multiple snapshots', () => {
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

test('should format task details and lifecycle counts given a task snapshot', () => {
  //given
  const todos = [
    todo(firstId, 'active', 'in_progress', [], ' line one\n\n line two '),
    todo(secondId, 'blocked', 'blocked', [firstId], 'blocked details'),
    todo(thirdId, 'done', 'completed', [], 'done details'),
  ]

  //when
  const lines = todoDescriptionLines(todos[0] as Todo)
  const context = formatTodoContext(todos)

  //then
  assert.deepEqual(lines, ['line one', 'line two'])
  assert.match(context, /Current task: "active"/)
  assert.match(context, /Details: " line one\n\n line two "/)
  assert.doesNotMatch(context, /content=|details=|authoritative/)
  assert.doesNotMatch(context, /blocked details/)
  assert.doesNotMatch(context, /done details/)
  assert.doesNotMatch(context, /status=/)
  assert.match(context, /Tasks: 2 remaining, 1 blocked, 1 complete, 0 omitted\./)
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

test('should report blocked task counts without task names given blocked tasks', () => {
  //given
  const todos = [todo(firstId, 'blocked one', 'blocked'), todo(secondId, 'blocked two', 'blocked')]

  //when
  const reminder = formatTodoReminder(todos)

  //then
  assert.match(reminder, /Blocked: 2 tasks\./)
  assert.doesNotMatch(reminder, /blocked one/)
  assert.doesNotMatch(reminder, /blocked two/)
})

test('should project one task given multiple independent todo trees', () => {
  //given
  const todos = [
    todo(firstId, 'tree one active', 'in_progress', [], 'active details'),
    todo(secondId, 'tree one blocked', 'blocked', [firstId], 'blocked details'),
    todo(thirdId, 'tree two ready', 'pending', [], 'ready details'),
    todo(fourthId, 'tree two blocked', 'blocked', [thirdId], 'other details'),
  ]

  //when
  const context = formatTodoContext(todos)

  //then
  assert.match(context, /Current task: "tree one active"/)
  assert.match(context, /Details: "active details"/)
  assert.doesNotMatch(context, /tree one blocked/)
  assert.doesNotMatch(context, /tree two ready/)
  assert.doesNotMatch(context, /tree two blocked/)
  assert.doesNotMatch(context, /blocked details|ready details|other details/)
  assert.match(context, /Tasks: 4 remaining, 2 blocked, 0 complete, 0 omitted\./)
})

test('should restore the latest todo tree given multiple snapshots', () => {
  //given
  const firstTree = sessionEntry([
    todo(firstId, 'first tree root'),
    todo(secondId, 'first tree child', 'blocked', [firstId]),
  ])
  const secondTree = sessionEntry([
    todo(thirdId, 'second tree root'),
    todo(fourthId, 'second tree child', 'blocked', [thirdId]),
  ])

  //when
  const todos = extractLatestTodoSnapshot([firstTree, secondTree])

  //then
  assert.deepEqual(
    todos.map((item) => item.content),
    ['second tree root', 'second tree child'],
  )
  assert.deepEqual(todos[1]?.dependsOn, [thirdId])
})

test('should keep open tasks and trim closed dependencies given a handoff', () => {
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

test('should serialize store restore and reject invalid replacement without changing state given concurrent calls', async () => {
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

test('should preserve suspension state given a resume operation', async () => {
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

test('should clone snapshots before returning them given a snapshot read', () => {
  //given
  const source = [todo(firstId, 'task', 'pending', [secondId])]

  //when
  const clone = cloneTodos(source)
  const changed = [...(clone[0]?.dependsOn ?? []), thirdId]

  //then
  assert.deepEqual(changed, [secondId, thirdId])
  assert.deepEqual(source[0]?.dependsOn, [secondId])
})
