import { expect, test } from 'bun:test'
import { readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DEFAULT_MAX_LINES, type ExecResult, initTheme } from '@earendil-works/pi-coding-agent'
import { visibleWidth } from '@earendil-works/pi-tui'
import { installFakePlugin } from '@eratio/pi-effect/testing'
import astGrepExtension from '../index.ts'

type AstGrepTestExtension = Awaited<ReturnType<typeof installFakePlugin>>

async function withAstGrepTestExtension(testCase: (extension: AstGrepTestExtension) => Promise<void>): Promise<void> {
  const extension = await installFakePlugin(astGrepExtension)
  try {
    await testCase(extension)
  } finally {
    await extension.invokeEvent('session_shutdown', { type: 'session_shutdown', reason: 'quit' })
  }
}

function renderAstGrepTestTool(
  extension: AstGrepTestExtension,
  toolName: 'ast_grep_search' | 'ast_grep_rewrite',
  expanded: boolean,
  output: string,
): string[] {
  initTheme('dark')
  const tool = extension.tools.get(toolName)
  if (!tool?.renderResult) throw new Error(`Missing ast-grep renderer for ${toolName}`)

  const renderResult = tool.renderResult
  const summary = toolName === 'ast_grep_search' ? 'Search completed.' : 'Rewrite completed.'
  const result = {
    content: [{ type: 'text', text: output }],
    details: { output, summary, truncated: false },
  } as unknown as Parameters<typeof renderResult>[0]
  const options = { expanded, isPartial: false } as Parameters<typeof renderResult>[1]
  const theme = { fg: (_color: string, text: string): string => text } as unknown as Parameters<typeof renderResult>[2]
  const context = { lastComponent: undefined } as unknown as Parameters<typeof renderResult>[3]

  return renderResult(result, options, theme, context).render(40)
}

test('should pass search options to ast-grep given valid search parameters', async () => {
  await withAstGrepTestExtension(async (extension) => {
    //given
    const calls: Array<{ command: string; args: string[] }> = []
    extension.api.exec = async (command: string, args: string[]): Promise<ExecResult> => {
      calls.push({ command, args: [...args] })
      return { stdout: 'match\n', stderr: '', code: 0, killed: false }
    }

    //when
    const result = await extension.invokeTool('ast_grep_search', 'search-call', {
      pattern: '$NODE',
      lang: 'typescript',
      json: true,
      path: 'src',
    })

    //then
    expect(calls).toEqual([
      {
        command: 'ast-grep',
        args: ['--pattern', '$NODE', '--lang', 'typescript', '--json', 'src'],
      },
    ])
    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'match' }],
      details: { output: 'match', summary: 'Search completed.', truncated: false },
    })
  })
})

test('should report no matches given empty search output', async () => {
  await withAstGrepTestExtension(async (extension) => {
    //given
    extension.api.exec = async (): Promise<ExecResult> => ({
      stdout: '',
      stderr: '',
      code: 0,
      killed: false,
    })

    //when
    const result = await extension.invokeTool('ast_grep_search', 'search-call', {
      pattern: '$NODE',
    })

    //then
    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'No matches found.' }],
      details: { output: '', summary: 'No matches found.', truncated: false },
    })
  })
})

test('should pass rewrite options and report completion given valid rewrite parameters', async () => {
  await withAstGrepTestExtension(async (extension) => {
    //given
    const calls: Array<{ command: string; args: string[] }> = []
    extension.api.exec = async (command: string, args: string[]): Promise<ExecResult> => {
      calls.push({ command, args: [...args] })
      return { stdout: '', stderr: '', code: 0, killed: false }
    }

    //when
    const result = await extension.invokeTool('ast_grep_rewrite', 'rewrite-call', {
      pattern: 'old()',
      rewrite: 'new()',
      lang: 'typescript',
      path: 'src',
    })

    //then
    expect(calls).toEqual([
      {
        command: 'ast-grep',
        args: ['--pattern', 'old()', '--rewrite', 'new()', '--update-all', '--lang', 'typescript', 'src'],
      },
    ])
    expect(result).toMatchObject({
      content: [{ type: 'text', text: 'Rewrite completed.' }],
      details: { output: '', summary: 'Rewrite completed.', truncated: false },
    })
  })
})

test('should fail the tool given a nonzero ast-grep exit', async () => {
  await withAstGrepTestExtension(async (extension) => {
    //given
    extension.api.exec = async (): Promise<ExecResult> => ({
      stdout: '',
      stderr: 'invalid pattern\n',
      code: 2,
      killed: false,
    })

    //when
    const result = extension.invokeTool('ast_grep_search', 'search-call', { pattern: '$NODE' })

    //then
    await expect(result).rejects.toMatchObject({
      _tag: 'PiToolError',
      tool: 'ast_grep_search',
      operation: 'execute',
      message: 'ast-grep command failed: invalid pattern',
    })
  })
})

test('should pass the tool abort signal to ast-grep given an abort signal', async () => {
  await withAstGrepTestExtension(async (extension) => {
    //given
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    extension.api.exec = async (...args: Parameters<typeof extension.api.exec>): Promise<ExecResult> => {
      receivedSignal = args[2]?.signal
      return { stdout: '', stderr: '', code: 0, killed: false }
    }

    //when
    await extension.invokeTool('ast_grep_search', 'search-call', { pattern: '$NODE' }, undefined, controller.signal)

    //then
    controller.abort()
    expect(receivedSignal?.aborted).toBe(true)
  })
})

test('should save the complete output given output exceeds Pi limits', async () => {
  await withAstGrepTestExtension(async (extension) => {
    //given
    const output = Array.from({ length: DEFAULT_MAX_LINES + 1 }, (_value, index) => `match ${index}`).join('\n')
    extension.api.exec = async (): Promise<ExecResult> => ({
      stdout: `${output}\n`,
      stderr: '',
      code: 0,
      killed: false,
    })

    //when
    const result = await extension.invokeTool('ast_grep_search', 'search-call', { pattern: '$NODE' })

    //then
    const details = (
      result as {
        details: {
          readonly output: string
          readonly truncated: boolean
          readonly fullOutputPath?: string
          readonly truncationNotice?: string
        }
      }
    ).details
    expect(details.truncated).toBe(true)
    expect(details.output.length).toBeLessThan(output.length)
    expect(details.truncationNotice).toContain('Full output saved to:')
    if (!details.fullOutputPath) throw new Error('Expected the complete output path')
    try {
      expect(await readFile(details.fullOutputPath, 'utf8')).toBe(`${output}\n`)
    } finally {
      await rm(dirname(details.fullOutputPath), { recursive: true, force: true })
    }
  })
})

test('should render a compact search result given collapsed tool output', async () => {
  await withAstGrepTestExtension(async (extension) => {
    //given
    const output = 'const value = 1'

    //when
    const lines = renderAstGrepTestTool(extension, 'ast_grep_search', false, output)

    //then
    const renderedOutput = lines.join('\n')
    expect(renderedOutput).toContain('Search completed.')
    expect(renderedOutput).toContain('to expand')
    expect(renderedOutput).not.toContain('const value = 1')
    expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true)
  })
})

test('should show search output given expanded tool output', async () => {
  await withAstGrepTestExtension(async (extension) => {
    //given
    const output = 'const value = 1'

    //when
    const lines = renderAstGrepTestTool(extension, 'ast_grep_search', true, output)

    //then
    expect(lines.join('\n')).toContain('const value = 1')
    expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true)
  })
})

test('should render a compact rewrite result given collapsed tool output', async () => {
  await withAstGrepTestExtension(async (extension) => {
    //given
    const output = 'const value = 1'

    //when
    const lines = renderAstGrepTestTool(extension, 'ast_grep_rewrite', false, output)

    //then
    const renderedOutput = lines.join('\n')
    expect(renderedOutput).toContain('Rewrite completed.')
    expect(renderedOutput).toContain('to expand')
    expect(renderedOutput).not.toContain('const value = 1')
    expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true)
  })
})

test('should show rewrite output given expanded tool output', async () => {
  await withAstGrepTestExtension(async (extension) => {
    //given
    const output = 'const value = 1'

    //when
    const lines = renderAstGrepTestTool(extension, 'ast_grep_rewrite', true, output)

    //then
    expect(lines.join('\n')).toContain('const value = 1')
    expect(lines.every((line) => visibleWidth(line) <= 40)).toBe(true)
  })
})
