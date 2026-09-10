import assert from 'node:assert/strict'
import {
  extractLatestTodoSnapshot,
  formatTodoContext,
  formatTodoReminder,
  getTodoCounts,
  getTodoHandoffSnapshot,
  normalizeTodos,
  summarizeTodos,
  todoDescriptionLines,
  validateTodoUpdate,
} from '../state.ts'

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

console.log('todo extension check: ok')
