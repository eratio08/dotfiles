import { describe, test } from 'bun:test'
import { strict as assert } from 'node:assert'
import { SimpleFrontmatterCodec } from '../../src/frontmatter/parser.ts'
import {
  deriveSkillMetadata,
  getDuplicateFrontmatterKeys,
  hasDuplicateDisableModelInvocation,
} from '../../src/frontmatter/validation.ts'

const codec = new SimpleFrontmatterCodec()

describe('frontmatter validation', () => {
  test('reports duplicate top-level frontmatter keys', () => {
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
