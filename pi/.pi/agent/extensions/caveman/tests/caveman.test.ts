import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_MODE,
  getModeInstructions,
  parseCavemanCommand,
  parseModeChange,
  resolveSessionMode,
} from '../src/core.ts'

test('should parse command modes given command input', () => {
  assert.deepEqual(parseCavemanCommand(''), { type: 'set-mode', mode: DEFAULT_MODE })
  assert.deepEqual(parseCavemanCommand('ultra'), { type: 'set-mode', mode: 'ultra' })
  assert.deepEqual(parseCavemanCommand('stop'), { type: 'set-mode', mode: 'off' })
  assert.equal(parseCavemanCommand('bogus').type, 'invalid')
})

test('should parse natural language toggles given toggle requests', () => {
  assert.equal(parseModeChange('talk like caveman'), DEFAULT_MODE)
  assert.equal(parseModeChange('please stop caveman mode'), 'off')
  assert.equal(parseModeChange('/caveman wenyan'), 'wenyan-full')
  assert.equal(parseModeChange('nothing to see here'), null)
})

test('should resolve the last valid saved mode given branch history', () => {
  //given
  const entries = [
    { type: 'custom', customType: 'caveman-mode', data: { mode: 'lite' } },
    { type: 'custom', customType: 'other', data: { mode: 'off' } },
    { type: 'custom', customType: 'caveman-mode', data: { mode: 'ultra' } },
    { type: 'custom', customType: 'caveman-mode', data: { mode: 'invalid' } },
    { type: 'custom', customType: 'caveman-mode', data: 'malformed' },
  ]

  //when
  const mode = resolveSessionMode(entries)

  //then
  assert.equal(mode, 'ultra')
})

test('should use the fallback mode given branch history with no valid entry', () => {
  //given
  const entries = [{ type: 'custom', customType: 'other', data: { mode: 'off' } }]

  //when
  const mode = resolveSessionMode(entries, 'lite')

  //then
  assert.equal(mode, 'lite')
})

test('should include the active level in instructions given a mode setting', () => {
  const text = getModeInstructions('full')
  assert.match(text, /CAVEMAN MODE ACTIVE — level: full/)
  assert.match(text, /Drop articles/)
})
