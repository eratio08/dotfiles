import { describe, expect, test } from 'bun:test'
import { type ExtensionAPI, type ExtensionContext, initTheme } from '@earendil-works/pi-coding-agent'
import { Effect, Exit } from 'effect'
import opensrcExtension from '../index.ts'
import type { OpensrcApi } from '../src/core/model.ts'
import { createCodeEvaluator } from '../src/effects/code-evaluator.ts'

initTheme()

interface RegisteredTestTool {
  readonly execute: (...args: readonly unknown[]) => Promise<unknown>
  readonly executionMode?: string
  readonly name?: string
  readonly renderCall: (...args: readonly unknown[]) => unknown
  readonly renderResult: (...args: readonly unknown[]) => unknown
}

const api: OpensrcApi = {
  list: () => [{ type: 'npm', name: 'zod', version: '3.0.0', path: 'zod', fetchedAt: '2026-01-01' }],
  has: (name) => name === 'zod',
  get: (name) => (name === 'zod' ? api.list()[0] : undefined),
  files: async () => [],
  tree: async () => ({ name: 'zod', type: 'directory', children: [] }),
  grep: async () => [],
  astGrep: async () => [],
  read: async () => '',
  readMany: async () => ({}),
  resolve: (spec) => ({ type: 'npm', name: spec }),
  fetch: async () => [],
  remove: async () => ({ success: true, removed: [] }),
  clean: async () => ({ success: true, removed: [] }),
}

describe('opensrc code mode', () => {
  test('evaluates a TypeScript default program', async () => {
    //given
    const evaluator = createCodeEvaluator()
    const code = 'export default async (opensrc: OpensrcApi) => opensrc.list().map((source) => source.name)'

    //when
    const result = await Effect.runPromise(evaluator.evaluate(code, api))

    //then
    expect(result).toEqual(['zod'])
  })

  test('rejects a module without a callable default export', async () => {
    //given
    const evaluator = createCodeEvaluator()
    const code = 'export const value = 1'

    //when
    const exit = await Effect.runPromise(Effect.exit(evaluator.evaluate(code, api)))

    //then
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain('default function')
  })

  test('blocks process require and globalThis in the VM', async () => {
    //given
    const evaluator = createCodeEvaluator()
    const code = 'export default () => [typeof process, typeof require, typeof globalThis]'

    //when
    const result = await Effect.runPromise(evaluator.evaluate(code, api))

    //then
    expect(result).toEqual(['undefined', 'undefined', 'undefined'])
  })

  test('stops a program that exceeds the timeout', async () => {
    //given
    const evaluator = createCodeEvaluator(5)
    const code = 'export default () => new Promise(() => {})'

    //when
    const exit = await Effect.runPromise(Effect.exit(evaluator.evaluate(code, api)))

    //then
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain('timed out')
  })

  test('terminates a program that loops after an awaited API call', async () => {
    //given
    const evaluator = createCodeEvaluator(20)
    const code =
      "export default async (opensrc: OpensrcApi) => { await opensrc.read('zod', 'index.ts'); while (true) {} }"

    //when
    const exit = await Effect.runPromise(Effect.exit(evaluator.evaluate(code, api)))

    //then
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain('timed out')
  })

  test('terminates a program when evaluation is cancelled', async () => {
    //given
    const controller = new AbortController()
    const evaluator = createCodeEvaluator()
    const delayedApi: OpensrcApi = {
      ...api,
      read: async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 100))
        return ''
      },
    }
    const evaluation = Effect.runPromiseExit(
      evaluator.evaluate(
        "export default async (opensrc: OpensrcApi) => await opensrc.read('zod', 'index.ts')",
        delayedApi,
      ),
      { signal: controller.signal },
    )

    //when
    await new Promise<void>((resolve) =>
      setTimeout(() => {
        controller.abort()
        resolve()
      }, 5),
    )
    const exit = await evaluation

    //then
    expect(Exit.hasInterrupts(exit)).toBe(true)
  })

  test('stops an already aborted program before evaluation', async () => {
    //given
    const controller = new AbortController()
    controller.abort()
    const evaluator = createCodeEvaluator()

    //when
    const exit = await Effect.runPromiseExit(evaluator.evaluate('export default () => 1', api), {
      signal: controller.signal,
    })

    //then
    expect(Exit.hasInterrupts(exit)).toBe(true)
  })

  test('registers one sequential native tool', () => {
    //given
    const registrations: unknown[] = []
    const pi = {
      registerTool: (tool: unknown) => {
        registrations.push(tool)
      },
      on: () => undefined,
    }

    //when
    opensrcExtension(pi as unknown as ExtensionAPI)

    //then
    expect(registrations).toHaveLength(1)
    expect(registrations[0]).toMatchObject({
      name: 'opensrc',
      description: "Give coding agents access to any package's source code.",
      executionMode: 'sequential',
      promptSnippet: expect.any(String),
      promptGuidelines: [
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.stringContaining('interface OpensrcApi'),
      ],
      parameters: expect.any(Object),
    })
  })

  test('renders the collapsed result as one summary line', () => {
    //given
    let registeredTool: RegisteredTestTool | undefined
    const pi = {
      registerTool: (tool: unknown) => {
        registeredTool = tool as RegisteredTestTool
      },
      on: () => undefined,
    }
    opensrcExtension(pi as unknown as ExtensionAPI)
    const theme = {
      bold: (value: string) => value,
      fg: (color: string, value: string) => `${color}:${value}`,
    }
    const state: Record<string, unknown> = {}
    const call = registeredTool?.renderCall({ code: 'export default () => 1' }, theme, { expanded: false, state })

    //when
    const result = registeredTool?.renderResult(
      { content: [{ type: 'text', text: 'response' }], details: { operations: { list: 2, read: 1 } } },
      { expanded: false, isPartial: false },
      theme,
      { isError: false, state },
    )

    //then
    expect(call).toBeDefined()
    expect(result).toBeDefined()
    const renderedCall = call as { render: (width: number) => string[] }
    const renderedResult = result as { render: (width: number) => string[] }
    const callText = renderedCall.render(120).join('\n').trimEnd()
    expect(callText).toContain('list: 2, read: 1')
    expect(callText).toContain('to expand')
    expect(callText).not.toContain('lines')
    expect(renderedResult.render(120)).toEqual([])
  })

  test('executes a program and returns only its final result', async () => {
    //given
    let registeredTool: RegisteredTestTool | undefined
    const calls: string[][] = []
    const pi = {
      registerTool: (tool: unknown) => {
        registeredTool = tool as RegisteredTestTool
      },
      on: () => undefined,
      exec: async (_command: string, args: string[]) => {
        calls.push(args)
        return {
          stdout: args[0] === '--version' ? 'opensrc 0.7.3' : '{"packages":[],"repos":[]}',
          stderr: '',
          code: 0,
          killed: false,
        }
      },
    }
    opensrcExtension(pi as unknown as ExtensionAPI)
    if (!registeredTool) throw new Error('opensrc tool was not registered')
    const signal = new AbortController().signal
    const context = { cwd: '/tmp/project' } as ExtensionContext

    //when
    const result = await registeredTool.execute(
      'test-call',
      { code: 'export default (opensrc: OpensrcApi) => opensrc.list()' },
      signal,
      undefined,
      context,
    )

    //then
    expect(result).toMatchObject({
      content: [{ type: 'text', text: '[]' }],
      details: { truncated: false, operations: { list: 1 } },
    })
    expect(calls).toEqual([['--version'], ['list', '--json']])
  })

  test('renders expanded results as text components', () => {
    //given
    let registeredTool: RegisteredTestTool | undefined
    const pi = {
      registerTool: (tool: unknown) => {
        registeredTool = tool as RegisteredTestTool
      },
      on: () => undefined,
    }
    opensrcExtension(pi as unknown as ExtensionAPI)
    const theme = {
      bold: (value: string) => value,
      fg: (color: string, value: string) => `${color}:${value}`,
    }

    //when
    const result = registeredTool?.renderResult(
      {
        content: [{ type: 'text', text: 'response' }],
        details: { code: 'export default () => 1', output: 'response' },
      },
      { expanded: true, isPartial: false },
      theme,
      { isError: false },
    )

    //then
    expect(result).toBeDefined()
    const rendered = result as { render: (width: number) => string[] }
    const text = rendered.render(120).join('\n')
    expect(text).toContain('export default () => 1')
    expect(text).toContain('response')
  })

  test('renders error results as text components', () => {
    //given
    let registeredTool: RegisteredTestTool | undefined
    const pi = {
      registerTool: (tool: unknown) => {
        registeredTool = tool as RegisteredTestTool
      },
      on: () => undefined,
    }
    opensrcExtension(pi as unknown as ExtensionAPI)
    const theme = {
      bold: (value: string) => value,
      fg: (color: string, value: string) => `${color}:${value}`,
    }

    //when
    const result = registeredTool?.renderResult(
      { content: [{ type: 'text', text: 'failure' }], details: {} },
      { expanded: false, isPartial: false },
      theme,
      { isError: true },
    )

    //then
    expect(result).toBeDefined()
  })
})
