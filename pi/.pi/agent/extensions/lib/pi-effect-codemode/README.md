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

```ts
import type { CodeModeFailure } from '@eratio/pi-codemode-core'
import { createTool, defineMethod, PiExtension } from '@eratio08/pi-effect-codemode'
import { Effect } from 'effect'
import { Type } from 'typebox'

const addParameters = Type.Object({ title: Type.String() })

const tool = createTool<never, never>({
  toolName: 'tasks',
  description: 'Manage task records.',
  timeoutMs: 30_000,
  outputLimits: { maxBytes: 20_000, maxLines: 300 },
  typeDeclarations: 'type Task = { id: string; title: string }',
  examples: ['export default async (api: tasksApi) => api.add({ title: "Review" })'],
  methods: {
    add: defineMethod({
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

## Tool output
Each successful run includes an `operations` field in its result details.
The field lists each declared method that the submitted code called and its call count.
Calls to `api.help()` do not appear in these counts.
For successful runs, the collapsed view shows the tool label and a one-line operation summary.
The expanded view shows the submitted code, the operation summary, and the returned text.
While a run is active, Pi shows `Running...`.
If a run fails, Pi shows the error text, and the expanded view also shows the submitted code.
If output is truncated, the expanded view shows the truncated text and the path to the complete result file.

### Example output
For the `tasks` tool above, the submitted code is:

```typescript
export default async (api: tasksApi) => api.add({ title: "Review" })
```

The collapsed call for this run looks like this:

```text
tasks · add: 1 <configured expand key> to expand
```

Pi shows the current `app.tools.expand` key in place of the placeholder.
When expanded, the result looks like this:

```text
Operations
add: 1

Code
export default async (api: tasksApi) => api.add({ title: "Review" })

Result
{
  "id": "task-1",
  "title": "Review"
}
```

## Help API
The submitted program can call `api.help()` synchronously.
It is not a separate Pi tool. The SDK registers one runner under `toolName`.
Call `api.help()` to see the operation list, descriptions, generated API and program type names, and configured examples.
Call `api.help("operation")` to see that method's signature and description.
The response includes configured type declarations and the parameter schema when the method has parameters.
The method name `help` is reserved for this generated reference.

### Example output
For the `tasks` tool above, `api.help("add")` returns:

````text
# tasks.add(params: { title: string }): Promise<Task>

Create a task record.

## Type declarations

```typescript
type Task = { id: string; title: string }
```

Parameter schema:

```json
{
  "type": "object",
  "required": [
    "title"
  ],
  "properties": {
    "title": {
      "type": "string"
    }
  }
}
```
````

## Method definitions
`signature` is appended to the API type named from `toolName`, such as `tasksApi`.
`parameters` is the TypeBox schema for the method's single argument, and the SDK checks it before it runs the handler.
Omit `parameters` and use `()` in `signature` when a method takes no arguments.
The handler receives the validated parameter value, the current `AbortSignal`, and the run context as its third argument.
The context type is the third generic for `defineMethod` and defaults to `void`.
The handler returns an Effect, so it can use the services and typed failures that the SDK generics declare.

### Scope one tool run
Set the third generic for `createTool` when methods need one context shared by every call in a program.
A non-`void` context requires `withRun`.
Set `withRun` to wrap the complete program run, including output formatting, and pass the context to `run(context)`. The callback also receives the active tool signal when one is available.
The SDK passes that context to every method handler in the run.
If `withRun` is omitted with the default `void` context, the SDK passes `undefined` and keeps the existing execution mode.

## Runtime settings
`timeoutMs` sets the evaluation deadline.
`outputLimits` optionally overrides the maximum result size in bytes and lines for the runner tool.
The SDK uses Pi's default output limits when `outputLimits` is not set.
When the SDK truncates output, the tool result includes the temporary file path and the line and byte counts.
The SDK uses the Pi tool context for the working directory and cancellation signal.
The core uses worker execution by default, and `execution: 'in-process'` selects in-process execution.
Provide `errorCodec` when worker execution must preserve custom method failures across worker transport.
