import { describe, test } from 'bun:test'
import { strict as assert } from 'node:assert'
import {
  deriveSkillMetadata,
  getDuplicateFrontmatterKeys,
  hasDuplicateDisableModelInvocation,
  SimpleFrontmatterCodec,
} from '../../src/extension.ts'

const codec = new SimpleFrontmatterCodec()

describe('frontmatter validation', () => {
  test('should parse strings, booleans, and nulls given scalar fields', () => {
    const doc = codec.parse(
      ['---', "name: 'example'", 'description: true', 'disabled: false', 'missing: null', 'alias: ~', '---'].join('\n'),
    )

    assert.deepEqual(doc.fields, {
      name: 'example',
      description: true,
      disabled: false,
      missing: null,
      alias: null,
    })
    assert.equal(deriveSkillMetadata('/skills/example/SKILL.md', doc).description, '')
  })

  test('should report duplicate top-level keys given frontmatter with repeated keys', () => {
    //given
    const doc = codec.parse(
      [
        '---',
        'name: handoff',
        'description: Compact the conversation.',
        'disable-model-invocation: true',
        'argument-hint: What next?',
        'disable-model-invocation: true',
        '---',
        '',
      ].join('\n'),
    )

    //when
    const duplicateKeys = getDuplicateFrontmatterKeys(doc)

    //then
    assert.deepEqual(duplicateKeys, ['disable-model-invocation'])
    assert.equal(hasDuplicateDisableModelInvocation(doc), true)
    assert.deepEqual(deriveSkillMetadata('/skills/handoff/SKILL.md', doc).diagnostics, [
      { severity: 'warning', message: 'Duplicate frontmatter key: disable-model-invocation' },
    ])
  })
})
