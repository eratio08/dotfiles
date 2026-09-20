import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const handoffDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const handoffSourceDir = resolve(handoffDir, 'src')
const source = readFileSync(resolve(handoffSourceDir, 'effects.ts'), 'utf8')

const specifiers = [...source.matchAll(/import\((['"])([^'"]+)\1\)/g)].map((match) => match[2])
const todoSpecifier = specifiers.find((specifier) => specifier.includes('todo') && specifier.endsWith('state.ts'))
assert.ok(todoSpecifier, 'handoff/src/effects.ts must dynamically import the todo state module')

const todoState = await import(pathToFileURL(resolve(handoffSourceDir, todoSpecifier)).href)
for (const name of ['extractLatestTodoSnapshot', 'getTodoHandoffSnapshot', 'formatTodoContext']) {
  assert.equal(
    typeof todoState[name],
    'function',
    `todo state module must export ${name}; check the import path in handoff/src/effects.ts`,
  )
}

const branch = [
  {
    type: 'custom',
    customType: 'todo',
    data: {
      todos: [
        { id: '018f00000000-7000-8000-0000-000000000001', content: 'done work', status: 'completed', dependsOn: [] },
        {
          id: '018f00000001-7000-8000-0000-000000000002',
          content: 'active work',
          status: 'in_progress',
          dependsOn: [],
        },
        { id: '018f00000002-7000-8000-0000-000000000003', content: 'later work', status: 'pending', dependsOn: [] },
      ],
    },
  },
]

const handoffTodos = todoState.getTodoHandoffSnapshot(todoState.extractLatestTodoSnapshot(branch))
assert.deepEqual(handoffTodos, [
  { id: '018f00000001-7000-8000-0000-000000000002', content: 'active work', status: 'in_progress', dependsOn: [] },
  { id: '018f00000002-7000-8000-0000-000000000003', content: 'later work', status: 'pending', dependsOn: [] },
])
