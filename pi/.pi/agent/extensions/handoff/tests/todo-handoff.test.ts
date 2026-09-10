import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const handoffDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(resolve(handoffDir, 'index.ts'), 'utf8')

const specifiers = [...source.matchAll(/import\((['"])([^'"]+)\1\)/g)].map((match) => match[2])
const todoSpecifier = specifiers.find((specifier) => specifier.includes('todo') && specifier.endsWith('state.ts'))
assert.ok(todoSpecifier, 'handoff/index.ts must dynamically import the todo state module')

const todoState = await import(pathToFileURL(resolve(handoffDir, todoSpecifier)).href)
for (const name of ['extractLatestTodoSnapshot', 'getTodoHandoffSnapshot', 'formatTodoContext']) {
  assert.equal(
    typeof todoState[name],
    'function',
    `todo state module must export ${name}; check the import path in handoff/index.ts`,
  )
}

const branch = [
  {
    type: 'message',
    message: {
      role: 'toolResult',
      toolName: 'todowrite',
      details: {
        todos: [
          { content: 'done work', status: 'completed', priority: 'high' },
          { content: 'active work', status: 'in_progress', priority: 'medium' },
          { content: 'later work', status: 'pending', priority: 'low' },
        ],
      },
    },
  },
]

const handoffTodos = todoState.getTodoHandoffSnapshot(todoState.extractLatestTodoSnapshot(branch))
assert.deepEqual(handoffTodos, [
  { content: 'active work', status: 'in_progress', priority: 'medium' },
  { content: 'later work', status: 'pending', priority: 'low' },
])

console.log('handoff todo state check: ok')
