import assert from 'node:assert/strict'
import test from 'node:test'
import { PiToolError } from '@eratio/pi-effect'
import { createFakeExtensionContext, installFakePlugin } from '@eratio/pi-effect/testing'
import todoExtension from '../index.ts'
import type { Todo, TodoCompleteResult } from '../src/extension.ts'
import { TODO_ID_PATTERN, TODO_STATE_ENTRY, TodoUiError } from '../src/extension.ts'

test('should register Todo tools with object update parameters in the codemode namespace given an installed extension', async () => {
  //given
  const fake = await installFakePlugin(todoExtension)

  //when
  const tools = [
    'todo_show',
    'todo_add',
    'todo_update',
    'todo_next',
    'todo_complete',
    'todo_omit',
    'todo_restore',
    'todo_clear',
  ]

  //then
  for (const name of tools) {
    const tool = fake.tools.get(name)
    assert.ok(tool)
    assert.equal(tool.exposure, 'codemode')
    assert.deepEqual(tool.namespace, {
      name: 'todo',
      description: 'Tools for inspecting and updating the current todo plan.',
    })
  }

  const updateTool = fake.tools.get('todo_update')
  assert.ok(updateTool)
  assert.equal(Reflect.get(updateTool.parameters, 'type'), 'object')
})

test('should return sorted matching todos with details given a filtered todo_show request', async () => {
  //given
  const fake = await installFakePlugin(todoExtension)
  const fakeContext = createFakeExtensionContext()
  const firstId = '018f0000-0000-7000-8000-000000000001'
  const secondId = '018f0000-0000-7000-8000-000000000002'
  const completedId = '018f0000-0000-7000-8000-000000000003'
  const expected = {
    id: firstId,
    content: 'first task',
    details: 'first details',
    status: 'pending',
    dependsOn: [],
  }
  const context = {
    ...fakeContext,
    sessionManager: {
      ...fakeContext.sessionManager,
      getBranch: () => [
        {
          type: 'custom',
          id: 'todo-entry',
          parentId: null,
          timestamp: '2025-01-01T00:00:00.000Z',
          customType: 'todo',
          data: {
            todos: [
              {
                id: secondId,
                content: 'second task',
                details: 'second details',
                status: 'pending',
                dependsOn: [],
              },
              {
                id: completedId,
                content: 'completed task',
                details: 'completed details',
                status: 'completed',
                dependsOn: [],
              },
              expected,
            ],
          },
        },
      ],
    },
  }
  await fake.invokeEvent('session_start', { type: 'session_start' }, context as never)

  //when
  const result = await fake.invokeTool('todo_show', 'show-call', {
    status: ['pending'],
    limit: 1,
    includeDetails: true,
  })

  //then
  const toolResult = result as {
    content: readonly { type: string; text: string }[]
    details: { count: number }
    structuredContent: unknown
  }
  assert.deepEqual(toolResult.details, { count: 1 })
  assert.deepEqual(toolResult.structuredContent, [expected])
  assert.deepEqual(JSON.parse(toolResult.content[0]?.text ?? 'null'), [expected])
})

test('should add and update todos through the native tools given valid inputs', async () => {
  const fake = await installFakePlugin(todoExtension)
  const persistedEntries: Array<{ customType: string; data: unknown }> = []
  const extensionApi = fake.api as unknown as {
    appendEntry: (customType: string, data?: unknown) => void
  }
  extensionApi.appendEntry = (customType: string, data?: unknown): void => {
    persistedEntries.push({ customType, data })
  }
  await fake.invokeEvent('session_start', { type: 'session_start' })

  const addedResult = (await fake.invokeTool('todo_add', 'add-call', {
    content: '  first task  ',
    details: 'first details',
  })) as {
    content: readonly { type: string; text: string }[]
    details: { id: string }
    structuredContent: Todo
  }
  const addedTodo = addedResult.structuredContent

  assert.match(addedTodo.id, TODO_ID_PATTERN)
  assert.deepEqual(addedTodo, {
    id: addedTodo.id,
    content: 'first task',
    details: 'first details',
    status: 'pending',
    dependsOn: [],
  })
  assert.deepEqual(addedResult.details, { id: addedTodo.id })
  assert.deepEqual(JSON.parse(addedResult.content[0]?.text ?? 'null'), addedTodo)

  const updatedResult = (await fake.invokeTool('todo_update', 'update-call', {
    id: addedTodo.id,
    patch: {
      content: '  updated task  ',
      details: 'updated details',
    },
  })) as {
    content: readonly { type: string; text: string }[]
    details: { id: string }
    structuredContent: Todo
  }
  const updatedTodo = updatedResult.structuredContent

  assert.deepEqual(updatedTodo, {
    ...addedTodo,
    content: 'updated task',
    details: 'updated details',
  })
  assert.deepEqual(updatedResult.details, { id: addedTodo.id })
  assert.deepEqual(JSON.parse(updatedResult.content[0]?.text ?? 'null'), updatedTodo)
  assert.deepEqual(
    persistedEntries.map(({ customType }) => customType),
    [TODO_STATE_ENTRY, TODO_STATE_ENTRY],
  )
  const secondEntry = persistedEntries[1]
  assert.ok(secondEntry)
  assert.deepEqual((secondEntry.data as { todos: Todo[] }).todos, [updatedTodo])
})

test('should reject invalid dependency updates without committing given an unknown dependency', async () => {
  const fake = await installFakePlugin(todoExtension)
  const persistedEntries: Array<{ customType: string; data: unknown }> = []
  const extensionApi = fake.api as unknown as {
    appendEntry: (customType: string, data?: unknown) => void
  }
  extensionApi.appendEntry = (customType: string, data?: unknown): void => {
    persistedEntries.push({ customType, data })
  }
  await fake.invokeEvent('session_start', { type: 'session_start' })

  const addResult = (await fake.invokeTool('todo_add', 'add-call', { content: 'first task' })) as {
    structuredContent: Todo
  }
  const addedTodo = addResult.structuredContent
  const unknownDependency = '018f0000-0000-7000-8000-000000000099'

  await assert.rejects(
    fake.invokeTool('todo_update', 'invalid-update-call', {
      id: addedTodo.id,
      patch: { dependsOn: [unknownDependency] },
    }),
    (error: unknown) => {
      const failure = error instanceof PiToolError ? error.cause : error
      assert.ok(failure instanceof TodoUiError)
      assert.equal(failure.operation, 'update')
      return true
    },
  )
  assert.equal(persistedEntries.length, 1)

  const showResult = (await fake.invokeTool('todo_show', 'show-call', {
    ids: [addedTodo.id],
    includeDetails: true,
  })) as { structuredContent: Todo[] }
  assert.deepEqual(showResult.structuredContent, [addedTodo])
  assert.equal(persistedEntries.length, 1)
})

test('should start and complete ready todos through native tools given pending work', async () => {
  const fake = await installFakePlugin(todoExtension)
  const persistedEntries: Array<{ customType: string; data: unknown }> = []
  const extensionApi = fake.api as unknown as {
    appendEntry: (customType: string, data?: unknown) => void
  }
  extensionApi.appendEntry = (customType: string, data?: unknown): void => {
    persistedEntries.push({ customType, data })
  }
  await fake.invokeEvent('session_start', { type: 'session_start' })

  const firstAdded = (await fake.invokeTool('todo_add', 'add-first-call', { content: 'first ready task' })) as {
    structuredContent: Todo
  }
  const secondAdded = (await fake.invokeTool('todo_add', 'add-second-call', { content: 'second ready task' })) as {
    structuredContent: Todo
  }
  const startedResult = (await fake.invokeTool('todo_next', 'start-call', {})) as {
    details: { id: string }
    structuredContent: Todo
  }
  const started = startedResult.structuredContent

  assert.equal(started.status, 'in_progress')
  assert.ok([firstAdded.structuredContent.id, secondAdded.structuredContent.id].includes(started.id))
  assert.deepEqual(startedResult.details, { id: started.id })
  assert.equal(persistedEntries.length, 3)

  await assert.rejects(fake.invokeTool('todo_next', 'active-next-call', {}), (error: unknown) => {
    const failure = error instanceof PiToolError ? error.cause : error
    assert.ok(failure instanceof TodoUiError)
    assert.equal(failure.operation, 'next')
    assert.match(failure.message, /already active/)
    return true
  })
  assert.equal(persistedEntries.length, 3)

  const firstCompletion = (await fake.invokeTool('todo_complete', 'complete-first-call', {})) as {
    details: { id: string }
    structuredContent: TodoCompleteResult
  }
  assert.deepEqual(firstCompletion.structuredContent, {
    completed: { ...started, status: 'completed' },
    remaining: { pending: 1, inProgress: 0, blocked: 0 },
    allDone: false,
  })
  assert.deepEqual(firstCompletion.details, { id: started.id })

  const nextStarted = (await fake.invokeTool('todo_next', 'start-second-call', {})) as {
    structuredContent: Todo
  }
  assert.equal(nextStarted.structuredContent.status, 'in_progress')
  assert.notEqual(nextStarted.structuredContent.id, started.id)

  const secondCompletion = (await fake.invokeTool('todo_complete', 'complete-second-call', {})) as {
    structuredContent: TodoCompleteResult
  }
  assert.deepEqual(secondCompletion.structuredContent, {
    completed: { ...nextStarted.structuredContent, status: 'completed' },
    remaining: { pending: 0, inProgress: 0, blocked: 0 },
    allDone: true,
  })

  await assert.rejects(fake.invokeTool('todo_next', 'no-ready-call', {}), (error: unknown) => {
    const failure = error instanceof PiToolError ? error.cause : error
    assert.ok(failure instanceof TodoUiError)
    assert.equal(failure.operation, 'next')
    assert.equal(failure.message, 'No todo is ready.')
    return true
  })
  assert.equal(persistedEntries.length, 6)
  assert.deepEqual(
    persistedEntries.map(({ customType }) => customType),
    Array(6).fill(TODO_STATE_ENTRY),
  )
  assert.deepEqual(
    persistedEntries.map(
      ({ data }) => (data as { todos: Todo[] }).todos.filter((todo) => todo.status === 'completed').length,
    ),
    [0, 0, 0, 1, 1, 2],
  )
})

test('should omit, restore, and clear todos through native tools with dependencies', async () => {
  const fake = await installFakePlugin(todoExtension)
  const persistedEntries: Array<{ customType: string; data: unknown }> = []
  const extensionApi = fake.api as unknown as {
    appendEntry: (customType: string, data?: unknown) => void
  }
  extensionApi.appendEntry = (customType: string, data?: unknown): void => {
    persistedEntries.push({ customType, data })
  }
  await fake.invokeEvent('session_start', { type: 'session_start' })

  const rootResult = (await fake.invokeTool('todo_add', 'add-root-call', { content: 'root task' })) as {
    structuredContent: Todo
  }
  const root = rootResult.structuredContent
  const dependentResult = (await fake.invokeTool('todo_add', 'add-dependent-call', {
    content: 'dependent task',
    dependsOn: [root.id],
  })) as { structuredContent: Todo }
  const dependent = dependentResult.structuredContent
  assert.equal(dependent.status, 'blocked')

  const omittedRoot = (await fake.invokeTool('todo_omit', 'omit-root-call', root.id)) as {
    structuredContent: Todo
  }
  assert.equal(omittedRoot.structuredContent.status, 'omitted')

  const restoredRoot = (await fake.invokeTool('todo_restore', 'restore-root-call', root.id)) as {
    structuredContent: Todo
  }
  assert.equal(restoredRoot.structuredContent.status, 'pending')

  const omittedDependent = (await fake.invokeTool('todo_omit', 'omit-dependent-call', dependent.id)) as {
    structuredContent: Todo
  }
  assert.equal(omittedDependent.structuredContent.status, 'omitted')

  const restoredDependent = (await fake.invokeTool('todo_restore', 'restore-dependent-call', dependent.id)) as {
    structuredContent: Todo
  }
  assert.equal(restoredDependent.structuredContent.status, 'blocked')

  const cleared = (await fake.invokeTool('todo_clear', 'clear-call', {})) as {
    content: readonly { type: string; text: string }[]
    details: { cleared: number }
    structuredContent: { cleared: number }
  }
  assert.deepEqual(cleared.structuredContent, { cleared: 2 })
  assert.deepEqual(cleared.details, { cleared: 2 })
  assert.deepEqual(JSON.parse(cleared.content[0]?.text ?? 'null'), { cleared: 2 })

  assert.equal(persistedEntries.length, 7)
  assert.deepEqual(
    persistedEntries.map(({ customType }) => customType),
    Array(7).fill(TODO_STATE_ENTRY),
  )
  assert.deepEqual(
    persistedEntries.map(({ data }) => {
      const todos = (data as { todos: Todo[] }).todos
      return [
        todos.find((todo) => todo.id === root.id)?.status ?? null,
        todos.find((todo) => todo.id === dependent.id)?.status ?? null,
      ]
    }),
    [
      ['pending', null],
      ['pending', 'blocked'],
      ['omitted', 'blocked'],
      ['pending', 'blocked'],
      ['pending', 'omitted'],
      ['pending', 'blocked'],
      [null, null],
    ],
  )

  const showResult = (await fake.invokeTool('todo_show', 'show-after-clear-call', {})) as {
    structuredContent: Todo[]
  }
  assert.deepEqual(showResult.structuredContent, [])
  assert.equal(persistedEntries.length, 7)
})
