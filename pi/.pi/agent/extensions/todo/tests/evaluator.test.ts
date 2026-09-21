import assert from 'node:assert/strict'
import test from 'node:test'
import { Effect } from 'effect'
import type { TodoApi } from '../src/api.ts'
import { evaluateTodoCode, formatTodoCodeOutput } from '../src/evaluator.ts'

const api: TodoApi = {
  add: async (input) => ({
    id: '018f0000-0000-7000-8000-000000000001',
    content: input.content,
    status: 'pending',
    dependsOn: [],
  }),
  update: async (id) => ({ id, content: 'updated', status: 'pending', dependsOn: [] }),
  show: async () => [],
  next: async () => ({
    id: '018f0000-0000-7000-8000-000000000001',
    content: 'next',
    status: 'in_progress',
    dependsOn: [],
  }),
  complete: async () => ({
    id: '018f0000-0000-7000-8000-000000000001',
    content: 'done',
    status: 'completed',
    dependsOn: [],
  }),
  omit: async (id) => ({ id, content: 'omitted', status: 'omitted', dependsOn: [] }),
  restore: async (id) => ({ id, content: 'restored', status: 'pending', dependsOn: [] }),
  clear: async () => ({ cleared: 0 }),
}

test('evaluates TypeScript against the injected TodoApi declarations', async () => {
  //given
  const code = `
export default async (todo: TodoApi) => {
  const task = await todo.add({ content: 'created' })
  return { id: task.id, process: typeof process, globalThis: typeof globalThis }
}
`

  //when
  const value = await Effect.runPromise(evaluateTodoCode(code, api, '/tmp'))

  //then
  assert.deepEqual(JSON.parse(JSON.stringify(value)), {
    id: '018f0000-0000-7000-8000-000000000001',
    process: 'undefined',
    globalThis: 'undefined',
  })
})

test('rejects code without a default function', async () => {
  //given
  const code = 'export const value = 1'

  //when
  const execution = Effect.runPromise(evaluateTodoCode(code, api, '/tmp'))

  //then
  await assert.rejects(execution, /default function/)
})

test('propagates a program error without committing anything itself', async () => {
  //given
  const code = "export default async () => { throw new Error('program failed') }"

  //when
  const execution = Effect.runPromise(evaluateTodoCode(code, api, '/tmp'))

  //then
  await assert.rejects(execution, /program failed/)
})

test('does not expose imports or host capabilities', async () => {
  //given
  const code = `
export default async () => ({
  require: typeof require,
  fetch: typeof fetch,
  setTimeout: typeof setTimeout,
  setInterval: typeof setInterval,
  global: typeof global,
  Bun: typeof Bun,
  Deno: typeof Deno,
})
`

  //when
  const value = await Effect.runPromise(evaluateTodoCode(code, api, '/tmp'))

  //then
  assert.deepEqual(JSON.parse(JSON.stringify(value)), {
    require: 'undefined',
    fetch: 'undefined',
    setTimeout: 'undefined',
    setInterval: 'undefined',
    global: 'undefined',
    Bun: 'undefined',
    Deno: 'undefined',
  })
  await assert.rejects(
    Effect.runPromise(evaluateTodoCode('import fs from "node:fs"\nexport default () => fs', api, '/tmp')),
  )
})

test('stops a pending program on timeout and abort', async () => {
  //given
  const controller = new AbortController()
  const pending = Effect.runPromise(
    evaluateTodoCode('export default async () => await new Promise(() => {})', api, '/tmp', undefined, 1),
  )
  const aborted = Effect.runPromise(
    evaluateTodoCode('export default async () => await new Promise(() => {})', api, '/tmp', controller.signal),
  )
  const pendingResult = assert.rejects(pending, /timed out after 1ms/)
  const abortedResult = assert.rejects(aborted, /aborted/)

  //when
  controller.abort()

  //then
  await pendingResult
  await abortedResult
})

test('formats and truncates large output', () => {
  //given
  const value = Array.from({ length: 2100 }, (_, index) => `${index}`).join('\n')

  //when
  const result = formatTodoCodeOutput(value)

  //then
  assert.equal(result.truncated, true)
  assert.match(result.output, /Output truncated/)
})
