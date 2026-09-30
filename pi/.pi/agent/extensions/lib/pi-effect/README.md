# @eratio/pi-effect

`@eratio/pi-effect` is an SDK for writing Pi extensions with EffectJS.
It gives extension code typed services, typed errors, and managed lifecycle handling for Pi API calls.

## Requirements

You need Bun and a Pi extension project.
You need the EffectJS 4 release candidate.
The package declares these peer dependencies:

- `effect` with the range `^4.0.0-0`.
- `@earendil-works/pi-coding-agent` for Pi extension types and APIs.
- `@earendil-works/pi-ai` for model and provider types.
- `@earendil-works/pi-tui` for TUI types.
- `typebox` for tool parameter schemas.

Install the adapter and EffectJS:

```bash
bun add @eratio/pi-effect effect@rc
```

Pi provides its API packages and TypeBox at runtime.
Add them as development dependencies only when local type checking needs them:

```bash
bun add --dev @earendil-works/pi-ai @earendil-works/pi-coding-agent @earendil-works/pi-tui typebox
```

## Quick start

An EffectJS program describes work that can use services and return typed errors.
A service tag identifies one service that an EffectJS program can request.

Create a plugin with `PiExtension.define` and export the result of `PiExtension.install`:

```ts
import { Pi, PiExtension } from '@eratio/pi-effect'
import { Effect } from 'effect'

const plugin = PiExtension.define({
  id: 'example',
  effect: ({ commands, events }) =>
    Effect.gen(function* () {
      yield* commands.register('hello', {
        description: 'Show a greeting.',
        handler: () =>
          Effect.gen(function* () {
            const pi = yield* Pi
            yield* pi.ui.notify('Hello from Pi and EffectJS.', 'info')
          }),
      })

      yield* events.on('session_start', () =>
        Effect.gen(function* () {
          const pi = yield* Pi
          yield* pi.ui.setStatus('example', 'Ready')
        }).pipe(Effect.as(undefined)),
      )
    }),
})

export default PiExtension.install(plugin)
```

`PiExtension.install` returns the `ExtensionFactory` that Pi loads.
The adapter runs the setup program once and provides the Pi services to every registered callback.

## Plugin definition

`PiExtension.define` accepts an object with these fields:

- `id` is the stable identifier for the plugin.
- `layer` supplies custom EffectJS services to the plugin.
- `effect` registers events, commands, shortcuts, flags, tools, and renderers.

The setup program receives its registration context as an argument.
Use this context to register Pi features.
Registered callbacks request their dependencies through EffectJS service tags.

A Layer supplies services to an EffectJS program.
A plugin layer can require `PiOperations` or stable Pi services such as `PiMessages`, `PiTools`, `PiFlags`, and `PiProcess` while the adapter builds the layer.
An invocation is one Pi call to a handler.
Invocation-scoped services exist only during that call.
The adapter supplies these services to each event, command, or tool handler through matching service tags.
A plugin layer cannot require `Pi`, `PiContext`, `PiSessionContext`, `PiCommandContext`, `PiToolContext`, `PiSession`, or `PiUi` because the adapter builds it before handlers run.
The setup program can use stable Pi services during registration, but not invocation-scoped services.
The adapter builds the plugin layer once and keeps its resources until shutdown.

Use a custom layer when the extension owns state or another long-lived service:

```ts
import { Context, Effect, Layer } from 'effect'
import { PiExtension } from '@eratio/pi-effect'

class Greeting extends Context.Service<Greeting, { readonly text: string }>()('example/Greeting') {}

const plugin = PiExtension.define<Greeting>({
  id: 'example',
  layer: Layer.succeed(Greeting, { text: 'Hello from a custom service.' }),
  effect: ({ commands }) =>
    Effect.gen(function* () {
      const greeting = yield* Greeting
      yield* commands.register('hello', {
        handler: () => Effect.sync(() => console.log(greeting.text)),
      })
    }),
})

export default PiExtension.install(plugin)
```

Do not call `Effect.runPromise` or create a local runtime in extension domain code.
`PiExtension.install` owns the runtime and runs every registered EffectJS program.

## Registration API

The setup program receives a registration context with these registries.
Each registry calls the matching Pi extension method.
See [Pi's extension documentation](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/extensions.md#choose-an-integration-point) for the native registration methods.

| EffectJS registry | Pi extension method | Purpose |
| --- | --- | --- |
| `events.on` | `pi.on` | Registers a typed Pi event handler. |
| `commands.register` | `pi.registerCommand` | Registers a command and optional argument completions. |
| `shortcuts.register` | `pi.registerShortcut` | Registers a keyboard shortcut. |
| `flags.register` | `pi.registerFlag` | Registers a boolean or string flag. |
| `tools.register` | `pi.registerTool` | Registers an EffectJS tool. |
| `renderers.message` | `pi.registerMessageRenderer` | Registers a custom message renderer. |
| `renderers.entry` | `pi.registerEntryRenderer` | Registers a custom session entry renderer. |

Each registration method returns an EffectJS program that fails with `PiRegistrationError` when Pi rejects the registration.
Use `yield*` inside the setup program to run registration programs in order.

### Event failure policies

Set `options.failure` when an event needs a policy that differs from the default:

```ts
yield* events.on(
  'tool_call',
  (event) => Effect.succeed({ block: event.toolName === 'unsafe-tool' }),
  { failure: 'failClosed' },
)
```

The available policies are:

| Policy | Behavior when the handler fails |
| --- | --- |
| `propagate` | Returns the failure to Pi. |
| `neutral` | Ignores the failed handler result and keeps the event neutral. |
| `failClosed` | Rejects the action. |

The adapter uses neutral handling for observation and transform events by default.
The adapter uses fail-closed handling for `tool_call` by default.
The adapter uses neutral handling for `project_trust` and `input` by default.

## Pi services

The `Pi` service is a facade that groups the services available to an extension.
Use the smaller service tags when a function needs one capability.

```ts
import { PiContext, PiSession, PiUi } from '@eratio/pi-effect'
import { Effect } from 'effect'

const readSession = Effect.gen(function* () {
  const context = yield* PiContext
  const session = yield* PiSession
  const ui = yield* PiUi

  yield* ui.setStatus('example', `Running in ${context.mode}`)
  return yield* session.entries()
})
```

Callable tools are tools that Pi lets another tool run.

The main service tags are:

| Service tag | Provides |
| --- | --- |
| `Pi` | Groups all services that the extension can use. |
| `PiContext` | Provides mode, UI availability, working directory, model state, and EffectJS operations for idle state, trust, messages, context usage, abort, shutdown, compaction, and prompt reads. |
| `PiSessionContext` | Provides the current session snapshot and operations to read entries, branches, context entries, and labels. |
| `PiCommandContext` | Provides system prompt options and controls for forking, tree navigation, session switching, and reloading. |
| `PiToolContext` | Provides the current tool call, validated parameters, abort signal, progress updates, callable tools, nested calls, and execution mode. |
| `PiSession` | Provides operations for session entries, branches, labels, names, and context entries. |
| `PiMessages` | Sends custom messages and user messages. |
| `PiUi` | Provides dialogs, notifications, widgets, editor access, themes, and TUI operations. |
| `PiTools` | Reads all tools and replaces the active tool list. |
| `PiFlags` | Reads execution-time flag values. |
| `PiProcess` | Runs a process through Pi. |

The `Pi` facade also provides `model.set` and the low-level Pi event bus.
Pi's [extension documentation](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/extensions.md#choose-an-integration-point) describes `pi.events` as the API for communication between extensions.
Event emission and subscription return EffectJS programs that fail with `PiOperationsError` when Pi rejects an operation.
The event bus uses raw channel data and is intended for coordination with other Pi extensions.
`events.on` returns an EffectJS program that removes a subscription when it ends.
`events.onScoped` registers a subscription in the current EffectJS scope and removes it when the scope closes.
Use `events.onScoped` with `Effect.scoped` when the subscription lifetime must follow a scope.

All Pi operations return EffectJS programs when they can fail or require an abort signal.
The adapter maps Pi operation failures to typed errors.

## Session state

Use `PiSession` to persist state that must survive session reloads or session changes:

```ts
import { PiSession } from '@eratio/pi-effect'
import { Effect } from 'effect'

const saveState = Effect.gen(function* () {
  const session = yield* PiSession
  yield* session.appendEntry('example/state', { enabled: true })
  yield* session.setName('Example session')
})
```

Use session entries for state that must survive process exit.
Use EffectJS service state for resources that only live for one installed plugin.

## EffectJS tools

An EffectJS tool uses a TypeBox schema for parameters and an EffectJS program for execution.
The tool definition also includes prompt metadata that Pi uses when it describes the tool to the model.

```ts
import { PiToolContext, PiToolError, type EffectToolDefinition } from '@eratio/pi-effect'
import { Effect } from 'effect'
import { Type } from 'typebox'

const summarizeParameters = Type.Object({ text: Type.String() })
const summarizeOutput = Type.Object({ summary: Type.String() })
const summarizeTool: EffectToolDefinition<
  typeof summarizeParameters,
  never,
  PiToolError,
  { readonly inputLength: number }
> = {
  name: 'summarize_text',
  label: 'Summarize text',
  description: 'Return a short summary of text.',
  parameters: summarizeParameters,
  promptSnippet: 'Summarize the provided text.',
  promptGuidelines: ['Keep the summary short.', 'Keep the original meaning.'],
  exposure: 'direct',
  namespace: { name: 'text', description: 'Text tools' },
  annotations: { readOnlyHint: true },
  outputSchema: summarizeOutput,
  prepareLoadout: (loadout) => ({
    descriptions: {
      summarize_text: `Callable tools: ${loadout.callable.map(({ name }) => name).join(', ')}`,
    },
  }),
  execute: ({ text }) =>
    Effect.gen(function* () {
      const tool = yield* PiToolContext
      const summary = text.slice(0, 120)
      yield* tool.onUpdate({
        content: [{ type: 'text', text: 'Creating the summary.' }],
      })

      return {
        content: [{ type: 'text', text: summary }],
        details: { inputLength: text.length },
        structuredContent: { summary },
      }
    }),
}
```

| EffectJS field | Pi field | Purpose |
| --- | --- | --- |
| `name` | `name` | Names the tool in model tool calls. |
| `label` | `label` | Gives the tool a human-readable label in Pi's interface. |
| `description` | `description` | Helps the model choose the tool. |
| `parameters` | `parameters` | Defines the tool inputs with a TypeBox schema. |
| `promptSnippet` | `promptSnippet` | Adds one-line text to the default available-tools section. |
| `promptGuidelines` | `promptGuidelines` | Adds guidance to the model prompt while the tool is active. |
| `exposure` | `exposure` | `direct` (default): Pi declares the tool to the model while active, and other tools can call it through `executeTool`. `model-only`: Pi declares the tool while active, but other tools cannot call it through `executeTool`. `codemode`: Pi's built-in `codemode` tool lists it. Other tools can call it through `executeTool` whenever it is registered. Pi declares it to the model only when active. `deferred`: Other tools can call it through `executeTool` whenever it is registered. The built-in `codemode` tool does not list it. `tool_search` can find and activate it. `hidden`: Pi registers it but makes it unreachable. Re-register it as `hidden` to withdraw it. Pi cannot unregister tools. |
| `namespace` | `namespace` | Groups related tools, such as tools from one MCP server. Pi's built-in `codemode` lists each namespace above its tools. |
| `annotations` | `annotations` | Provides MCP-style hints through `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`. Permission extensions can inspect these author-provided hints. Pi does not verify them. |
| `outputSchema` | `outputSchema` | Declares the schema for `structuredContent`. |
| `prepareLoadout` | `ToolDefinition.prepareLoadout` | Pi calls this callback when active tools change. It can return `descriptions` for model-facing text and `hiddenDeclarations` to omit declarations from a model request while tools stay active and callable. |
| `execute` | `execute` | Runs the tool with validated parameters and returns its result as an EffectJS program. |

See Pi's [tool documentation](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/extensions.md#tools) for native field behavior.

Register the tool in the plugin setup program:

```ts
effect: ({ tools }) =>
  Effect.gen(function* () {
    yield* tools.register(summarizeTool)
  })
```

`PiToolContext.toolSignal` carries cancellation for the current tool call.
`PiToolContext.onUpdate` sends partial tool output to Pi.
`EffectToolDefinition` keeps Pi's tool fields and replaces `execute` with an EffectJS callback.
The adapter passes the other Pi tool fields through unchanged.
The `outputSchema` field declares the JSON Schema for `structuredContent`.
If a tool declares `outputSchema`, return `structuredContent` on every successful result.
Return `isError: true` when the tool returns a failure result.
A tool execution or progress-update failure becomes `PiToolError` at the adapter boundary.

### Nested tool calls

A nested call runs one Pi tool from another.
`PiToolContext.tools` lists the tools that the current tool can call.
`PiToolContext.executeTool(name, args, options)` runs a nested call through Pi and returns an EffectJS program with its outcome.
Pi validates nested arguments and runs the normal tool hooks.
Nested tool events include `parentToolCallId`, and Pi assigns each nested call an ID under the parent call.
The `signal` option defaults to the current tool's signal.
The `onUpdate` option receives partial results from the nested tool.
Tool failures return an outcome with `isError: true`.
The EffectJS program fails with `PiToolError` if the nested call operation itself fails.
If the parent tool has no `outputSchema`, return a nested result like this:

```ts
const nested = yield* tool.executeTool(
  'search_docs',
  { query: text },
  {
    signal: tool.toolSignal,
    onUpdate: (partial) => console.log(partial.content),
  },
)

if (nested.isError) {
  return {
    content: nested.result.content,
    details: {},
    isError: true,
  }
}

return {
  content: nested.result.content,
  details: nested.result.details,
  structuredContent: nested.result.structuredContent,
}
```

## Validation boundaries

The SDK uses EffectJS Schema for package-owned registration data, including flag definitions.
Pi owns event payloads, invocation contexts, and tool parameter validation.
The SDK keeps TypeBox tool schemas because Pi consumes those schemas directly.
The adapter passes Pi event and context data through typed EffectJS APIs.
The raw Pi event bus remains an escape hatch and accepts unknown data by design.

## UI and execution modes

`PiContext.mode` identifies the current mode as `tui`, `rpc`, `json`, or `print`.
`PiContext.hasUI` identifies whether interactive UI operations are available.

Dialog, custom component, editor, and other TUI-only operations return `PiUiUnavailableError` when the current mode has no UI.
Safe status and widget updates preserve Pi no-op behavior when UI is unavailable.
Pass an invocation signal to long-running Pi operations when the service accepts a dialog or tool signal.

## Errors

The SDK exports these error types:

- `PiOperationsError` represents a failed Pi operation.
- `PiUiUnavailableError` represents an operation that needs unavailable UI capabilities.
- `PiRuntimeDisposedError` represents a callback that ran after plugin disposal.
- `PiRegistrationError` represents a failed registration.
- `PiToolError` represents a tool execution or progress update failure.
- `PiExtensionError` is the union of the SDK extension errors.

Handle errors inside an EffectJS program with EffectJS error operators.
Do not convert typed errors to untyped strings at the domain boundary.

## Testing

The testing entrypoint exposes a fake Pi extension API and an in-memory installer.
Import test helpers from `@eratio/pi-effect/testing`:

```ts
import { PiExtension } from '@eratio/pi-effect'
import { installFakePlugin } from '@eratio/pi-effect/testing'
import { Effect } from 'effect'

const plugin = PiExtension.define({
  id: 'example',
  effect: ({ commands }) =>
    Effect.gen(function* () {
      yield* commands.register('hello', {
        handler: () => Effect.void,
      })
    }),
})

const extension = await installFakePlugin(PiExtension.install(plugin))
await extension.invokeCommand('hello')
await extension.invokeEvent('session_shutdown', {
  type: 'session_shutdown',
  reason: 'test',
})
```

The fake extension exposes recorded events, commands, shortcuts, flags, tools, and renderers.
Use `createFakeExtensionContext` when a test needs a custom working directory or Pi extension context.
Use `invokeEvent`, `invokeCommand`, `invokeCommandCompletions`, and `invokeTool` to exercise the installed adapter.
