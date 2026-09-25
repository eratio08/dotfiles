import assert from 'node:assert/strict'
import test from 'node:test'
import type { Todo, TodoStatus } from '../src/model.ts'
import { getActiveTodo, getNextTodo, reevaluateTodoStates, validateTodoGraph } from '../src/state-engine.ts'

const firstId = '018f0000-0000-7000-8000-000000000001'
const secondId = '018f0000-0001-7000-8000-000000000002'
const thirdId = '018f0000-0002-7000-8000-000000000003'

function todo(id: string, content: string, status: TodoStatus = 'pending', dependsOn: string[] = []): Todo {
  return { id, content, status, dependsOn }
}

test('should validate dependency references and cycles given a dependency graph', () => {
  //given
  const first = todo(firstId, 'first', 'pending', [secondId])
  const second = todo(secondId, 'second', 'pending', [firstId])

  //when
  const error = validateTodoGraph([first, second])

  //then
  assert.match(error ?? '', /cycle/)
})

test('should reject unknown, duplicate, and self dependencies given invalid references', () => {
  //given
  const unknown = todo(firstId, 'unknown', 'pending', [secondId])
  const duplicate = todo(firstId, 'duplicate', 'pending', [secondId, secondId])
  const target = todo(secondId, 'target')
  const self = todo(firstId, 'self', 'pending', [firstId])

  //when
  const errors = [validateTodoGraph([unknown]), validateTodoGraph([duplicate, target]), validateTodoGraph([self])]

  //then
  assert.match(errors[0] ?? '', /unknown task/)
  assert.match(errors[1] ?? '', /more than once/)
  assert.match(errors[2] ?? '', /cannot depend on itself/)
})

test('should reevaluate dependency-derived states using completed tasks only given task state changes', () => {
  //given
  const completed = todo(firstId, 'completed', 'completed')
  const ready = todo(secondId, 'ready', 'blocked', [firstId])
  const blocked = todo(thirdId, 'blocked', 'pending', [secondId])

  //when
  const next = reevaluateTodoStates([completed, ready, blocked])

  //then
  assert.deepEqual(
    next.map((item) => item.status),
    ['completed', 'pending', 'blocked'],
  )
})

test('should not treat omitted dependencies as completed given an omitted prerequisite', () => {
  //given
  const omitted = todo(firstId, 'omitted', 'omitted')
  const dependent = todo(secondId, 'dependent', 'pending', [firstId])

  //when
  const next = reevaluateTodoStates([omitted, dependent])

  //then
  assert.equal(next[1]?.status, 'blocked')
})

test('should remove an active task given an incomplete dependency', () => {
  //given
  const dependency = todo(firstId, 'dependency', 'pending')
  const active = todo(secondId, 'active', 'in_progress', [firstId])

  //when
  const next = reevaluateTodoStates([dependency, active])

  //then
  assert.equal(next[1]?.status, 'blocked')
  assert.equal(getActiveTodo(next), undefined)
})

test('should return the active task before the first ready task given a mixed task list', () => {
  //given
  const ready = todo(firstId, 'ready')
  const active = todo(secondId, 'active', 'in_progress')

  //when
  const next = getNextTodo([ready, active])

  //then
  assert.equal(next?.id, secondId)
})
