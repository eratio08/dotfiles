import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  keyHint,
  truncateHead,
  withFileMutationQueue,
} from '@earendil-works/pi-coding-agent'
import { type Component, Container, Text } from '@earendil-works/pi-tui'
import {
  type CodeModeDefinition,
  CodeModeEffectHost,
  type CodeModeFailure,
  type CodeModeHostErrorCodec,
  type CodeModeRunOptions,
  createCodeModeCore,
  createCodeModeFailure,
} from '@eratio/pi-codemode-core'
import { type CodeModeOutputLimits, formatCodeModeValue } from '@eratio/pi-codemode-core/output'
import {
  type EffectToolDefinition,
  type PiRegistrationError,
  PiToolContext,
  type PiToolRegistry,
  type PiToolResult,
} from '@eratio08/pi-effect'
import { Effect } from 'effect'
import { type Static, type TSchema, Type } from 'typebox'
import { Check } from 'typebox/value'

interface CodeModeMethodDefinition<Params extends TSchema | undefined, Services, Failure, RunContext = void> {
  readonly description: string
  readonly signature: string
  readonly parameters?: Params
  readonly execute: (
    params: Params extends TSchema ? Static<Params> : undefined,
    signal: AbortSignal,
    runContext: RunContext,
  ) => Effect.Effect<unknown, Failure, Services>
}

type CodeModeMethodInput<Services, Failure, RunContext = void> = {
  readonly description: string
  readonly signature: string
  readonly parameters?: TSchema
  readonly execute: (
    params: never,
    signal: AbortSignal,
    runContext: RunContext,
  ) => Effect.Effect<unknown, Failure, Services>
}

interface CodeModeToolOutputDetails {
  readonly truncated: boolean
  readonly outputBytes: number
  readonly outputLines: number
  readonly totalBytes: number
  readonly totalLines: number
  readonly fullOutputPath?: string
  readonly operations?: Readonly<Record<string, number>>
}

interface CodeModeToolDefinition<Services, Failure, RunContext = void> {
  readonly toolName: string
  readonly label?: string
  readonly description: string
  readonly methods: Readonly<Record<string, CodeModeMethodInput<Services, Failure, RunContext>>>
  readonly typeDeclarations?: string
  readonly examples?: readonly string[]
  readonly timeoutMs: number
  readonly outputLimits?: Partial<CodeModeOutputLimits>
  readonly execution?: CodeModeRunOptions['execution']
  readonly errorCodec?: CodeModeHostErrorCodec<CodeModeFailure | Failure>
  readonly withRun?: (
    run: (
      runContext: RunContext,
    ) => Effect.Effect<PiToolResult<CodeModeToolOutputDetails>, CodeModeFailure | Failure, Services>,
    signal: AbortSignal | undefined,
  ) => Effect.Effect<PiToolResult<CodeModeToolOutputDetails>, CodeModeFailure | Failure, Services>
}

interface CodeModeTool<Services, Failure> {
  readonly toolName: string
  readonly register: (
    registry: PiToolRegistry<Services, CodeModeFailure | Failure>,
  ) => Effect.Effect<void, PiRegistrationError>
}

function createCodeModeToolOutput(
  value: unknown,
  outputLimits: CodeModeOutputLimits,
  operations: Readonly<Record<string, number>>,
  toolSignal?: AbortSignal,
): Effect.Effect<PiToolResult<CodeModeToolOutputDetails>, CodeModeFailure> {
  const fullOutput = formatCodeModeValue(value)
  const truncation = truncateHead(fullOutput, outputLimits)
  const details = {
    truncated: truncation.truncated,
    outputBytes: truncation.outputBytes,
    outputLines: truncation.outputLines,
    totalBytes: truncation.totalBytes,
    totalLines: truncation.totalLines,
    operations,
  }
  if (!truncation.truncated) {
    return Effect.succeed({
      content: [{ type: 'text', text: truncation.content }],
      details,
    })
  }

  return Effect.gen(function* () {
    const fullOutputPath = yield* Effect.tryPromise({
      try: async (effectSignal) => {
        const signal = toolSignal === undefined ? effectSignal : AbortSignal.any([toolSignal, effectSignal])
        const tempDirectory = await mkdtemp(join(tmpdir(), 'pi-effect-codemode-'))
        const outputPath = join(tempDirectory, 'output.txt')
        await withFileMutationQueue(outputPath, async () => {
          await writeFile(outputPath, fullOutput, { encoding: 'utf8', signal })
        })
        return outputPath
      },
      catch: (cause) =>
        createCodeModeFailure({
          _tag: toolSignal?.aborted ? 'cancellation' : 'serialize',
          operation: 'output',
          message: toolSignal?.aborted
            ? 'Saving the complete output was cancelled.'
            : 'The complete output could not be saved.',
          cause,
        }),
    })
    const omittedLines = truncation.totalLines - truncation.outputLines
    const omittedBytes = truncation.totalBytes - truncation.outputBytes
    return {
      content: [
        {
          type: 'text',
          text: `${truncation.content}\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ${omittedLines} lines (${formatSize(omittedBytes)}) omitted. Full output saved to: ${fullOutputPath}]`,
        },
      ],
      details: { ...details, fullOutputPath },
    }
  })
}

function createCodeModeRenderers<Params extends TSchema>(
  toolLabel: string,
): Pick<EffectToolDefinition<Params, never, never, CodeModeToolOutputDetails>, 'renderCall' | 'renderResult'> {
  type RendererState = {
    call?: Text
    callText?: string
    hasResult?: boolean
    summary?: string
  }
  return {
    renderCall: (_args, theme, context): Component => {
      const state = (context.state ?? {}) as RendererState
      const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0)
      state.call = text
      state.callText = theme.fg('toolTitle', theme.bold(toolLabel))
      const summary = !context.expanded && state.hasResult && state.summary ? ` · ${state.summary}` : ''
      const hint = !context.expanded && state.hasResult ? ` ${keyHint('app.tools.expand', 'to expand')}` : ''
      text.setText(`${state.callText}${summary}${hint}`)
      return text
    },
    renderResult: (result, { expanded, isPartial }, theme, context): Component => {
      if (isPartial) return new Text(theme.fg('warning', 'Running...'), 0, 0)
      const details = result.details as CodeModeToolOutputDetails | undefined
      const output = result.content
        .map((item) => (item.type === 'text' ? item.text : ''))
        .filter(Boolean)
        .join('\n')
      const code = (context.args as { code: string }).code
      if (context.isError) {
        if (!expanded) return new Text(theme.fg('error', output), 0, 0)
        return new Text(
          `${theme.fg('toolTitle', 'Code')}\n${theme.fg('toolOutput', code)}\n\n${theme.fg('toolTitle', 'Error')}\n${theme.fg('error', output)}`,
          0,
          0,
        )
      }
      const summary =
        Object.entries(details?.operations ?? {})
          .map(([operation, count]) => `${operation}: ${count}`)
          .join(', ') || 'no operations'
      const state = (context.state ?? {}) as RendererState
      state.hasResult = true
      state.summary = summary
      if (expanded) {
        return new Text(
          `${theme.fg('toolTitle', 'Operations')}\n${theme.fg('toolOutput', summary)}\n\n${theme.fg('toolTitle', 'Code')}\n${theme.fg('toolOutput', code)}\n\n${theme.fg('toolTitle', 'Result')}\n${theme.fg('toolOutput', output)}`,
          0,
          0,
        )
      }
      if (state.call && state.callText) {
        state.call.setText(`${state.callText} · ${summary} ${keyHint('app.tools.expand', 'to expand')}`)
      }
      return new Container()
    },
  }
}

function defineCodeModeMethod<
  Params extends TSchema | undefined = undefined,
  Services = never,
  Failure = never,
  RunContext = void,
>(
  method: CodeModeMethodDefinition<Params, Services, Failure, RunContext>,
): CodeModeMethodDefinition<Params, Services, Failure, RunContext> {
  return method
}

function createCodeModeTool<Services = never, Failure = never>(
  options: CodeModeToolDefinition<Services, Failure>,
): CodeModeTool<Services, Failure>
function createCodeModeTool<Services, Failure, RunContext>(
  options: CodeModeToolDefinition<Services, Failure, RunContext> & {
    readonly withRun: NonNullable<CodeModeToolDefinition<Services, Failure, RunContext>['withRun']>
  },
): CodeModeTool<Services, Failure>
function createCodeModeTool<Services = never, Failure = never, RunContext = void>(
  options: CodeModeToolDefinition<Services, Failure, RunContext>,
): CodeModeTool<Services, Failure> {
  const methodEntries = Object.entries(options.methods)
  if (methodEntries.length === 0) throw new TypeError('At least one operation is required.')
  if (Object.hasOwn(options.methods, 'help')) throw new TypeError('The method name "help" is reserved.')

  const outputLimits: CodeModeOutputLimits = {
    maxBytes: options.outputLimits?.maxBytes ?? DEFAULT_MAX_BYTES,
    maxLines: options.outputLimits?.maxLines ?? DEFAULT_MAX_LINES,
  }
  const typeNamePrefix = options.toolName.replace(/[^A-Za-z0-9_$]/g, '_')
  const safeTypeNamePrefix = /^[A-Za-z_$]/.test(typeNamePrefix) ? typeNamePrefix : `_${typeNamePrefix}`
  const apiName = `${safeTypeNamePrefix}Api`
  const programName = `${safeTypeNamePrefix}Program`
  const operationNames = methodEntries.map(([name]) => JSON.stringify(name)).join(' | ')
  const typeDeclarations = options.typeDeclarations?.trim()
  const declarations = [
    typeDeclarations,
    `interface ${apiName} {`,
    `  help(): string\n  help(operation: ${operationNames}): string`,
    ...methodEntries.map(([name, method]) => `  ${name}${method.signature}`),
    '}',
    `type ${programName} = (api: ${apiName}) => unknown | Promise<unknown>`,
  ]
    .filter((declaration): declaration is string => declaration !== undefined && declaration.length > 0)
    .join('\n\n')
  const typeDeclarationHelp =
    typeDeclarations === undefined || typeDeclarations.length === 0
      ? ''
      : `\n\n## Type declarations\n\n\`\`\`typescript\n${typeDeclarations}\n\`\`\``
  const methodHelp = new Map(
    methodEntries.map(([name, method]) => {
      const parameterSchema =
        method.parameters === undefined
          ? ''
          : `\n\nParameter schema:\n\n\`\`\`json\n${JSON.stringify(method.parameters, null, 2)}\n\`\`\``
      return [
        name,
        `# ${options.toolName}.${name}${method.signature}\n\n${method.description}${typeDeclarationHelp}${parameterSchema}`,
      ] as const
    }),
  )
  const exampleHelp =
    options.examples === undefined || options.examples.length === 0
      ? ''
      : `\n\n## Examples\n\n${options.examples
          .map((example, index) => `### Example ${index + 1}\n\n\`\`\`typescript\n${example}\n\`\`\``)
          .join('\n\n')}`
  const helpOverview = `# ${options.toolName} API overview

${options.description}

## Operations

${methodEntries.map(([name, method]) => `- \`${name}\`: ${method.description}`).join('\n')}

API type: \`${apiName}\`.
Program type: \`${programName}\`.

Call \`api.help("operation")\` for an operation signature and parameter schema.${exampleHelp}`
  const codeModeDefinition: CodeModeDefinition = {
    apiName,
    programName,
    declarations,
    methods: [{ name: 'help', kind: 'sync' }, ...methodEntries.map(([name]) => ({ name, kind: 'async' as const }))],
    examples: options.examples ?? [],
  }
  const codeModeCore = createCodeModeCore<Services, CodeModeFailure | Failure>()
  const codeModeHost = CodeModeEffectHost<Services, CodeModeFailure | Failure>()
  const host = {
    invoke: (
      methodName: string,
      args: readonly unknown[],
      signal: AbortSignal,
      runContext: RunContext,
    ): Effect.Effect<unknown, CodeModeFailure | Failure, Services> => {
      const method = Object.hasOwn(options.methods, methodName) ? options.methods[methodName] : undefined
      if (method === undefined) {
        return Effect.fail(
          createCodeModeFailure({
            _tag: 'validation',
            operation: methodName,
            message: `The operation ${methodName} is not defined.`,
          }),
        )
      }
      if (method.parameters === undefined) {
        if (args.length !== 0) {
          return Effect.fail(
            createCodeModeFailure({
              _tag: 'validation',
              operation: methodName,
              message: `The operation ${methodName} does not accept parameters.`,
            }),
          )
        }
        return method.execute(undefined as never, signal, runContext)
      }
      if (args.length !== 1 || !Check(method.parameters, args[0])) {
        return Effect.fail(
          createCodeModeFailure({
            _tag: 'validation',
            operation: methodName,
            message: `The parameters for operation ${methodName} are invalid.`,
          }),
        )
      }
      return method.execute(args[0] as never, signal, runContext)
    },
    invokeSync: (methodName: string, args: readonly unknown[]): unknown => {
      if (methodName === 'help') {
        if (args.length === 0) return helpOverview
        if (args.length === 1 && typeof args[0] === 'string') {
          const operationHelp = methodHelp.get(args[0])
          if (operationHelp !== undefined) return operationHelp
          throw createCodeModeFailure({
            _tag: 'validation',
            operation: 'help',
            message: `The operation ${args[0]} is not defined. Available operations: ${methodEntries.map(([name]) => name).join(', ')}.`,
          })
        }
        throw createCodeModeFailure({
          _tag: 'validation',
          operation: 'help',
          message: 'The help method accepts no arguments or one method name.',
        })
      }
      throw createCodeModeFailure({
        _tag: 'validation',
        operation: methodName,
        message: `The operation ${methodName} is not synchronous.`,
      })
    },
    ...(options.errorCodec === undefined ? {} : { errorCodec: options.errorCodec }),
  }
  const runParameters = Type.Object({
    code: Type.String({ description: 'A TypeScript program that exports a default function.' }),
  })
  const runTool: EffectToolDefinition<
    typeof runParameters,
    Services,
    CodeModeFailure | Failure,
    CodeModeToolOutputDetails
  > = {
    name: options.toolName,
    label: options.label ?? options.toolName,
    description: options.description,
    parameters: runParameters,
    promptSnippet: `Run TypeScript against the ${options.toolName} API.`,
    promptGuidelines: [
      'Export a default async function that receives the API object.',
      'Call api.help() to list available operations.',
      'Call api.help("operation") for its signature and parameter schema.',
    ],
    ...createCodeModeRenderers<typeof runParameters>(options.label ?? options.toolName),
    execute: ({
      code,
    }): Effect.Effect<PiToolResult<CodeModeToolOutputDetails>, CodeModeFailure | Failure, Services | PiToolContext> =>
      Effect.gen(function* () {
        const context = yield* PiToolContext
        const run = (
          runContext: RunContext,
        ): Effect.Effect<PiToolResult<CodeModeToolOutputDetails>, CodeModeFailure | Failure, Services> =>
          Effect.gen(function* () {
            const operations = new Map<string, number>()
            const invocationHost = {
              ...host,
              invoke: (
                methodName: string,
                args: readonly unknown[],
                signal: AbortSignal,
              ): Effect.Effect<unknown, CodeModeFailure | Failure, Services> =>
                Effect.gen(function* () {
                  yield* Effect.sync(() => {
                    operations.set(methodName, (operations.get(methodName) ?? 0) + 1)
                  })
                  return yield* host.invoke(methodName, args, signal, runContext)
                }),
            }
            const runOptions: CodeModeRunOptions = {
              cwd: context.cwd,
              filenamePrefix: options.toolName,
              timeoutMs: options.timeoutMs,
              signal: context.toolSignal,
              ...(options.execution === undefined ? {} : { execution: options.execution }),
            }
            const result = yield* Effect.provideService(
              codeModeCore.evaluate(codeModeDefinition, code, runOptions),
              codeModeHost,
              invocationHost,
            )
            return yield* createCodeModeToolOutput(
              result,
              outputLimits,
              Object.fromEntries(operations),
              context.toolSignal,
            )
          })
        return yield* options.withRun === undefined
          ? run(undefined as RunContext)
          : options.withRun(run, context.toolSignal)
      }),
  }
  const register = (
    registry: PiToolRegistry<Services, CodeModeFailure | Failure>,
  ): Effect.Effect<void, PiRegistrationError> =>
    Effect.gen(function* () {
      yield* registry.register(runTool)
    })

  return {
    toolName: options.toolName,
    register,
  }
}

export {
  type CodeModeMethodDefinition,
  type CodeModeTool,
  type CodeModeToolDefinition,
  createCodeModeTool,
  defineCodeModeMethod,
}
