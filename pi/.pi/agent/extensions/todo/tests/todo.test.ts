import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { TodoContext, TodoEffects, TodoEffectsLayer, TodoUi } from '../src/effects.ts'
import {
  extractLatestTodoSnapshot,
  formatTodoContext,
  formatTodoReminder,
  getTodoCounts,
  getTodoHandoffSnapshot,
  normalizeTodos,
  summarizeTodos,
  type Todo,
  TodoStore,
  TodoUpdateError,
  todoDescriptionLines,
  validateTodoUpdate,
} from '../src/state.ts'

const snapshot = normalizeTodos([
  { content: '  first task  ', status: 'pending', priority: 'high' },
  { content: 'ship', status: 'completed', priority: 'low' },
])

assert.deepEqual(snapshot, [
  { content: 'first task', status: 'pending', priority: 'high' },
  { content: 'ship', status: 'completed', priority: 'low' },
])

assert.equal(normalizeTodos([{ content: '', status: 'pending', priority: 'high' }]), undefined)

const withDescription = normalizeTodos([
  { content: 'first', status: 'pending', priority: 'high', description: '  details here  ' },
  { content: 'second', status: 'pending', priority: 'low', description: '   ' },
  { content: 'third', status: 'pending', priority: 'low', description: 42 },
])
assert.deepEqual(withDescription, [
  { content: 'first', status: 'pending', priority: 'high', description: 'details here' },
  { content: 'second', status: 'pending', priority: 'low' },
  { content: 'third', status: 'pending', priority: 'low' },
])
assert.ok(withDescription)
assert.match(formatTodoContext(withDescription), /description="details here"/)
assert.match(formatTodoReminder(withDescription), /Current item: first — details here/)

const plan = normalizeTodos([
  { content: 'first', status: 'in_progress', priority: 'high' },
  { content: 'second', status: 'pending', priority: 'low' },
])
assert.ok(plan)
assert.equal(validateTodoUpdate([], plan), undefined)
assert.match(
  validateTodoUpdate(plan, [
    { content: 'first', status: 'completed', priority: 'high' },
    { content: 'second', status: 'completed', priority: 'low' },
  ]) ?? '',
  /Cannot complete multiple todos in one update.*Update rejected.*Accepted todo state:/,
)
assert.match(
  validateTodoUpdate(plan, [
    { content: 'first', status: 'in_progress', priority: 'high' },
    { content: 'second', status: 'completed', priority: 'low' },
  ]) ?? '',
  /Cannot complete "second": its accepted status is pending.*First change it to in_progress.*Accepted todo state:/,
)
assert.match(formatTodoReminder(plan), /Current item: first/)

const restored = extractLatestTodoSnapshot([
  {
    type: 'message',
    message: {
      role: 'toolResult',
      toolName: 'todowrite',
      details: { todos: [{ content: 'old', status: 'pending', priority: 'medium' }] },
    },
  },
  {
    type: 'message',
    message: {
      role: 'toolResult',
      toolName: 'todowrite',
      details: {
        todos: [
          { content: 'now', status: 'in_progress', priority: 'high' },
          { content: 'done', status: 'completed', priority: 'low' },
        ],
      },
    },
  },
])

assert.deepEqual(restored, [
  { content: 'now', status: 'in_progress', priority: 'high' },
  { content: 'done', status: 'completed', priority: 'low' },
])

assert.deepEqual(getTodoCounts(restored), {
  total: 2,
  pending: 0,
  inProgress: 1,
  completed: 1,
  cancelled: 0,
  open: 1,
  closed: 1,
})

assert.equal(summarizeTodos(restored), 'Updated 2 todos: 1 in progress, 1 completed.')

const handedOff = extractLatestTodoSnapshot([
  {
    type: 'message',
    message: {
      role: 'toolResult',
      toolName: 'todowrite',
      details: { todos: [{ content: 'old', status: 'pending', priority: 'medium' }] },
    },
  },
  {
    type: 'custom_message',
    customType: 'todo',
    details: {
      todos: [
        { content: 'carry active', status: 'in_progress', priority: 'high' },
        { content: 'carry next', status: 'pending', priority: 'low' },
      ],
    },
  },
])

assert.deepEqual(handedOff, [
  { content: 'carry active', status: 'in_progress', priority: 'high' },
  { content: 'carry next', status: 'pending', priority: 'low' },
])

const latestToolResultWins = extractLatestTodoSnapshot([
  {
    type: 'custom_message',
    customType: 'todo',
    details: { todos: [{ content: 'carried', status: 'in_progress', priority: 'high' }] },
  },
  {
    type: 'message',
    message: {
      role: 'toolResult',
      toolName: 'todowrite',
      details: { todos: [{ content: 'accepted later', status: 'completed', priority: 'medium' }] },
    },
  },
])

assert.deepEqual(latestToolResultWins, [{ content: 'accepted later', status: 'completed', priority: 'medium' }])

assert.deepEqual(
  getTodoHandoffSnapshot([
    { content: 'done', status: 'completed', priority: 'low' },
    { content: 'first', status: 'pending', priority: 'high' },
    { content: 'second', status: 'pending', priority: 'medium' },
    { content: 'dropped', status: 'cancelled', priority: 'low' },
  ]),
  [
    { content: 'first', status: 'in_progress', priority: 'high' },
    { content: 'second', status: 'pending', priority: 'medium' },
  ],
)

assert.deepEqual(
  getTodoHandoffSnapshot([
    { content: 'active', status: 'in_progress', priority: 'high' },
    { content: 'next', status: 'pending', priority: 'medium' },
  ]),
  [
    { content: 'active', status: 'in_progress', priority: 'high' },
    { content: 'next', status: 'pending', priority: 'medium' },
  ],
)

assert.deepEqual(
  todoDescriptionLines({
    content: 'task',
    status: 'pending',
    priority: 'high',
    description: '  line one \n\n line two  ',
  }),
  ['line one', 'line two'],
)
assert.deepEqual(todoDescriptionLines({ content: 'task', status: 'pending', priority: 'high' }), [])

async function runStore<A, E>(effect: Effect.Effect<A, E, TodoStore>): Promise<A> {
  const runtime = ManagedRuntime.make(TodoStore.layer)
  try {
    return await runtime.runPromise(effect)
  } finally {
    await runtime.dispose()
  }
}

test('schema decoding rejects malformed todo snapshots', () => {
  //given
  const value = [{ content: 'task', status: 'unknown', priority: 'high' }]

  //when
  const result = normalizeTodos(value)

  //then
  assert.equal(result, undefined)
})

test('builds TodoEffects with testing layers', async () => {
  //given
  const updates: Todo[][] = []
  const pi = {} as unknown as ExtensionAPI
  const testLayer = TodoEffectsLayer(pi, { value: 0 }).pipe(
    Layer.provide(
      Layer.succeed(
        TodoUi,
        TodoUi.of({
          update: (todos) => Effect.sync(() => updates.push([...todos])),
          show: () => Effect.void,
        }),
      ),
    ),
    Layer.provide(Layer.succeed(TodoContext, {} as ExtensionContext)),
    Layer.provide(TodoStore.layer),
  )
  const runtime = ManagedRuntime.make(testLayer)

  try {
    //when
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const effects = yield* TodoEffects
        return yield* effects.executeTodo({
          todos: [{ content: 'active', status: 'in_progress', priority: 'high' }],
        })
      }),
    )

    //then
    assert.deepEqual(result.details.todos, [{ content: 'active', status: 'in_progress', priority: 'high' }])
    assert.deepEqual(updates, [[{ content: 'active', status: 'in_progress', priority: 'high' }]])
  } finally {
    await runtime.dispose()
  }
})

test('todo store rejects updates without changing the accepted snapshot', async () => {
  //given
  const previous = normalizeTodos([{ content: 'active', status: 'in_progress', priority: 'high' }])
  assert.ok(previous)

  //when
  const result = await runStore(
    Effect.gen(function* () {
      const store = yield* TodoStore
      yield* store.replace(previous)
      const update = yield* Effect.match(store.replace([]), {
        onFailure: (error) => ({ error }),
        onSuccess: (todos) => ({ todos }),
      })
      return { update, current: yield* store.snapshot }
    }),
  )

  //then
  assert.ok('error' in result.update)
  assert.ok(result.update.error instanceof TodoUpdateError)
  assert.deepEqual(result.current, previous)
})

test('todo store suspends and resumes atomically', async () => {
  //given
  const todos = normalizeTodos([{ content: 'active', status: 'in_progress', priority: 'high' }])
  assert.ok(todos)

  //when
  const result = await runStore(
    Effect.gen(function* () {
      const store = yield* TodoStore
      yield* store.replace(todos)
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
    todos,
  })
  assert.deepEqual(result.secondResume, {
    resumed: false,
    wasActiveBeforeSuspend: false,
    todos,
  })
})

console.log('todo extension check: ok')
