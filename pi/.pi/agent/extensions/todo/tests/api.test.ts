import assert from 'node:assert/strict'
import test from 'node:test'
import { Effect } from 'effect'
import type { Todo, TodoTransactionDraft } from '../src/extension.ts'
import { cloneTodos, createTodoApi } from '../src/extension.ts'

type TodoMutation = Parameters<NonNullable<Parameters<typeof createTodoApi>[0]['onMutation']>>[0]

function createDraft(initial: readonly Todo[] = []): { draft: TodoTransactionDraft; snapshot: () => Todo[] } {
  let todos = cloneTodos(initial)
  const draft: TodoTransactionDraft = {
    snapshot: () => cloneTodos(todos),
    replace: (next: readonly Todo[]) => {
      todos = cloneTodos(next)
    },
  }
  return { draft, snapshot: () => cloneTodos(todos) }
}

test('should add tasks with generated IDs and derived statuses given task dependencies', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })

  //when
  const first = await Effect.runPromise(api.add({ content: 'first task', details: 'details' }))
  const second = await Effect.runPromise(api.add({ content: 'second task', dependsOn: [first.id] }))

  //then
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  assert.equal(first.status, 'pending')
  assert.equal(second.status, 'blocked')
  assert.deepEqual(second.dependsOn, [first.id])
})

test('should report successful mutations without counting reads or failures given mixed API calls', async () => {
  //given
  const { draft } = createDraft()
  const mutations: Array<{ operation: string; count: number }> = []
  const api = createTodoApi({
    draft,
    onMutation: (operation: TodoMutation, count: number = 1) => mutations.push({ operation, count }),
  })

  //when
  await (async () => {
    const first = await Effect.runPromise(api.add({ content: 'first task' }))
    const second = await Effect.runPromise(api.add({ content: 'second task' }))
    await Effect.runPromise(api.show())
    await assert.rejects(Effect.runPromise(api.update('018f0000-0000-7000-8000-000000000099', {})))
    await Effect.runPromise(api.update(second.id, { details: 'updated' }))
    await Effect.runPromise(api.next())
    await Effect.runPromise(api.complete())
    await Effect.runPromise(api.next())
    await Effect.runPromise(api.omit(second.id))
    await Effect.runPromise(api.restore(second.id))
    await Effect.runPromise(api.clear())
    assert.ok(first)
  })()

  //then
  assert.deepEqual(mutations, [
    { operation: 'added', count: 1 },
    { operation: 'added', count: 1 },
    { operation: 'updated', count: 1 },
    { operation: 'started', count: 1 },
    { operation: 'completed', count: 1 },
    { operation: 'started', count: 1 },
    { operation: 'omitted', count: 1 },
    { operation: 'restored', count: 1 },
    { operation: 'cleared', count: 2 },
  ])
})

test('should start and complete tasks without starting the next task given explicit transitions', async () => {
  //given
  const { draft, snapshot } = createDraft()
  const api = createTodoApi({ draft })
  const first = await Effect.runPromise(api.add({ content: 'first task' }))
  const second = await Effect.runPromise(api.add({ content: 'second task', dependsOn: [first.id] }))
  const active = await Effect.runPromise(api.next())

  //when
  const completion = await Effect.runPromise(api.complete())

  //then
  assert.equal(active.id, first.id)
  assert.equal(completion.completed.status, 'completed')
  assert.equal(snapshot().find((todo) => todo.id === second.id)?.status, 'pending')
})

test('should return the completed task and remaining counts given task completion', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })
  await Effect.runPromise(api.add({ content: 'active task' }))
  const active = await Effect.runPromise(api.next())
  const pending = await Effect.runPromise(api.add({ content: 'pending task' }))
  await Effect.runPromise(api.add({ content: 'blocked task', dependsOn: [pending.id] }))

  //when
  const result = await Effect.runPromise(api.complete())

  //then
  assert.equal(result.completed.id, active.id)
  assert.equal(result.completed.status, 'completed')
  assert.deepEqual(result.remaining, { pending: 1, inProgress: 0, blocked: 1 })
  assert.equal(result.allDone, false)
})

test('should report allDone given no pending, in-progress, or blocked tasks', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })
  await Effect.runPromise(api.add({ content: 'only task' }))
  await Effect.runPromise(api.next())

  //when
  const result = await Effect.runPromise(api.complete())

  //then
  assert.deepEqual(result.remaining, { pending: 0, inProgress: 0, blocked: 0 })
  assert.equal(result.allDone, true)
})

test('should reject next given an active task', async () => {
  //given
  const { draft, snapshot } = createDraft()
  const mutations: Array<{ operation: string; count: number }> = []
  const api = createTodoApi({
    draft,
    onMutation: (operation: TodoMutation, count: number = 1) => mutations.push({ operation, count }),
  })
  const active = await Effect.runPromise(api.add({ content: 'active task' }))
  await Effect.runPromise(api.add({ content: 'ready task' }))
  mutations.length = 0
  await Effect.runPromise(api.next())

  //when
  const secondAttempt = Effect.runPromise(api.next())

  //then
  await assert.rejects(secondAttempt, /already active/)
  assert.deepEqual(
    snapshot()
      .filter((todo) => todo.status === 'in_progress')
      .map((todo) => todo.id),
    [active.id],
  )
  assert.deepEqual(mutations, [{ operation: 'started', count: 1 }])
})

test('should update details and replace dependencies atomically given a task update', async () => {
  //given
  const { draft, snapshot } = createDraft()
  const api = createTodoApi({ draft })
  const dependency = await Effect.runPromise(api.add({ content: 'dependency' }))
  const task = await Effect.runPromise(api.add({ content: 'task', details: 'old details' }))

  //when
  const updated = await Effect.runPromise(api.update(task.id, { details: 'new details', dependsOn: [dependency.id] }))
  const cleared = await Effect.runPromise(api.update(task.id, { details: null, dependsOn: [] }))

  //then
  assert.equal(updated.details, 'new details')
  assert.equal(updated.status, 'blocked')
  assert.equal(cleared.details, undefined)
  assert.deepEqual(cleared.dependsOn, [])
  assert.equal(snapshot().find((todo) => todo.id === task.id)?.details, undefined)
})

test('should return one selected snapshot and hide details by default given a single selected task', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })
  const first = await Effect.runPromise(api.add({ content: 'first', details: 'first details' }))
  const second = await Effect.runPromise(api.add({ content: 'second', details: 'second details' }))

  //when
  const hidden = await Effect.runPromise(api.show({ ids: [second.id] }))
  const visible = await Effect.runPromise(api.show({ ids: [second.id], includeDetails: true }))

  //then
  assert.deepEqual(
    hidden.map((todo) => todo.id),
    [second.id],
  )
  assert.equal(hidden[0]?.details, undefined)
  assert.equal(visible[0]?.details, 'second details')
  assert.notEqual(hidden[0], visible[0])
  assert.ok(first)
})

test('should return all selected tasks given a status filter', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })
  const first = await Effect.runPromise(api.add({ content: 'first', details: 'first details' }))
  const second = await Effect.runPromise(api.add({ content: 'second', details: 'second details' }))

  //when
  const hidden = await Effect.runPromise(api.show({ status: ['pending'] }))
  const visible = await Effect.runPromise(api.show({ status: ['pending'], includeDetails: true }))
  const limited = await Effect.runPromise(api.show({ status: ['pending'], limit: 1 }))

  //then
  assert.deepEqual(
    hidden.map((todo) => todo.id),
    [first.id, second.id].sort((left, right) => left.localeCompare(right)),
  )
  assert.deepEqual(
    visible.map((todo) => todo.id),
    [first.id, second.id].sort((left, right) => left.localeCompare(right)),
  )
  assert.equal(hidden[0]?.details, undefined)
  assert.equal(visible.find((todo) => todo.id === first.id)?.details, 'first details')
  assert.deepEqual(
    limited.map((todo) => todo.id),
    [first.id, second.id].sort((left, right) => left.localeCompare(right)).slice(0, 1),
  )
})

test('should show pending and in-progress tasks in ID order given no status filter', async () => {
  //given
  const { draft, snapshot } = createDraft()
  const api = createTodoApi({ draft })
  await Effect.runPromise(api.add({ content: 'first' }))
  await Effect.runPromise(api.add({ content: 'second' }))
  await Effect.runPromise(api.add({ content: 'third' }))
  await Effect.runPromise(api.next())
  const completion = await Effect.runPromise(api.complete())
  await Effect.runPromise(api.next())
  const expectedIds = snapshot()
    .filter((todo) => todo.status === 'in_progress' || todo.status === 'pending')
    .map((todo) => todo.id)
    .sort((left, right) => left.localeCompare(right))

  //when
  const shown = await Effect.runPromise(api.show())

  //then
  assert.deepEqual(
    shown.map((todo) => todo.id),
    expectedIds,
  )
  assert.equal(
    shown.some((todo) => todo.id === completion.completed.id),
    false,
  )
  assert.ok(shown.some((todo) => todo.status === 'in_progress'))
  assert.ok(shown.some((todo) => todo.status === 'pending'))
})

test('should filter tasks by any supplied status given a status array', async () => {
  //given
  const { draft, snapshot } = createDraft()
  const api = createTodoApi({ draft })
  await Effect.runPromise(api.add({ content: 'first' }))
  await Effect.runPromise(api.add({ content: 'second' }))
  await Effect.runPromise(api.add({ content: 'third' }))
  await Effect.runPromise(api.next())
  const completion = await Effect.runPromise(api.complete())
  const inProgress = await Effect.runPromise(api.next())
  const pendingIds = snapshot()
    .filter((todo) => todo.status === 'pending')
    .map((todo) => todo.id)
  const expectedIds = [completion.completed.id, ...pendingIds].sort((left, right) => left.localeCompare(right))

  //when
  const selected = await Effect.runPromise(api.show({ status: ['pending', 'completed'] }))

  //then
  assert.deepEqual(
    selected.map((todo) => todo.id),
    expectedIds,
  )
  assert.equal(
    selected.some((todo) => todo.id === inProgress.id),
    false,
  )
})

test('should return no tasks given an empty status array', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })
  await Effect.runPromise(api.add({ content: 'pending' }))

  //when
  const selected = await Effect.runPromise(api.show({ status: [] }))

  //then
  assert.deepEqual(selected, [])
})

test('should limit broad show queries and accept empty or null IDs given a broad query', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })
  const todos = await Promise.all(
    Array.from({ length: 6 }, (_, index) => Effect.runPromise(api.add({ content: `task ${index + 1}` }))),
  )
  const sortedIds = todos.map((todo) => todo.id).sort((left, right) => left.localeCompare(right))

  //when
  const broad = await Effect.runPromise(api.show())
  const status = await Effect.runPromise(api.show({ status: ['pending'] }))
  const emptyIds = await Effect.runPromise(api.show({ ids: [] }))
  const nullIds = await Effect.runPromise(api.show({ ids: null, limit: 1 }))
  const limited = await Effect.runPromise(api.show({ limit: 2 }))

  //then
  assert.deepEqual(
    broad.map((todo) => todo.id),
    sortedIds.slice(0, 5),
  )
  assert.deepEqual(
    status.map((todo) => todo.id),
    sortedIds.slice(0, 5),
  )
  assert.deepEqual(
    emptyIds.map((todo) => todo.id),
    sortedIds.slice(0, 5),
  )
  assert.deepEqual(
    nullIds.map((todo) => todo.id),
    [sortedIds[0]],
  )
  assert.deepEqual(
    limited.map((todo) => todo.id),
    sortedIds.slice(0, 2),
  )
})

test('should return every selected ID and reject mixed selectors given explicit IDs', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })
  const first = await Effect.runPromise(api.add({ content: 'first' }))
  const second = await Effect.runPromise(api.add({ content: 'second' }))

  //when
  const selected = await Effect.runPromise(api.show({ ids: [second.id, first.id], limit: 1 }))
  const emptyIdsWithStatus = await Effect.runPromise(api.show({ ids: [], status: ['pending'] }))
  const nullIdsWithStatus = await Effect.runPromise(api.show({ ids: null, status: ['pending'] }))
  const combined = Effect.runPromise(api.show({ ids: [first.id], status: ['pending'] }))

  //then
  assert.deepEqual(
    selected.map((todo) => todo.id),
    [second.id, first.id].sort((left, right) => left.localeCompare(right)),
  )
  assert.deepEqual(
    emptyIdsWithStatus.map((todo) => todo.id),
    [first.id, second.id].sort((left, right) => left.localeCompare(right)),
  )
  assert.deepEqual(
    nullIdsWithStatus.map((todo) => todo.id),
    [first.id, second.id].sort((left, right) => left.localeCompare(right)),
  )
  await assert.rejects(combined, /either ids or status/)
})

test('should reject invalid show limits and selectors given invalid query options', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })

  //when
  const zeroLimit = Effect.runPromise(api.show({ limit: 0 }))
  const fractionalLimit = Effect.runPromise(api.show({ limit: 1.5 }))
  const invalidId = Effect.runPromise(api.show({ ids: ['not-a-todo-id'] }))
  const invalidStatus = Effect.runPromise(api.show({ status: ['unknown' as 'pending'] }))
  const scalarStatus = Effect.runPromise(api.show({ status: 'pending' } as never))

  //then
  await assert.rejects(zeroLimit, /Invalid todo show options/)
  await assert.rejects(fractionalLimit, /Invalid todo show options/)
  await assert.rejects(invalidId, /Invalid todo show options/)
  await assert.rejects(invalidStatus, /Invalid todo show options/)
  await assert.rejects(scalarStatus, /Invalid todo show options/)
})

test('should omit and restore tasks given dependency-derived state changes', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })
  const task = await Effect.runPromise(api.add({ content: 'task' }))

  //when
  const omitted = await Effect.runPromise(api.omit(task.id))
  const restored = await Effect.runPromise(api.restore(task.id))

  //then
  assert.equal(omitted.status, 'omitted')
  assert.equal(restored.status, 'pending')
})

test('should clear every task and report the number removed given a clear request', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })
  await Effect.runPromise(api.add({ content: 'first' }))
  await Effect.runPromise(api.add({ content: 'second' }))

  //when
  const result = await Effect.runPromise(api.clear())

  //then
  assert.deepEqual(result, { cleared: 2 })
  assert.deepEqual(await Effect.runPromise(api.show()), [])
})

test('should reject invalid dependencies and completed dependency changes given an invalid task update', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })
  const task = await Effect.runPromise(api.add({ content: 'task' }))
  const open = await Effect.runPromise(api.add({ content: 'open' }))
  await Effect.runPromise(api.next())
  await Effect.runPromise(api.complete())

  //when
  const unknownDependency = Effect.runPromise(
    api.add({ content: 'invalid', dependsOn: ['018f0000-0000-7000-8000-000000000001'] }),
  )

  //then
  await assert.rejects(unknownDependency, /unknown dependency ID/)
  await assert.rejects(
    Effect.runPromise(api.update(task.id, { dependsOn: [] })),
    /Cannot change dependencies for completed todo/,
  )
  await assert.rejects(Effect.runPromise(api.update(open.id, { dependsOn: [open.id] })), /cannot depend on itself/)
  await assert.rejects(Effect.runPromise(api.update(open.id, { dependsOn: [task.id, task.id] })), /more than once/)
})

test('should block the active task given an update that adds an incomplete dependency', async () => {
  //given
  const { draft, snapshot } = createDraft()
  const api = createTodoApi({ draft })
  const task = await Effect.runPromise(api.add({ content: 'task' }))
  const dependency = await Effect.runPromise(api.add({ content: 'dependency' }))
  await Effect.runPromise(api.next())

  //when
  const updated = await Effect.runPromise(api.update(task.id, { dependsOn: [dependency.id] }))

  //then
  assert.equal(updated.status, 'blocked')
  assert.equal(
    snapshot().some((todo) => todo.status === 'in_progress'),
    false,
  )
})
