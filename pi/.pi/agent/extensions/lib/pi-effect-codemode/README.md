# @eratio08/pi-effect-codemode
The published bundle includes `@eratio08/pi-effect` and `@eratio/pi-codemode-core`.
`@eratio08/pi-effect-codemode` connects `@eratio08/pi-effect` with `@eratio/pi-codemode-core`.
It registers one TypeScript runner tool from the supplied method definitions.
The generated API includes synchronous `api.help()` and `api.help("operation")` methods.

## Create a code-mode tool
A TypeBox schema describes the input that a method accepts.
A TypeScript signature shows how a code-mode program calls the method.
An Effect describes work that can use plugin services and return typed failures.
The SDK validates method arguments and passes the tool abort signal to each handler.
The SDK truncates large output with Pi's limits and writes the full result to a temporary file when it truncates output.
The runner tool uses the configured `toolName`.
`api.help()` lists the available operations and their descriptions.
`api.help("operation")` returns that operation's signature and parameter schema, plus configured type declarations.

```ts
import type { CodeModeFailure } from '@eratio/pi-codemode-core'
import { createCodeModeTool, defineCodeModeMethod, PiExtension } from '@eratio08/pi-effect-codemode'
import { Effect } from 'effect'
import { Type } from 'typebox'

const addParameters = Type.Object({ title: Type.String() })

const tool = createCodeModeTool<never, never>({
  toolName: 'tasks',
  description: 'Manage task records.',
  timeoutMs: 30_000,
  outputLimits: { maxBytes: 20_000, maxLines: 300 },
  typeDeclarations: 'type Task = { id: string; title: string }',
  examples: ['export default async (api: tasksApi) => api.add({ title: "Review" })'],
  methods: {
    add: defineCodeModeMethod({
      description: 'Create a task record.',
      signature: '(params: { title: string }): Promise<Task>',
      parameters: addParameters,
      execute: ({ title }) => Effect.succeed({ id: 'task-1', title }),
    }),
  },
})

export default PiExtension.install(
  PiExtension.define<CodeModeFailure>({
    id: 'tasks',
    effect: ({ tools }) => tool.register(tools),
  }),
)
```

The model can call `api.help()` from inside `tasks` code to see the operation list.
It can call `api.help("add")` to see that operation's signature and parameter schema.
The method name `help` is reserved for this generated reference.

## Method definitions
`signature` is appended to the API type named from `toolName`, such as `tasksApi`.
`parameters` is the TypeBox schema for the method's single argument, and the SDK checks it before it runs the handler.
Omit `parameters` and use `()` in `signature` when a method takes no arguments.
The handler receives the validated parameter value and the current `AbortSignal`.
The handler returns an Effect, so it can use the services and typed failures that the SDK generics declare.

## Runtime settings
`timeoutMs` sets the evaluation deadline.
`outputLimits` optionally overrides the maximum result size in bytes and lines for the runner tool.
The SDK uses Pi's default output limits when `outputLimits` is not set.
When the SDK truncates output, the tool result includes the temporary file path and the line and byte counts.
The SDK uses the Pi tool context for the working directory and cancellation signal.
The core uses worker execution by default, and `execution: 'in-process'` selects in-process execution.
Provide `errorCodec` when worker execution must preserve custom method failures across worker transport.
