import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { initTheme } from '@earendil-works/pi-coding-agent'
import type { ProgramFailure } from '@eratio/pi-codemode-core'
import { PiToolContext as PiToolContextService } from '@eratio/pi-effect'
import { installFakePlugin } from '@eratio/pi-effect/testing'
import { Effect } from 'effect'
import { Type } from 'typebox'
import {
  createTool,
  defineMethod,
  type MethodDefinition,
  PiExtension,
  PiToolError,
  type RegisteredTool,
} from '../dist/index.js'

type TextToolResult = {
  readonly content: readonly { readonly type: string; readonly text?: string }[]
  readonly details?: {
    readonly truncated?: boolean
    readonly fullOutputPath?: string
    readonly operations?: Readonly<Record<string, number>>
  }
}

const echoParameters = Type.Object({ text: Type.String() })
const tupleParameters = Type.Tuple([Type.String(), Type.String()])

const optionalEchoTool = createTool({
  toolName: 'optional-echo',
  description: 'Run TypeScript against an API with an optional argument.',
  timeoutMs: 10_000,
  typeDeclarations: 'type EchoInput = { text: string }',
  methods: {
    echo: defineMethod({
      description: 'Return supplied text or a default value.',
      signature: '(input?: EchoInput): Promise<string>',
      parameters: echoParameters,
      optionalParameters: true,
      execute: (input) => Effect.succeed(input?.text ?? 'empty'),
    }),
  },
})

const createEchoTool = (
  execute: MethodDefinition<typeof echoParameters, never, never>['execute'] = ({ text }) => Effect.succeed(text),
  outputLimits?: { readonly maxBytes?: number; readonly maxLines?: number },
  toolName = 'echo',
): RegisteredTool<never, never> =>
  createTool({
    toolName,
    description: 'Run TypeScript against the echo API.',
    timeoutMs: 10_000,
    outputLimits: outputLimits ?? { maxBytes: 1_000, maxLines: 40 },
    typeDeclarations: 'type EchoInput = { text: string }',
    methods: {
      echo: defineMethod({
        description: 'Return the supplied text.',
        signature: '(input: EchoInput): Promise<string>',
        parameters: echoParameters,
        execute,
      }),
      uppercase: defineMethod({
        description: 'Convert the supplied text to uppercase.',
        signature: '(input: EchoInput): Promise<string>',
        parameters: echoParameters,
        execute: ({ text }) => Effect.succeed(text.toUpperCase()),
      }),
    },
  })

const installTool = async <Services, Failure>(tool: RegisteredTool<Services, Failure>) =>
  installFakePlugin(
    PiExtension.install(
      PiExtension.define<ProgramFailure>({
        id: 'code-mode-sdk-test',
        effect: ({ tools }) => tool.register(tools),
      }),
    ),
  )

test('should register a tool with Pi services given a custom execution failure type', async () => {
  //given
  const tool = createTool<never, { readonly _tag: 'ToolFailure' }>({
    toolName: 'pi-service-tool',
    description: 'Run TypeScript with Pi services.',
    timeoutMs: 10_000,
    withRun: (run) =>
      Effect.gen(function* () {
        yield* PiToolContextService
        return yield* run(undefined)
      }),
    methods: {
      inspect: defineMethod({
        description: 'Read the current tool context.',
        signature: '(): Promise<string>',
        execute: () =>
          Effect.gen(function* () {
            yield* PiToolContextService
            return 'available'
          }),
      }),
    },
  })

  //when
  const extension = await installTool(tool)

  //then
  assert.ok(extension.tools.get('pi-service-tool'))
})

test('should pass the execution mode given a registered Pi tool', async () => {
  //given
  const tool = createTool({
    toolName: 'sequential',
    description: 'Run TypeScript against a sequential API.',
    timeoutMs: 10_000,
    executionMode: 'sequential',
    methods: {
      echo: defineMethod({
        description: 'Return a value.',
        signature: '(): Promise<string>',
        execute: () => Effect.succeed('value'),
      }),
    },
  })

  //when
  const extension = await installTool(tool)

  //then
  assert.equal(extension.tools.get('sequential')?.executionMode, 'sequential')
})

test('should pass custom prompt text and guidelines given tool registration', async () => {
  //given
  const extension = await installTool(
    createTool({
      toolName: 'prompted',
      description: 'Run TypeScript against a prompted API.',
      promptSnippet: 'Use the task API.',
      promptGuidelines: ['Use the task API only for task work.'],
      timeoutMs: 10_000,
      methods: {
        list: defineMethod({
          description: 'List tasks.',
          signature: '(): Promise<string[]>',
          execute: () => Effect.succeed([]),
        }),
      },
    }),
  )

  //when
  const tool = extension.tools.get('prompted')

  //then
  assert.ok(tool)
  assert.equal(tool.promptSnippet, 'Use the task API.')
  assert.deepEqual(tool.promptGuidelines, ['Use the task API only for task work.'])
})

test('should validate tuple schemas and pass positional method arguments given valid inputs', async () => {
  //given
  const extension = await installTool(
    createTool({
      toolName: 'pair',
      description: 'Join two strings.',
      timeoutMs: 10_000,
      methods: {
        join: defineMethod({
          description: 'Join two strings.',
          signature: '(left: string, right: string): Promise<string>',
          parameters: tupleParameters,
          execute: ([left, right]) => Effect.succeed(`${left}:${right}`),
        }),
      },
    }),
  )

  //when
  const result = (await extension.invokeTool('pair', 'tuple-call', {
    code: 'export default async (api: pairApi) => api.join("left", "right")',
  })) as TextToolResult

  //then
  assert.equal(result.content[0]?.text, 'left:right')
  assert.deepEqual(result.details?.operations, { join: 1 })
})

test('should reject the wrong number of positional method arguments given tuple schema inputs', async () => {
  //given
  const extension = await installTool(
    createTool({
      toolName: 'pair',
      description: 'Join two strings.',
      timeoutMs: 10_000,
      methods: {
        join: defineMethod({
          description: 'Join two strings.',
          signature: '(left: string, right: string): Promise<string>',
          parameters: tupleParameters,
          execute: ([left, right]) => Effect.succeed(`${left}:${right}`),
        }),
      },
    }),
  )

  //when
  const invocation = extension.invokeTool('pair', 'invalid-tuple-call', {
    code: 'export default async (api: pairApi) => (api.join as (...args: unknown[]) => Promise<string>)("only")',
  })

  //then
  await assert.rejects(invocation)
})

const invokeConcurrentRuns = async (
  extension: Awaited<ReturnType<typeof installTool>>,
): Promise<[TextToolResult, TextToolResult]> => {
  const results = await Promise.all([
    extension.invokeTool('echo', 'echo-count-call', {
      code: 'export default async (api: echoApi) => api.echo({ text: "one" })',
    }),
    extension.invokeTool('echo', 'uppercase-count-call', {
      code: 'export default async (api: echoApi) => api.uppercase({ text: "two" })',
    }),
  ])
  return results as [TextToolResult, TextToolResult]
}

test('should expose generated types and use help discovery given help requests', async () => {
  //given
  const extension = await installTool(createEchoTool(undefined, undefined, 'echo-tool'))
  const tool = extension.tools.get('echo-tool')
  assert.ok(tool)
  const promptGuidelines = tool.promptGuidelines?.join('\n') ?? ''

  //when
  const result = (await extension.invokeTool('echo-tool', 'named-help-call', {
    code: 'export default (api: echo_toolApi) => api.help()',
  })) as TextToolResult

  //then
  assert.match(result.content[0]?.text ?? '', /API type: `echo_toolApi`/)
  assert.match(result.content[0]?.text ?? '', /Program type: `echo_toolProgram`/)
  assert.match(promptGuidelines, /api\.help\(\)/)
  assert.match(promptGuidelines, /api\.help\("operation"\)/)
  assert.doesNotMatch(promptGuidelines, /echo_toolApi|echo_toolProgram/)
})

test('should return method details given an operation-specific help request', async () => {
  //given
  const extension = await installTool(createEchoTool())

  //when
  const result = (await extension.invokeTool('echo', 'help-call', {
    code: 'export default (api: echoApi) => api.help("echo")',
  })) as TextToolResult

  //then
  assert.equal(result.content[0]?.type, 'text')
  assert.match(result.content[0]?.text ?? '', /echo\(input: EchoInput\): Promise<string>/)
  assert.match(result.content[0]?.text ?? '', /Return the supplied text\./)
  assert.match(result.content[0]?.text ?? '', /type EchoInput = \{ text: string \}/)
  assert.match(result.content[0]?.text ?? '', /"text"/)
  assert.doesNotMatch(result.content[0]?.text ?? '', /Convert the supplied text to uppercase\./)
})

test('should return an overview given a help request without an operation', async () => {
  //given
  const extension = await installTool(createEchoTool())

  //when
  const result = (await extension.invokeTool('echo', 'help-api-call', {
    code: 'export default (api: echoApi) => api.help()',
  })) as TextToolResult

  //then
  assert.match(result.content[0]?.text ?? '', /- `echo`: Return the supplied text\./)
  assert.match(result.content[0]?.text ?? '', /- `uppercase`: Convert the supplied text to uppercase\./)
  assert.doesNotMatch(result.content[0]?.text ?? '', /Parameter schema:/)
  assert.match(result.content[0]?.text ?? '', /API type: `echoApi`/)
  assert.match(result.content[0]?.text ?? '', /Program type: `echoProgram`/)
})

test('should reject unknown method names given an operation-help request', async () => {
  //given
  const extension = await installTool(createEchoTool())

  //when
  const invocation = extension.invokeTool('echo', 'unknown-help-call', {
    code: 'export default (api: echoApi) => api.help("missing")',
  })

  //then
  await assert.rejects(invocation)
})

test('should omit a separate help tool given runner registration', async () => {
  //given
  const extension = await installTool(createEchoTool())

  //when
  const invocation = extension.invokeTool('echo_help', 'separate-help-call', {})

  //then
  await assert.rejects(invocation)
})

test('should point truncated output to a file with the full result given oversized output', async () => {
  //given
  const extension = await installTool(createEchoTool(undefined, { maxBytes: 100, maxLines: 5 }))

  //when
  const result = (await extension.invokeTool('echo', 'long-call', {
    code: 'export default async (api: echoApi) => (await api.echo({ text: "x" })).repeat(1_000)',
  })) as TextToolResult

  //then
  assert.equal(result.details?.truncated, true)
  assert.deepEqual(result.details?.operations, { echo: 1 })
  const fullOutputPath = result.details?.fullOutputPath
  assert.ok(fullOutputPath)
  assert.match(result.content[0]?.text ?? '', /Full output saved to:/)
  try {
    assert.equal(await readFile(fullOutputPath, 'utf8'), 'x'.repeat(1_000))
  } finally {
    await rm(dirname(fullOutputPath), { recursive: true, force: true })
  }
})

test('should execute a method and return its value given a run request', async () => {
  //given
  const called: string[] = []
  const extension = await installTool(
    createEchoTool(({ text }) =>
      Effect.sync(() => {
        called.push(text)
        return text
      }),
    ),
  )

  //when
  const result = (await extension.invokeTool('echo', 'run-call', {
    code: 'export default async (api: echoApi) => api.echo({ text: "hello" })',
  })) as TextToolResult

  //then
  assert.equal(result.content[0]?.type, 'text')
  assert.equal(result.content[0]?.text, 'hello')
  assert.deepEqual(called, ['hello'])
})

test('should enforce the configured timeout given a long-running method', async () => {
  //given
  const extension = await installTool(
    createTool<never, never>({
      toolName: 'timeout',
      description: 'Run TypeScript against a tool with a short timeout.',
      timeoutMs: 25,
      methods: {
        wait: defineMethod({
          description: 'Return immediately before the program stalls.',
          signature: '(): Promise<void>',
          execute: () => Effect.succeed(undefined),
        }),
      },
    }),
  )

  //when
  const invocation = extension.invokeTool('timeout', 'timeout-call', {
    code: 'export default async (api: timeoutApi) => { await api.wait(); await new Promise(() => {}) }',
  })

  //then
  await assert.rejects(invocation, (error: unknown) => {
    assert.ok(error instanceof PiToolError)
    const cause = error.cause as ProgramFailure
    assert.equal(cause._tag, 'timeout')
    assert.match(cause.message, /timed out after 25ms/)
    return true
  })
})

test('should pass one context to each method call given a run scope', async () => {
  //given
  const runContext = { prefix: 'scoped:' }
  const contexts: (typeof runContext)[] = []
  const tool = createTool<never, never, typeof runContext>({
    toolName: 'scoped',
    description: 'Run TypeScript against a scoped API.',
    timeoutMs: 10_000,
    typeDeclarations: 'type EchoInput = { text: string }',
    methods: {
      echo: defineMethod<typeof echoParameters, never, never, typeof runContext>({
        description: 'Return the supplied text with the run prefix.',
        signature: '(input: EchoInput): Promise<string>',
        parameters: echoParameters,
        execute: ({ text }, _signal, context) =>
          Effect.sync(() => {
            contexts.push(context)
            return `${context.prefix}${text}`
          }),
      }),
    },
    withRun: (run) =>
      Effect.gen(function* () {
        const result = yield* run(runContext)
        assert.deepEqual(result.details?.operations, { echo: 2 })
        return result
      }),
  })
  const extension = await installTool(tool)

  //when
  const result = (await extension.invokeTool('scoped', 'scoped-run-context-call', {
    code: 'export default async (api: scopedApi) => [await api.echo({ text: "one" }), await api.echo({ text: "two" })]',
  })) as TextToolResult

  //then
  assert.match(result.content[0]?.text ?? '', /scoped:one/)
  assert.match(result.content[0]?.text ?? '', /scoped:two/)
  assert.equal(contexts.length, 2)
  assert.strictEqual(contexts[0], runContext)
  assert.strictEqual(contexts[1], runContext)
})

test('should reject invalid method parameters before execution given invalid input', async () => {
  //given
  const called: string[] = []
  const extension = await installTool(
    createEchoTool(({ text }) =>
      Effect.sync(() => {
        called.push(text)
        return text
      }),
    ),
  )

  //when
  const invocation = extension.invokeTool('echo', 'invalid-call', {
    code: 'export default async (api: echoApi) => api.echo({ text: 42 })',
  })

  //then
  await assert.rejects(invocation)
  assert.deepEqual(called, [])
})

test('should accept omitted, undefined, and valid arguments given optional method parameters', async () => {
  //given
  const extension = await installTool(optionalEchoTool)

  //when
  const result = (await extension.invokeTool('optional-echo', 'optional-arguments-call', {
    code: 'export default async (api: optional_echoApi) => [await api.echo(), await api.echo(undefined), await api.echo({ text: "hello" })].join("|")',
  })) as TextToolResult

  //then
  assert.equal(result.content[0]?.text, 'empty|empty|hello')
  assert.deepEqual(result.details?.operations, { echo: 3 })
})

test('should validate supplied arguments given optional method parameters', async () => {
  //given
  const extension = await installTool(optionalEchoTool)

  //when
  const invocation = extension.invokeTool('optional-echo', 'invalid-optional-call', {
    code: 'export default async (api: optional_echoApi) => api.echo({ text: 42 })',
  })

  //then
  await assert.rejects(invocation)
})

test('should record repeated operation calls given a run', async () => {
  //given
  const extension = await installTool(createEchoTool())

  //when
  const result = (await extension.invokeTool('echo', 'operation-count-call', {
    code: 'export default async (api: echoApi) => { await api.echo({ text: "one" }); await api.uppercase({ text: "two" }); await api.echo({ text: "three" }); return "done" }',
  })) as TextToolResult

  //then
  assert.deepEqual(result.details?.operations, { echo: 2, uppercase: 1 })
})

test('should keep operation counts separate given concurrent runs', async () => {
  //given
  const extension = await installTool(createEchoTool())

  //when
  const results = await invokeConcurrentRuns(extension)

  //then
  assert.deepEqual(results[0].details?.operations, { echo: 1 })
  assert.deepEqual(results[1].details?.operations, { uppercase: 1 })
})

test('should show the operation summary on one line given collapsed rendering', async () => {
  //given
  const extension = await installTool(createEchoTool())
  initTheme('dark')
  const tool = extension.tools.get('echo')
  assert.ok(tool)
  assert.ok(tool.renderCall)
  assert.ok(tool.renderResult)
  const args = { code: 'export default async (api: echoApi) => api.echo({ text: "hello" })' }
  const context = {
    args,
    toolCallId: 'collapsed-render-call',
    invalidate: () => undefined,
    lastComponent: undefined,
    state: {},
    cwd: process.cwd(),
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: false,
    isError: false,
  }
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as never
  const call = tool.renderCall(args, theme, context as never)
  const result = {
    content: [{ type: 'text', text: 'hello' }],
    details: {
      truncated: false,
      outputBytes: 5,
      outputLines: 1,
      totalBytes: 5,
      totalLines: 1,
      operations: { echo: 2, uppercase: 1 },
    },
  } as never

  //when
  const rendered = tool.renderResult(result, { expanded: false, isPartial: false }, theme, context as never)

  //then
  assert.deepEqual(rendered.render(120), [])
  const callLines = call.render(120)
  assert.equal(callLines.length, 1)
  assert.match(callLines[0] ?? '', /echo: 2 · uppercase: 1/)
  assert.match(callLines[0] ?? '', /to expand/)
  assert.doesNotMatch(callLines.join('\n'), /export default|hello/)
})

test('should show the submitted code and result given expanded rendering', async () => {
  //given
  const extension = await installTool(createEchoTool())
  const tool = extension.tools.get('echo')
  assert.ok(tool)
  assert.ok(tool.renderCall)
  assert.ok(tool.renderResult)
  const code = 'export default async (api: echoApi) => api.echo({ text: "hello" })'
  const args = { code }
  const context = {
    args,
    toolCallId: 'expanded-render-call',
    invalidate: () => undefined,
    lastComponent: undefined,
    state: {},
    cwd: process.cwd(),
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: true,
    showImages: false,
    isError: false,
  }
  const theme = {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  } as never
  tool.renderCall(args, theme, context as never)
  const result = {
    content: [{ type: 'text', text: 'hello' }],
    details: {
      truncated: false,
      outputBytes: 5,
      outputLines: 1,
      totalBytes: 5,
      totalLines: 1,
      operations: { echo: 1 },
    },
  } as never

  //when
  const rendered = tool.renderResult(result, { expanded: true, isPartial: false }, theme, context as never)

  //then
  const output = rendered.render(120).join('\n')
  assert.match(output, /Code/)
  assert.match(output, new RegExp(code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(output, /Operations/)
  assert.match(output, /echo: 1/)
  assert.match(output, /Result/)
  assert.match(output, /hello/)
})
