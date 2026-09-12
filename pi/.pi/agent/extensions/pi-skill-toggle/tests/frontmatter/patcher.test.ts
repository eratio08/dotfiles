import { describe, test } from 'bun:test'
import { strict as assert } from 'node:assert'
import { SimpleFrontmatterCodec } from '../../src/frontmatter/parser.ts'
import { MinimalFrontmatterPatcher } from '../../src/frontmatter/patcher.ts'
import { getDuplicateFrontmatterKeys } from '../../src/frontmatter/validation.ts'

const codec = new SimpleFrontmatterCodec()
const patcher = new MinimalFrontmatterPatcher()

describe('MinimalFrontmatterPatcher', () => {
  test('does not add a second disable-model-invocation key when a skill is already manual-only', () => {
    //given
    const raw = [
      '---',
      'name: handoff',
      'description: Compact the conversation.',
      'disable-model-invocation: true',
      'argument-hint: What next?',
      '---',
      '',
      '# Handoff',
      '',
    ].join('\n')

    //when
    const patch = patcher.patchInvocationMode(codec.parse(raw), 'manual-only')

    //then
    assert.equal(patch.newText, raw)
    assert.equal(countDisableKeys(patch.newText), 1)
  })

  test('collapses duplicated disable-model-invocation keys when setting manual-only', () => {
    //given
    const raw = [
      '---',
      'name: handoff',
      'description: Compact the conversation.',
      'disable-model-invocation: true',
      'argument-hint: What next?',
      'disable-model-invocation: true',
      '---',
      '',
      '# Handoff',
      '',
    ].join('\n')

    //when
    const patch = patcher.patchInvocationMode(codec.parse(raw), 'manual-only')

    //then
    assert.equal(countDisableKeys(patch.newText), 1)
    assert.deepEqual(getDuplicateFrontmatterKeys(codec.parse(patch.newText)), [])
    assert.ok(patch.newText.includes('disable-model-invocation: true\nargument-hint: What next?\n---'))
  })

  test('removes all disable-model-invocation keys when setting agent-invocable', () => {
    //given
    const raw = [
      '---',
      'name: handoff',
      'description: Compact the conversation.',
      'disable-model-invocation: true',
      'argument-hint: What next?',
      'disable-model-invocation: true',
      '---',
      '',
      '# Handoff',
      '',
    ].join('\n')

    //when
    const patch = patcher.patchInvocationMode(codec.parse(raw), 'agent-invocable')

    //then
    assert.equal(countDisableKeys(patch.newText), 0)
    assert.deepEqual(getDuplicateFrontmatterKeys(codec.parse(patch.newText)), [])
    assert.ok(patch.newText.includes('argument-hint: What next?\n---'))
  })
})

function countDisableKeys(raw: string): number {
  return (raw.match(/^disable-model-invocation\s*:/gm) ?? []).length
}
