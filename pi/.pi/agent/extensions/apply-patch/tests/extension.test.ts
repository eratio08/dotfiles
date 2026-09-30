import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { initTheme } from '@earendil-works/pi-coding-agent'
import { PiToolError } from '@eratio/pi-effect'
import { createFakeExtensionContext, installFakePlugin } from '@eratio/pi-effect/testing'
import applyPatchExtension from '../index.ts'

async function withTemporaryProject(run: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-apply-patch-effect-'))
  try {
    await run(cwd)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}

test('should preserve tool metadata and result details given an Effect adapter call', async () => {
  //given
  await withTemporaryProject(async (cwd) => {
    const fake = await installFakePlugin(applyPatchExtension)
    const context = {
      ...createFakeExtensionContext(cwd),
      tools: [],
      executeTool: async () => {
        throw new Error('Nested tool calls are not configured in this fake.')
      },
    }
    const patchText = `*** Begin Patch
*** Add File: created.txt
+patch result
*** End Patch`

    try {
      const tool = fake.tools.get('apply_patch')
      assert.ok(tool)
      assert.equal(tool.name, 'apply_patch')
      assert.equal(tool.label, 'apply_patch')
      assert.equal(tool.exposure, 'codemode')
      assert.equal((tool.parameters as { type?: string }).type, 'object')
      assert.equal(tool.promptSnippet, 'Apply verified multi-file add, update, move, and delete patches')
      assert.deepEqual(tool.promptGuidelines, [
        'Use apply_patch for coordinated multi-file add, update, move, or delete changes.',
        'Use apply_patch only with an OpenCode-style patch enclosed by *** Begin Patch and *** End Patch.',
        'Use edit instead of apply_patch for precise changes within one existing file.',
      ])
      assert.equal(typeof tool.renderCall, 'function')
      assert.equal(typeof tool.renderResult, 'function')

      //when
      const result = await fake.invokeTool('apply_patch', 'patch-call', { patchText }, context)

      //then
      assert.deepEqual(result, {
        content: [{ type: 'text', text: 'Applied patch:\nA created.txt' }],
        details: {
          files: [
            {
              type: 'add',
              path: 'created.txt',
              additions: 1,
              deletions: 0,
              diff: '--- /dev/null\n+++ created.txt\n+patch result',
            },
          ],
        },
      })
      assert.equal(await readFile(join(cwd, 'created.txt'), 'utf8'), 'patch result\n')

      initTheme('dark')
      const renderResult = tool.renderResult
      assert.ok(renderResult)
      const renderContext = { lastComponent: undefined, isError: false } as Parameters<typeof renderResult>[3]
      const theme = {
        fg: (_color: string, value: string) => value,
        bold: (value: string) => value,
      } as Parameters<typeof renderResult>[2]
      const renderInput = result as Parameters<typeof renderResult>[0]
      const collapsed = renderResult(renderInput, { expanded: false, isPartial: false }, theme, renderContext)
        .render(120)
        .join('\n')
      const expanded = renderResult(renderInput, { expanded: true, isPartial: false }, theme, renderContext)
        .render(120)
        .join('\n')
      assert.match(collapsed, /A created\.txt \+1 -0/)
      assert.match(collapsed, /to expand/)
      assert.doesNotMatch(collapsed, /--- \/dev\/null/)
      assert.match(expanded, /--- \/dev\/null/)
      assert.match(expanded, /patch result/)
    } finally {
      await fake.invokeEvent('session_shutdown', { type: 'session_shutdown', reason: 'quit' })
    }
  })
})

test('should map parse failures to ApplyPatchError given invalid patch input', async () => {
  //given
  await withTemporaryProject(async (cwd) => {
    const fake = await installFakePlugin(applyPatchExtension)
    const context = {
      ...createFakeExtensionContext(cwd),
      tools: [],
      executeTool: async () => {
        throw new Error('Nested tool calls are not configured in this fake.')
      },
    }

    try {
      //when
      const execution = fake.invokeTool('apply_patch', 'parse-call', { patchText: 'invalid patch' }, context)

      //then
      await assert.rejects(execution, (error: unknown) => {
        assert.ok(error instanceof PiToolError)
        const failure = error.cause as { _tag?: string; operation?: string }
        assert.equal(failure._tag, 'ApplyPatchError')
        assert.equal(failure.operation, 'parse')
        return true
      })
    } finally {
      await fake.invokeEvent('session_shutdown', { type: 'session_shutdown', reason: 'quit' })
    }
  })
})

test('should map patch application failures to ApplyPatchError given a missing update target', async () => {
  //given
  await withTemporaryProject(async (cwd) => {
    const fake = await installFakePlugin(applyPatchExtension)
    const context = {
      ...createFakeExtensionContext(cwd),
      tools: [],
      executeTool: async () => {
        throw new Error('Nested tool calls are not configured in this fake.')
      },
    }
    const patchText = `*** Begin Patch
*** Update File: missing.txt
@@
-old
+new
*** End Patch`

    try {
      //when
      const execution = fake.invokeTool('apply_patch', 'filesystem-call', { patchText }, context)

      //then
      await assert.rejects(execution, (error: unknown) => {
        assert.ok(error instanceof PiToolError)
        const failure = error.cause as { _tag?: string; operation?: string }
        assert.equal(failure._tag, 'ApplyPatchError')
        assert.equal(failure.operation, 'apply')
        return true
      })
      const retry = await fake.invokeTool(
        'apply_patch',
        'retry-call',
        {
          patchText: `*** Begin Patch
*** Add File: missing.txt
+recovered
*** End Patch`,
        },
        context,
      )
      assert.equal(
        (retry as { content: Array<{ type: string; text?: string }> }).content[0]?.text,
        'Applied patch:\nA missing.txt',
      )
      assert.equal(await readFile(join(cwd, 'missing.txt'), 'utf8'), 'recovered\n')
    } finally {
      await fake.invokeEvent('session_shutdown', { type: 'session_shutdown', reason: 'quit' })
    }
  })
})

test('should map filesystem failures to ApplyPatchError given a missing project root', async () => {
  //given
  await withTemporaryProject(async (cwd) => {
    const fake = await installFakePlugin(applyPatchExtension)
    const context = {
      ...createFakeExtensionContext(cwd),
      tools: [],
      executeTool: async () => {
        throw new Error('Nested tool calls are not configured in this fake.')
      },
    }
    await rm(cwd, { recursive: true, force: true })
    const patchText = `*** Begin Patch
*** Add File: created.txt
+patch result
*** End Patch`

    try {
      //when
      const execution = fake.invokeTool('apply_patch', 'filesystem-call', { patchText }, context)

      //then
      await assert.rejects(execution, (error: unknown) => {
        assert.ok(error instanceof PiToolError)
        const failure = error.cause as { _tag?: string; operation?: string }
        assert.equal(failure._tag, 'ApplyPatchError')
        assert.equal(failure.operation, 'filesystem')
        return true
      })
    } finally {
      await fake.invokeEvent('session_shutdown', { type: 'session_shutdown', reason: 'quit' })
    }
  })
})
