import assert from 'node:assert/strict'
import test from 'node:test'
import { Effect, ManagedRuntime } from 'effect'
import {
  applyTodoOperation,
  buildTodoUpdate,
  decodeTodoList,
  extractLatestTodoSnapshot,
  formatTodoContext,
  formatTodoReminder,
  getNextReadyTodo,
  getTodoCounts,
  getTodoHandoffSnapshot,
  getTodoNextState,
  summarizeTodos,
  type Todo,
  TodoUpdateError,
  todoDescriptionLines,
  validateTodoUpdate,
} from '../src/state.ts'
import { TodoStore } from '../src/store.ts'

const firstId = '018f00000000-7000-8000-0000-000000000001'
const secondId = '018f00000001-7000-8000-0000-000000000002'
const thirdId = '018f00000002-7000-8000-0000-000000000003'
const sameTimeFirstId = '018f0000-0000-7000-8000-ffffffffffff'
const sameTimeSecondId = '018f0000-0000-7000-8000-000000000004'

function todo(
  id: string,
  content: string,
  status: Todo['status'] = 'pending',
  dependsOn: string[] = [],
  description?: string,
): Todo {
  return description ? { id, content, status, dependsOn, description } : { id, content, status, dependsOn }
}

function nextIdGenerator(...ids: string[]): () => string {
  let index = 0
  return () => ids[index++] ?? `018f00000010-7000-8000-0000-00000000000${index}`
}

const generated = buildTodoUpdate(
  [
    { content: 'first task', dependsOn: [] },
    { content: 'second task', dependsOn: [] },
  ],
  [],
  nextIdGenerator(firstId, secondId),
)
assert.deepEqual(generated, [todo(firstId, 'first task'), todo(secondId, 'second task')])

const preserved = buildTodoUpdate(
  [
    { content: 'first task', dependsOn: [] },
    { content: 'new task', dependsOn: [] },
  ],
  [todo(firstId, 'first task')],
  nextIdGenerator(thirdId),
)
assert.deepEqual(preserved, [todo(firstId, 'first task'), todo(thirdId, 'new task')])

const decoded = decodeTodoList([{ content: 'task', dependsOn: [], description: '  details  ' }])
assert.ok(decoded)
assert.match(decoded[0]?.id ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/)
assert.deepEqual(decoded[0]?.description, 'details')
assert.equal(decodeTodoList([{ content: '', dependsOn: [] }]), undefined)

const withDescription = todo(firstId, 'first', 'pending', [], '  line one \n\n line two  ')
assert.deepEqual(todoDescriptionLines(withDescription), ['line one', 'line two'])
assert.deepEqual(todoDescriptionLines(todo(secondId, 'second')), [])
assert.doesNotMatch(formatTodoContext([withDescription]), /018f00000000-7000-8000-0000-000000000001/)
assert.doesNotMatch(formatTodoContext([withDescription]), /dependsOn=/)
assert.match(formatTodoReminder([withDescription]), /Current item: first —/)

test('formats only the first open task for model context', () => {
  //given
  const first = todo(firstId, 'first', 'in_progress', [], 'first details')
  const second = todo(secondId, 'second', 'pending', [], 'second details')

  //when
  const context = formatTodoContext([first, second])

  //then
  assert.doesNotMatch(context, /018f00000000-7000-8000-000000000001/)
  assert.match(context, /description="first details"/)
  assert.doesNotMatch(context, /second/)
  assert.match(context, /1 more open task remain after this one/)
  assert.match(context, /todonext/)
})

test('reports no open tasks in model context', () => {
  //given
  const completed = todo(firstId, 'done', 'completed')
  const omitted = todo(secondId, 'skipped', 'omitted')

  //when
  const context = formatTodoContext([completed, omitted])

  //then
  assert.equal(context, 'TODO STATUS: all tracked todos are completed or omitted.')
})

const active = todo(firstId, 'active', 'in_progress')
const ready = todo(secondId, 'ready')
const waiting = todo(thirdId, 'waiting', 'pending', [firstId])
const blocked = todo('018f00000004-7000-8000-0000-000000000004', 'blocked', 'blocked')
assert.equal(getNextReadyTodo([ready, active, waiting]), active)
assert.equal(getNextReadyTodo([waiting, ready]), ready)
assert.equal(getNextReadyTodo([waiting, blocked]), undefined)
assert.equal(
  getNextReadyTodo([todo(sameTimeFirstId, 'snapshot second'), todo(sameTimeSecondId, 'snapshot first')])?.content,
  'snapshot second',
)
assert.equal(
  getNextReadyTodo([
    todo('018f0000-0001-7000-8000-000000000005', 'newer'),
    todo('018f0000-0000-7000-8000-000000000006', 'older'),
  ])?.content,
  'older',
)
assert.deepEqual(getTodoNextState([waiting, blocked]), {
  status: 'none',
  waiting: [waiting],
  blocked: [blocked],
})
assert.match(formatTodoReminder([waiting, blocked]), /no task is ready/)
assert.match(formatTodoReminder([waiting, blocked]), /Waiting: waiting/)
assert.match(formatTodoReminder([waiting, blocked]), /Blocked: blocked/)

const completedDependency = todo(firstId, 'done', 'completed')
const omittedDependency = todo(secondId, 'skipped', 'omitted')
const readyWithDependencies = todo(thirdId, 'ready', 'pending', [firstId, secondId])
assert.equal(getNextReadyTodo([readyWithDependencies, completedDependency, omittedDependency]), readyWithDependencies)

assert.equal(validateTodoUpdate([], [todo(firstId, 'first')]), undefined)
assert.match(validateTodoUpdate([], [todo(firstId, 'first', 'blocked')]) ?? '', /must start in pending/)
assert.match(validateTodoUpdate([], [todo(firstId, 'first', 'pending', ['missing'])]) ?? '', /unknown id missing/)
assert.match(validateTodoUpdate([], [todo(firstId, 'first', 'pending', [firstId])]) ?? '', /cannot depend on itself/)
assert.match(
  validateTodoUpdate(
    [],
    [todo(firstId, 'first', 'pending', [secondId]), todo(secondId, 'second', 'pending', [firstId])],
  ) ?? '',
  /cannot contain a cycle/,
)
assert.match(validateTodoUpdate([], [todo(firstId, 'first'), todo(firstId, 'duplicate')]) ?? '', /ids must be unique/)
assert.match(
  validateTodoUpdate(
    [todo(firstId, 'active', 'in_progress')],
    [todo(firstId, 'active', 'in_progress'), todo(secondId, 'second', 'in_progress')],
  ) ?? '',
  /multiple in_progress/,
)
assert.match(validateTodoUpdate([], [todo(firstId, 'first', 'completed')]) ?? '', /must start in pending/)
assert.match(validateTodoUpdate([todo(firstId, 'pending')], [todo(secondId, 'pending')]) ?? '', /Cannot remove open/)
assert.match(
  validateTodoUpdate([todo(firstId, 'active', 'in_progress')], [todo(firstId, 'active', 'completed')]) ?? '',
  /Use a todo operation/,
)
assert.match(
  validateTodoUpdate([todo(firstId, 'skip')], [todo(firstId, 'skip', 'omitted')]) ?? '',
  /Use a todo operation/,
)
assert.match(validateTodoUpdate([todo(firstId, 'active', 'in_progress')], []) ?? '', /Cannot clear/)
assert.deepEqual(applyTodoOperation([todo(firstId, 'ready')], 'start_task').todos, [
  todo(firstId, 'ready', 'in_progress'),
])
assert.deepEqual(applyTodoOperation([todo(firstId, 'ready', 'in_progress')], 'complete_task').todos, [
  todo(firstId, 'ready', 'completed'),
])

const restored = extractLatestTodoSnapshot([
  {
    type: 'custom',
    customType: 'todo',
    data: { todos: [todo(secondId, 'now', 'in_progress')] },
  },
])
assert.deepEqual(restored, [todo(secondId, 'now', 'in_progress')])

assert.deepEqual(
  getTodoHandoffSnapshot([
    todo(firstId, 'done', 'completed'),
    todo(secondId, 'active', 'in_progress', [firstId]),
    todo(thirdId, 'later', 'pending', [secondId]),
  ]),
  [todo(secondId, 'active', 'in_progress'), todo(thirdId, 'later', 'pending', [secondId])],
)

const counts = getTodoCounts([
  todo(firstId, 'pending'),
  todo(secondId, 'active', 'in_progress'),
  todo(thirdId, 'blocked', 'blocked'),
  todo('018f00000005-7000-8000-0000-000000000005', 'done', 'completed'),
  todo('018f00000006-7000-8000-0000-000000000006', 'skip', 'omitted'),
])
assert.deepEqual(counts, {
  total: 5,
  pending: 1,
  inProgress: 1,
  blocked: 1,
  completed: 1,
  omitted: 1,
  open: 3,
  closed: 2,
})
assert.equal(
  summarizeTodos([todo(firstId, 'active', 'in_progress'), todo(secondId, 'skip', 'omitted')]),
  'Updated 2 todos: 1 in progress, 1 omitted.',
)

async function runStore<A, E>(effect: Effect.Effect<A, E, TodoStore>): Promise<A> {
  const runtime = ManagedRuntime.make(TodoStore.layer)
  try {
    return await runtime.runPromise(effect)
  } finally {
    await runtime.dispose()
  }
}

test('todo store rejects an invalid dependency graph without changing state', async () => {
  //given
  const previous = [todo(firstId, 'active')]
  const active = todo(firstId, 'active', 'in_progress')

  //when
  const result = await runStore(
    Effect.gen(function* () {
      const store = yield* TodoStore
      yield* store.replace(previous)
      yield* store.transition('start_task')
      const update = yield* Effect.match(store.replace([todo(secondId, 'waiting', 'pending', ['missing'])]), {
        onFailure: (error) => ({ error }),
        onSuccess: (todos) => ({ todos }),
      })
      return { update, current: yield* store.snapshot }
    }),
  )

  //then
  assert.ok('error' in result.update)
  assert.ok(result.update.error instanceof TodoUpdateError)
  assert.deepEqual(result.current, [active])
})

test('todo store suspends and resumes atomically', async () => {
  //given
  const todos = [todo(firstId, 'active')]
  const active = todo(firstId, 'active', 'in_progress')

  //when
  const result = await runStore(
    Effect.gen(function* () {
      const store = yield* TodoStore
      yield* store.replace(todos)
      yield* store.transition('start_task')
      const firstSuspend = yield* store.suspend(true)
      const secondSuspend = yield* store.suspend(false)
      const resume = yield* store.resume
      const secondResume = yield* store.resume
      return { firstSuspend, secondSuspend, resume, secondResume }
    }),
  )

  //then
  assert.equal(result.firstSuspend, true)
  assert.equal(result.secondSuspend, false)
  assert.deepEqual(result.resume, {
    resumed: true,
    wasActiveBeforeSuspend: true,
    todos: [active],
  })
  assert.deepEqual(result.secondResume, {
    resumed: false,
    wasActiveBeforeSuspend: false,
    todos: [active],
  })
})
