import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  keyHint,
  type ToolExecutionMode,
  truncateHead,
  withFileMutationQueue,
} from '@earendil-works/pi-coding-agent'
import { type Component, Container, Text } from '@earendil-works/pi-tui'
import {
  createProgramFailure,
  createProgramRunner,
  type ProgramDefinition,
  type ProgramFailure,
  ProgramHost,
  type ProgramHostErrorCodec,
  type ProgramRunOptions,
} from '@eratio/pi-codemode-core'
import { formatValue, type OutputLimits } from '@eratio/pi-codemode-core/output'
import {
  type EffectToolDefinition,
  type PiRegistrationError,
  type PiServices,
  PiToolContext,
  type PiToolRegistry,
  type PiToolResult,
} from '@eratio/pi-effect'
import { Effect } from 'effect'
import { type Static, type TSchema, Type } from 'typebox'
import { Check } from 'typebox/value'

/**
 * Defines one method that a submitted TypeScript program can call.
 *
 * @typeParam Params - The TypeBox schema for the method arguments, or `undefined` for no arguments.
 * @typeParam Services - Additional Effect services required by the method handler.
 * @typeParam Failure - The typed failure returned by the method handler.
 * @typeParam RunContext - The context shared by method calls during one program run.
 * @typeParam OptionalParameters - Whether a schema-backed argument can be omitted.
 */
type MethodDefinition<
  Params extends TSchema | undefined,
  Services,
  Failure,
  RunContext = void,
  OptionalParameters extends boolean = false,
> = {
  /** Shows this text in the overall operation list and in `api.help("method")`. */
  readonly description: string
  /** Adds this call signature to the generated API type and the operation-help heading. */
  readonly signature: string
  /** Validates arguments before handler execution and adds the schema to operation help. Omit it for no arguments. */
  readonly parameters?: Params
  /**
   * Allows a schema-backed single argument to be omitted or passed as `undefined`.
   * The handler receives `undefined` in either case.
   */
  readonly optionalParameters?: Params extends TSchema ? OptionalParameters : never
  /**
   * Runs after parameter validation and returns the method's Effect.
   *
   * @param params - Validated arguments, or `undefined` for no arguments or an omitted optional argument.
   * @param signal - Abort signal for the active tool call.
   * @param runContext - Context shared by method calls in the submitted program.
   * @returns Effect that returns the method result and declares its failure and service requirements.
   */
  readonly execute: (
    params: Params extends TSchema
      ? OptionalParameters extends true
        ? Static<Params> | undefined
        : Static<Params>
      : undefined,
    signal: AbortSignal,
    runContext: RunContext,
  ) => Effect.Effect<unknown, Failure, Services | PiServices>
}

type MethodInput<Services, Failure, RunContext = void> = {
  readonly description: string
  readonly signature: string
  readonly parameters?: TSchema
  readonly optionalParameters?: boolean
  readonly execute: (
    params: never,
    signal: AbortSignal,
    runContext: RunContext,
  ) => Effect.Effect<unknown, Failure, Services | PiServices>
}

type ToolOutputDetails = {
  readonly truncated: boolean
  readonly outputBytes: number
  readonly outputLines: number
  readonly totalBytes: number
  readonly totalLines: number
  readonly fullOutputPath?: string
  readonly operations?: Readonly<Record<string, number>>
}

/**
 * Configures a Pi tool that runs submitted TypeScript against Effect-backed methods.
 *
 * @typeParam Services - Additional Effect services required by method handlers and `withRun`.
 * @typeParam Failure - Typed failures returned by method handlers and `withRun`.
 * @typeParam RunContext - Context created by `withRun` and passed to each method handler. Defaults to `void`.
 *
 * @remarks
 * At least one method is required, and `help` is reserved for the generated API reference.
 * A non-`void` `RunContext` requires `withRun`.
 */
type ToolDefinition<Services, Failure, RunContext = void> = {
  /**
   * Names the registered Pi tool and appears in help headings and generated API/program types.
   * It also prefixes evaluation file names.
   */
  readonly toolName: string
  /** Sets the label in Pi's tool call and result views. Defaults to `toolName`. */
  readonly label?: string
  /** Sets the Pi tool description and the text in the overall `api.help()` response. */
  readonly description: string
  /** Sets the prompt hint for Pi. The default names the configured `toolName` API. */
  readonly promptSnippet?: string
  /** Replaces the default instructions Pi shows for calls to this tool. */
  readonly promptGuidelines?: readonly string[]
  /** Defines the operations exposed in the generated API, listed in help, and dispatched to handlers. */
  readonly methods: Readonly<Record<string, MethodInput<Services, Failure, RunContext>>>
  /** Adds declarations to the generated program API and includes them in operation-specific help. */
  readonly typeDeclarations?: string
  /**
   * Lists code examples in an Examples section of the overall `api.help()` response.
   * These examples do not appear in `api.help("method")` responses.
   */
  readonly examples?: readonly string[]
  /** Sets the deadline for each submitted-program evaluation, in milliseconds. */
  readonly timeoutMs: number
  /**
   * Sets output byte and line limits; unspecified values use Pi's defaults.
   * Truncated output is saved to a temporary file.
   */
  readonly outputLimits?: Partial<OutputLimits>
  /** Selects whether Pi schedules this tool sequentially or in parallel. */
  readonly executionMode?: ToolExecutionMode
  /** Selects how the code runner evaluates submitted code. The default uses a worker; `in-process` uses the host process. */
  readonly execution?: ProgramRunOptions['execution']
  /** Lets worker execution preserve custom method failures across worker transport. */
  readonly errorCodec?: ProgramHostErrorCodec<ProgramFailure | Failure>
  /**
   * Wraps the full program run, including output formatting, and supplies its shared context.
   *
   * @param run - Runs the program with a context that is passed to every method handler.
   * @param signal - Active tool cancellation signal, or `undefined` when it is unavailable.
   * @returns Effect for the wrapped program run.
   */
  readonly withRun?: (
    run: (
      runContext: RunContext,
    ) => Effect.Effect<PiToolResult<ToolOutputDetails>, ProgramFailure | Failure, Services | PiServices>,
    signal: AbortSignal | undefined,
  ) => Effect.Effect<PiToolResult<ToolOutputDetails>, ProgramFailure | Failure, Services | PiServices>
}

/**
 * A tool created by `createTool`, ready to register with a Pi tool registry.
 *
 * @typeParam Services - Additional Effect services required by the tool's method handlers.
 * @typeParam _Failure - The typed failure associated with the tool's method handlers.
 */
type RegisteredTool<Services, _Failure> = {
  /** Name Pi uses to identify the registered tool. */
  readonly toolName: string
  /**
   * Registers the tool with a Pi registry.
   *
   * @param registry - Registry that receives the tool.
   * @returns Effect that completes registration or fails with `PiRegistrationError`.
   */
  readonly register: (registry: PiToolRegistry<Services>) => Effect.Effect<void, PiRegistrationError>
}

function createToolOutput(
  value: unknown,
  outputLimits: OutputLimits,
  operations: Readonly<Record<string, number>>,
  toolSignal?: AbortSignal,
): Effect.Effect<PiToolResult<ToolOutputDetails>, ProgramFailure> {
  const fullOutput = formatValue(value)
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
      try: async (effectSignal: AbortSignal) => {
        const signal = toolSignal === undefined ? effectSignal : AbortSignal.any([toolSignal, effectSignal])
        const tempDirectory = await mkdtemp(join(tmpdir(), 'pi-effect-codemode-'))
        const outputPath = join(tempDirectory, 'output.txt')
        await withFileMutationQueue(outputPath, async () => {
          await writeFile(outputPath, fullOutput, { encoding: 'utf8', signal })
        })
        return outputPath
      },
      catch: (cause: unknown) =>
        createProgramFailure({
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

function createToolRenderers<Params extends TSchema>(
  toolLabel: string,
): Pick<EffectToolDefinition<Params, never, never, ToolOutputDetails>, 'renderCall' | 'renderResult'> {
  type RendererState = {
    call?: Text
    callText?: string
    hasResult?: boolean
    summary?: string
  }
  type RenderCallParameters = Parameters<
    NonNullable<EffectToolDefinition<Params, never, never, ToolOutputDetails>['renderCall']>
  >
  type RenderResultParameters = Parameters<
    NonNullable<EffectToolDefinition<Params, never, never, ToolOutputDetails>['renderResult']>
  >
  return {
    renderCall: (
      _args: RenderCallParameters[0],
      theme: RenderCallParameters[1],
      context: RenderCallParameters[2],
    ): Component => {
      const state = (context.state ?? {}) as RendererState
      const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0)
      state.call = text
      state.callText = theme.fg('toolTitle', theme.bold(toolLabel))
      const summary = !context.expanded && state.hasResult && state.summary ? ` · ${state.summary}` : ''
      const hint = !context.expanded && state.hasResult ? ` ${keyHint('app.tools.expand', 'to expand')}` : ''
      text.setText(`${state.callText}${summary}${hint}`)
      return text
    },
    renderResult: (
      result: RenderResultParameters[0],
      { expanded, isPartial }: RenderResultParameters[1],
      theme: RenderResultParameters[2],
      context: RenderResultParameters[3],
    ): Component => {
      if (isPartial) return new Text(theme.fg('warning', 'Running...'), 0, 0)
      const details = result.details as ToolOutputDetails | undefined
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
          .join(' · ') || 'no operations'
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

/**
 * Returns a method definition unchanged and preserves its inferred types.
 *
 * @typeParam Params - The TypeBox schema for the method arguments, or `undefined` for no arguments.
 * @typeParam Services - Additional Effect services required by the method handler.
 * @typeParam Failure - The typed failure returned by the method handler.
 * @typeParam RunContext - The context passed to the method handler during each program run.
 * @param method - The method definition to preserve.
 * @returns The same method definition.
 *
 * @remarks
 * This helper performs no runtime validation.
 * Set `optionalParameters` to `true` when a schema-backed single argument is optional.
 */
function defineMethod<Params extends TSchema, Services = never, Failure = never, RunContext = void>(
  method: MethodDefinition<Params, Services, Failure, RunContext, true> & { readonly optionalParameters: true },
): MethodDefinition<Params, Services, Failure, RunContext, true>
function defineMethod<
  Params extends TSchema | undefined = undefined,
  Services = never,
  Failure = never,
  RunContext = void,
>(
  method: MethodDefinition<Params, Services, Failure, RunContext, false>,
): MethodDefinition<Params, Services, Failure, RunContext, false>
function defineMethod<
  Params extends TSchema | undefined = undefined,
  Services = never,
  Failure = never,
  RunContext = void,
  OptionalParameters extends boolean = false,
>(
  method: MethodDefinition<Params, Services, Failure, RunContext, OptionalParameters>,
): MethodDefinition<Params, Services, Failure, RunContext, OptionalParameters> {
  return method
}

/**
 * Creates a Pi tool that runs submitted TypeScript against the configured methods.
 *
 * @typeParam Services - Additional Effect services required by method handlers and `withRun`.
 * @typeParam Failure - Typed failures returned by method handlers and `withRun`.
 * @typeParam RunContext - Context shared by method calls in one program run. Defaults to `void`.
 * @param options - Tool configuration that controls generated help, validation, execution, and metadata.
 * @returns A registration handle. Pi registers the tool when its `register` effect runs.
 * @throws TypeError - If `methods` is empty or includes the reserved `help` name.
 *
 * @remarks
 * A non-`void` `RunContext` requires `options.withRun`.
 * Pi runtime services are available to handlers and `withRun` without adding them to `Services`.
 * The SDK validates schema-backed arguments before it calls a method handler.
 */
function createTool<Services = never, Failure = never>(
  options: ToolDefinition<Services, Failure>,
): RegisteredTool<Services, Failure>
function createTool<Services, Failure, RunContext>(
  options: ToolDefinition<Services, Failure, RunContext> & {
    readonly withRun: NonNullable<ToolDefinition<Services, Failure, RunContext>['withRun']>
  },
): RegisteredTool<Services, Failure>
function createTool<Services = never, Failure = never, RunContext = void>(
  options: ToolDefinition<Services, Failure, RunContext>,
): RegisteredTool<Services, Failure> {
  const methodEntries = Object.entries(options.methods)
  if (methodEntries.length === 0) throw new TypeError('At least one operation is required.')
  if (Object.hasOwn(options.methods, 'help')) throw new TypeError('The method name "help" is reserved.')

  const outputLimits: OutputLimits = {
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
  const definition: ProgramDefinition = {
    apiName,
    programName,
    declarations,
    methods: [{ name: 'help', kind: 'sync' }, ...methodEntries.map(([name]) => ({ name, kind: 'async' as const }))],
    examples: options.examples ?? [],
  }
  const core = createProgramRunner<Services | PiServices, ProgramFailure | Failure>()
  const hostService = ProgramHost<Services | PiServices, ProgramFailure | Failure>()
  const host = {
    invoke: (
      methodName: string,
      args: readonly unknown[],
      signal: AbortSignal,
      runContext: RunContext,
    ): Effect.Effect<unknown, ProgramFailure | Failure, Services | PiServices> => {
      const method = Object.hasOwn(options.methods, methodName) ? options.methods[methodName] : undefined
      if (method === undefined) {
        return Effect.fail(
          createProgramFailure({
            _tag: 'validation',
            operation: methodName,
            message: `The operation ${methodName} is not defined.`,
          }),
        )
      }
      if (method.parameters === undefined) {
        if (args.length !== 0) {
          return Effect.fail(
            createProgramFailure({
              _tag: 'validation',
              operation: methodName,
              message: `The operation ${methodName} does not accept parameters.`,
            }),
          )
        }
        return method.execute(undefined as never, signal, runContext)
      }
      if (method.optionalParameters && args.length <= 1 && args[0] === undefined) {
        return method.execute(undefined as never, signal, runContext)
      }
      const tupleParameters = Array.isArray((method.parameters as TSchema & { items?: unknown }).items)
      const validParameters = tupleParameters
        ? Check(method.parameters, args)
        : args.length === 1 && Check(method.parameters, args[0])
      if (!validParameters) {
        return Effect.fail(
          createProgramFailure({
            _tag: 'validation',
            operation: methodName,
            message: `The parameters for operation ${methodName} are invalid.`,
          }),
        )
      }
      return method.execute((tupleParameters ? args : args[0]) as never, signal, runContext)
    },
    invokeSync: (methodName: string, args: readonly unknown[]): unknown => {
      if (methodName === 'help') {
        if (args.length === 0) return helpOverview
        if (args.length === 1 && typeof args[0] === 'string') {
          const operationHelp = methodHelp.get(args[0])
          if (operationHelp !== undefined) return operationHelp
          throw createProgramFailure({
            _tag: 'validation',
            operation: 'help',
            message: `The operation ${args[0]} is not defined. Available operations: ${methodEntries.map(([name]) => name).join(', ')}.`,
          })
        }
        throw createProgramFailure({
          _tag: 'validation',
          operation: 'help',
          message: 'The help method accepts no arguments or one method name.',
        })
      }
      throw createProgramFailure({
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
    Services | PiServices,
    ProgramFailure | Failure,
    ToolOutputDetails
  > = {
    name: options.toolName,
    label: options.label ?? options.toolName,
    description: options.description,
    ...(options.executionMode === undefined ? {} : { executionMode: options.executionMode }),
    parameters: runParameters,
    promptSnippet: options.promptSnippet ?? `Run TypeScript against the ${options.toolName} API.`,
    promptGuidelines: [
      ...(options.promptGuidelines ?? [
        'Export a default async function that receives the API object.',
        'Call api.help() to list available operations.',
        'Call api.help("operation") for its signature and parameter schema.',
      ]),
    ],
    ...createToolRenderers<typeof runParameters>(options.label ?? options.toolName),
    execute: ({
      code,
    }: Static<typeof runParameters>): Effect.Effect<
      PiToolResult<ToolOutputDetails>,
      ProgramFailure | Failure,
      Services | PiServices | PiToolContext
    > =>
      Effect.gen(function* () {
        const context = yield* PiToolContext
        const run = (
          runContext: RunContext,
        ): Effect.Effect<PiToolResult<ToolOutputDetails>, ProgramFailure | Failure, Services | PiServices> =>
          Effect.gen(function* () {
            const operations = new Map<string, number>()
            const invocationHost = {
              ...host,
              invoke: (
                methodName: string,
                args: readonly unknown[],
                signal: AbortSignal,
              ): Effect.Effect<unknown, ProgramFailure | Failure, Services | PiServices> =>
                Effect.gen(function* () {
                  yield* Effect.sync(() => {
                    operations.set(methodName, (operations.get(methodName) ?? 0) + 1)
                  })
                  return yield* host.invoke(methodName, args, signal, runContext)
                }),
            }
            const runOptions: ProgramRunOptions = {
              cwd: context.cwd,
              filenamePrefix: options.toolName,
              timeoutMs: options.timeoutMs,
              signal: context.toolSignal,
              ...(options.execution === undefined ? {} : { execution: options.execution }),
            }
            const result = yield* Effect.provideService(
              core.evaluate(definition, code, runOptions),
              hostService,
              invocationHost,
            )
            return yield* createToolOutput(result, outputLimits, Object.fromEntries(operations), context.toolSignal)
          })
        return yield* options.withRun === undefined
          ? run(undefined as RunContext)
          : options.withRun(run, context.toolSignal)
      }),
  }
  const register = (registry: PiToolRegistry<Services>): Effect.Effect<void, PiRegistrationError> =>
    Effect.gen(function* () {
      yield* registry.register(runTool)
    })

  return {
    toolName: options.toolName,
    register,
  }
}

export { createTool, defineMethod, type MethodDefinition, type RegisteredTool, type ToolDefinition }
