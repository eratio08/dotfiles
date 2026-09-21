import assert from 'node:assert/strict'
import test from 'node:test'
import { createTodoApi } from '../src/api.ts'
import type { Todo } from '../src/model.ts'
import { cloneTodos } from '../src/state-engine.ts'
import type { TodoTransactionDraft } from '../src/store.ts'

function createDraft(initial: readonly Todo[] = []): { draft: TodoTransactionDraft; snapshot: () => Todo[] } {
  let todos = cloneTodos(initial)
  const draft: TodoTransactionDraft = {
    snapshot: () => cloneTodos(todos),
    replace: (next) => {
      todos = cloneTodos(next)
    },
  }
  return { draft, snapshot: () => cloneTodos(todos) }
}

test('adds tasks with generated IDs and dependency-derived statuses', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })

  //when
  const first = await api.add({ content: 'first task', details: 'details' })
  const second = await api.add({ content: 'second task', dependsOn: [first.id] })

  //then
  assert.match(first.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  assert.equal(first.status, 'pending')
  assert.equal(second.status, 'blocked')
  assert.deepEqual(second.dependsOn, [first.id])
})

test('reports successful mutations without counting reads or failures', async () => {
  //given
  const { draft } = createDraft()
  const mutations: Array<{ operation: string; count: number }> = []
  const api = createTodoApi({
    draft,
    onMutation: (operation, count = 1) => mutations.push({ operation, count }),
  })

  //when
  await (async () => {
    const first = await api.add({ content: 'first task' })
    const second = await api.add({ content: 'second task' })
    await api.show()
    await assert.rejects(api.update('018f0000-0000-7000-8000-000000000099', {}))
    await api.update(second.id, { details: 'updated' })
    await api.next()
    await api.complete()
    await api.next()
    await api.omit(second.id)
    await api.restore(second.id)
    await api.clear()
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

test('starts and completes tasks without automatically starting the next task', async () => {
  //given
  const { draft, snapshot } = createDraft()
  const api = createTodoApi({ draft })
  const first = await api.add({ content: 'first task' })
  const second = await api.add({ content: 'second task', dependsOn: [first.id] })

  //when
  const active = await api.next()
  const completed = await api.complete()

  //then
  assert.equal(active.id, first.id)
  assert.equal(completed.status, 'completed')
  assert.equal(snapshot().find((todo) => todo.id === second.id)?.status, 'pending')
})

test('rejects next when a task is already active', async () => {
  //given
  const { draft, snapshot } = createDraft()
  const mutations: Array<{ operation: string; count: number }> = []
  const api = createTodoApi({
    draft,
    onMutation: (operation, count = 1) => mutations.push({ operation, count }),
  })
  const active = await api.add({ content: 'active task' })
  await api.add({ content: 'ready task' })
  mutations.length = 0
  await api.next()

  //when
  const secondAttempt = api.next()

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

test('updates details and replaces dependencies atomically', async () => {
  //given
  const { draft, snapshot } = createDraft()
  const api = createTodoApi({ draft })
  const dependency = await api.add({ content: 'dependency' })
  const task = await api.add({ content: 'task', details: 'old details' })

  //when
  const updated = await api.update(task.id, { details: 'new details', dependsOn: [dependency.id] })
  const cleared = await api.update(task.id, { details: null, dependsOn: [] })

  //then
  assert.equal(updated.details, 'new details')
  assert.equal(updated.status, 'blocked')
  assert.equal(cleared.details, undefined)
  assert.deepEqual(cleared.dependsOn, [])
  assert.equal(snapshot().find((todo) => todo.id === task.id)?.details, undefined)
})

test('returns selected snapshots and hides details by default', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })
  const first = await api.add({ content: 'first', details: 'first details' })
  const second = await api.add({ content: 'second', details: 'second details' })

  //when
  const hidden = await api.show({ ids: [second.id, first.id] })
  const visible = await api.show({ ids: [second.id, first.id], includeDetails: true })

  //then
  assert.deepEqual(
    hidden.map((todo) => todo.id),
    [second.id, first.id],
  )
  assert.equal(hidden[0]?.details, undefined)
  assert.equal(visible[0]?.details, 'second details')
})

test('omits and restores tasks through dependency-derived state', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })
  const task = await api.add({ content: 'task' })

  //when
  const omitted = await api.omit(task.id)
  const restored = await api.restore(task.id)

  //then
  assert.equal(omitted.status, 'omitted')
  assert.equal(restored.status, 'pending')
})

test('clears every task and reports the number removed', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })
  await api.add({ content: 'first' })
  await api.add({ content: 'second' })

  //when
  const result = await api.clear()

  //then
  assert.deepEqual(result, { cleared: 2 })
  assert.deepEqual(await api.show(), [])
})

test('rejects invalid dependencies and completed dependency changes', async () => {
  //given
  const { draft } = createDraft()
  const api = createTodoApi({ draft })
  const task = await api.add({ content: 'task' })
  const open = await api.add({ content: 'open' })
  await api.next()
  await api.complete()

  //when
  const unknownDependency = api.add({ content: 'invalid', dependsOn: ['018f0000-0000-7000-8000-000000000001'] })

  //then
  await assert.rejects(unknownDependency, /unknown dependency ID/)
  await assert.rejects(api.update(task.id, { dependsOn: [] }), /Cannot change dependencies for completed todo/)
  await assert.rejects(api.update(open.id, { dependsOn: [open.id] }), /cannot depend on itself/)
  await assert.rejects(api.update(open.id, { dependsOn: [task.id, task.id] }), /more than once/)
})

test('blocks the active task when an update adds an incomplete dependency', async () => {
  //given
  const { draft, snapshot } = createDraft()
  const api = createTodoApi({ draft })
  const task = await api.add({ content: 'task' })
  const dependency = await api.add({ content: 'dependency' })
  await api.next()

  //when
  const updated = await api.update(task.id, { dependsOn: [dependency.id] })

  //then
  assert.equal(updated.status, 'blocked')
  assert.equal(
    snapshot().some((todo) => todo.status === 'in_progress'),
    false,
  )
})
