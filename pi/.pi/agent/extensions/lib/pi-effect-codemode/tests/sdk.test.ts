import { test } from 'bun:test'
import assert from 'node:assert/strict'
import { readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { CodeModeFailure } from '@eratio/pi-codemode-core'
import { installFakePlugin } from '@eratio08/pi-effect/testing'
import { Effect } from 'effect'
import { Type } from 'typebox'
import {
  type CodeModeMethodDefinition,
  type CodeModeTool,
  createCodeModeTool,
  defineCodeModeMethod,
  PiExtension,
} from '../src/index.ts'

type TextToolResult = {
  readonly content: readonly { readonly type: string; readonly text?: string }[]
  readonly details?: { readonly truncated?: boolean; readonly fullOutputPath?: string }
}

const echoParameters = Type.Object({ text: Type.String() })

const createEchoTool = (
  execute: CodeModeMethodDefinition<typeof echoParameters, never, never>['execute'] = ({ text }) =>
    Effect.succeed(text),
  outputLimits?: { readonly maxBytes?: number; readonly maxLines?: number },
  toolName = 'echo',
): CodeModeTool<never, never> =>
  createCodeModeTool({
    toolName,
    description: 'Run TypeScript against the echo API.',
    timeoutMs: 10_000,
    outputLimits: outputLimits ?? { maxBytes: 1_000, maxLines: 40 },
    typeDeclarations: 'type EchoInput = { text: string }',
    methods: {
      echo: defineCodeModeMethod({
        description: 'Return the supplied text.',
        signature: '(input: EchoInput): Promise<string>',
        parameters: echoParameters,
        execute,
      }),
      uppercase: defineCodeModeMethod({
        description: 'Convert the supplied text to uppercase.',
        signature: '(input: EchoInput): Promise<string>',
        parameters: echoParameters,
        execute: ({ text }) => Effect.succeed(text.toUpperCase()),
      }),
    },
  })

const installCodeModeTool = async (tool: CodeModeTool<never, never>) =>
  installFakePlugin(
    PiExtension.install(
      PiExtension.define<CodeModeFailure>({
        id: 'code-mode-sdk-test',
        effect: ({ tools }) => tool.register(tools),
      }),
    ),
  )

test('generated API and program type names follow the tool name', async () => {
  //given
  const extension = await installCodeModeTool(createEchoTool(undefined, undefined, 'echo-tool'))

  //when
  const result = (await extension.invokeTool('echo-tool', 'named-help-call', {
    code: 'export default (api: echo_toolApi) => api.help()',
  })) as TextToolResult

  //then
  assert.match(result.content[0]?.text ?? '', /API type: `echo_toolApi`/)
  assert.match(result.content[0]?.text ?? '', /Program type: `echo_toolProgram`/)
})

test('operation help returns details for one method', async () => {
  //given
  const extension = await installCodeModeTool(createEchoTool())

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

test('help without an operation returns an overview', async () => {
  //given
  const extension = await installCodeModeTool(createEchoTool())

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

test('operation help rejects unknown method names', async () => {
  //given
  const extension = await installCodeModeTool(createEchoTool())

  //when
  const invocation = extension.invokeTool('echo', 'unknown-help-call', {
    code: 'export default (api: echoApi) => api.help("missing")',
  })

  //then
  await assert.rejects(invocation)
})

test('the runner does not register a separate help tool', async () => {
  //given
  const extension = await installCodeModeTool(createEchoTool())

  //when
  const invocation = extension.invokeTool('echo_help', 'separate-help-call', {})

  //then
  await assert.rejects(invocation)
})

test('truncated output points to a file that contains the full result', async () => {
  //given
  const extension = await installCodeModeTool(createEchoTool(undefined, { maxBytes: 100, maxLines: 5 }))

  //when
  const result = (await extension.invokeTool('echo', 'long-call', {
    code: 'export default () => "x".repeat(1_000)',
  })) as TextToolResult

  //then
  assert.equal(result.details?.truncated, true)
  const fullOutputPath = result.details?.fullOutputPath
  assert.ok(fullOutputPath)
  assert.match(result.content[0]?.text ?? '', /Full output saved to:/)
  try {
    assert.equal(await readFile(fullOutputPath, 'utf8'), 'x'.repeat(1_000))
  } finally {
    await rm(dirname(fullOutputPath), { recursive: true, force: true })
  }
})

test('the run tool executes a method and returns its value', async () => {
  //given
  const called: string[] = []
  const extension = await installCodeModeTool(
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

test('the run tool rejects invalid method parameters before execution', async () => {
  //given
  const called: string[] = []
  const extension = await installCodeModeTool(
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
