import assert from 'node:assert/strict'
import test from 'node:test'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { parseSavedSession, selectCurrentSession } from '../src/session.ts'

const sessionJsonl = [
  '{"type":"session","version":3,"id":"session-1","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/project"}',
  '{"type":"message","id":"00000001","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":"root","timestamp":1767225601000}}',
  '{"type":"message","id":"00000002","parentId":"00000001","timestamp":"2026-01-01T00:00:02.000Z","message":{"role":"user","content":"left","timestamp":1767225602000}}',
  '{"type":"message","id":"00000003","parentId":"00000001","timestamp":"2026-01-01T00:00:03.000Z","message":{"role":"user","content":"right","timestamp":1767225603000}}',
].join('\n')

test('should select the current session projection given an existing alternate branch', () => {
  //given
  const manager = SessionManager.inMemory('/project')
  const rootId = manager.appendMessage({ role: 'user', content: 'root', timestamp: 1 })
  manager.appendMessage({ role: 'user', content: 'left', timestamp: 2 })
  manager.branch(rootId)
  manager.appendMessage({ role: 'user', content: 'right', timestamp: 3 })

  //when
  const session = selectCurrentSession(manager)

  //then
  assert.equal(session.branch, undefined)
  assert.deepEqual(
    session.projection.messages.map((message) => (message.role === 'user' ? message.content : null)),
    ['root', 'right'],
  )
  assert.equal(session.source, 'current')
})

test('should select the last entry branch given no explicit leaf', () => {
  //given
  const content = sessionJsonl

  //when
  const session = parseSavedSession(content)

  //then
  const branch = session.branch
  assert.ok(branch)
  assert.deepEqual(
    branch.map((entry) => entry.id),
    ['00000001', '00000003'],
  )
  assert.deepEqual(
    session.projection.messages.map((message) => (message.role === 'user' ? message.content : null)),
    ['root', 'right'],
  )
})

test('should select the requested branch given an explicit leaf ID', () => {
  //given
  const content = sessionJsonl

  //when
  const session = parseSavedSession(content, '00000002')

  //then
  const branch = session.branch
  assert.ok(branch)
  assert.deepEqual(
    branch.map((entry) => entry.id),
    ['00000001', '00000002'],
  )
  assert.deepEqual(
    session.projection.messages.map((message) => (message.role === 'user' ? message.content : null)),
    ['root', 'left'],
  )
})

test('should reject malformed JSON given a damaged session file', () => {
  //given
  const content = `${sessionJsonl}\n{malformed}`
  let error: unknown

  //when
  try {
    parseSavedSession(content)
  } catch (cause) {
    error = cause
  }

  //then
  assert.match(error instanceof Error ? error.message : '', /malformed JSON on line 5/)
})

test('should reject a missing leaf given an unknown entry ID', () => {
  //given
  const content = sessionJsonl
  let error: unknown

  //when
  try {
    parseSavedSession(content, 'missing-id')
  } catch (cause) {
    error = cause
  }

  //then
  assert.match(error instanceof Error ? error.message : '', /leaf missing-id was not found/)
})

test('should apply a context edit only to the projection given an edited message', () => {
  //given
  const content = [
    '{"type":"session","version":3,"id":"session-2","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/project"}',
    '{"type":"message","id":"00000011","parentId":null,"timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":"original","timestamp":1767225601000}}',
    '{"type":"context_edit","id":"00000012","parentId":"00000011","timestamp":"2026-01-01T00:00:02.000Z","targetId":"00000011","replacement":{"content":"replacement"}}',
  ].join('\n')

  //when
  const session = parseSavedSession(content)

  //then
  const branch = session.branch
  assert.ok(branch)
  const original = branch[0]
  const projected = session.projection.messages[0]
  assert.equal(
    original?.type === 'message' && original.message.role === 'user' ? original.message.content : null,
    'original',
  )
  assert.equal(projected?.role === 'user' ? projected.content : null, 'replacement')
})

test('should reject a parent cycle given saved entries that form a cycle', () => {
  const content = [
    '{"type":"session","version":3,"id":"session-cycle","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/project"}',
    '{"type":"message","id":"00000021","parentId":"00000022","timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":"first","timestamp":1767225601000}}',
    '{"type":"message","id":"00000022","parentId":"00000021","timestamp":"2026-01-01T00:00:02.000Z","message":{"role":"user","content":"second","timestamp":1767225602000}}',
  ].join('\n')
  let error: unknown

  try {
    parseSavedSession(content)
  } catch (cause) {
    error = cause
  }

  assert.match(error instanceof Error ? error.message : '', /parent cycle at entry 00000022/)
})

test('should reject a broken parent chain given a selected orphan', () => {
  //given
  const content = [
    '{"type":"session","version":3,"id":"session-3","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/project"}',
    '{"type":"message","id":"00000021","parentId":"missing-parent","timestamp":"2026-01-01T00:00:01.000Z","message":{"role":"user","content":"orphan","timestamp":1767225601000}}',
  ].join('\n')
  let error: unknown

  //when
  try {
    parseSavedSession(content)
  } catch (cause) {
    error = cause
  }

  //then
  assert.match(error instanceof Error ? error.message : '', /missing parent missing-parent/)
})
