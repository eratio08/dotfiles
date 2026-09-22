# @eratio08/pi-effect

`@eratio08/pi-effect` is an Effect-native SDK for Pi extensions.
It keeps Pi host callbacks at one adapter boundary and gives extension code typed services, typed errors, and managed lifecycle handling.
This package targets Bun and Pi extension projects.
It publishes TypeScript source and does not publish compiled JavaScript.

## Requirements

You need Bun and a Pi extension host.
You need Effect version 4.
The package declares these peer dependencies:

- `effect` with the range `^4.0.0-0`.
- `@earendil-works/pi-coding-agent` for Pi extension types and host APIs.
- `@earendil-works/pi-tui` for TUI types.
- `typebox` for tool parameter schemas.

If the Pi extension project does not already provide these peers, install them with:

```bash
bun add @eratio08/pi-effect effect @earendil-works/pi-coding-agent @earendil-works/pi-tui typebox
```

## Quick start

An Effect program is a typed description of work that can use services and return typed errors.
A service tag identifies one service that an Effect program can request.

Create a plugin with `PiExtension.define` and export the result of `PiExtension.install`:

```ts
import { Pi, PiExtension } from '@eratio08/pi-effect'
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
            yield* pi.ui.notify('Hello from Pi Effect.', 'info')
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
- `layer` supplies custom Effect services to the plugin.
- `effect` registers events, commands, shortcuts, flags, tools, and renderers.

A Layer supplies services to an Effect program.
A plugin layer can require `PiHost` or stable host services such as `PiMessages`, `PiTools`, `PiFlags`, and `PiProcess` while the layer is built.
A plugin layer must not require `Pi`, `PiContext`, `PiSessionContext`, `PiCommandContext`, `PiToolContext`, `PiSession`, or `PiUi` because those services are invocation-scoped.
The setup program can use stable host services, but it cannot use invocation-scoped services.
The adapter builds the plugin layer once and keeps its resources until shutdown.
The adapter provides invocation services separately to each registered callback.

Use a custom layer when the extension owns state or another long-lived service:

```ts
import { Context, Effect, Layer } from 'effect'
import { PiExtension } from '@eratio08/pi-effect'

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
`PiExtension.install` owns the runtime and runs every registered Effect program.

## Registration API

The setup program receives a registration context with these registries:

- `events.on(name, handler, options)` registers a typed Pi event handler.
- `commands.register(name, definition)` registers a command and optional argument completions.
- `shortcuts.register(key, definition)` registers a keyboard shortcut.
- `flags.register(name, definition)` registers a boolean or string flag.
- `tools.register(definition)` registers an Effect tool.
- `renderers.message(customType, renderer)` registers a custom message renderer.
- `renderers.entry(customType, renderer)` registers a custom session entry renderer.

Each registration method returns an Effect that fails with `PiRegistrationError` when Pi rejects the registration.
Use `yield*` inside the setup program to run registration Effects in order.

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

- `propagate` returns the failure to Pi.
- `neutral` ignores the failed handler result and keeps the event neutral.
- `failClosed` rejects the action when the handler fails.

The adapter uses neutral handling for observation and transform events by default.
The adapter uses fail-closed handling for `tool_call` by default.
The adapter uses neutral handling for `project_trust` and `input` by default.

## Pi services

The `Pi` service is a facade that groups the services available to an extension.
Use the smaller service tags when a function needs one capability.

```ts
import { PiContext, PiSession, PiUi } from '@eratio08/pi-effect'
import { Effect } from 'effect'

const readSession = Effect.gen(function* () {
  const context = yield* PiContext
  const session = yield* PiSession
  const ui = yield* PiUi

  yield* ui.setStatus('example', `Running in ${context.mode}`)
  return yield* session.entries()
})
```

The main service tags are:

- `Pi` provides the full facade.
- `PiContext` provides mode, UI availability, working directory, model state, abort, shutdown, compaction, and prompt operations.
- `PiSessionContext` provides the current session snapshot.
- `PiCommandContext` provides command session operations such as fork, tree navigation, session switching, and reload.
- `PiToolContext` provides the current tool call, validated parameters, tool abort signal, progress updates, and execution mode.
- `PiSession` provides Effect operations for session entries, branches, labels, names, and context entries.
- `PiMessages` sends custom messages and user messages.
- `PiUi` provides Effect-based dialogs, notifications, widgets, editor access, themes, and TUI operations.
- `PiTools` reads all tools and replaces the active tool list.
- `PiFlags` reads execution-time flag values.
- `PiProcess` runs a process through the Pi host.

The `Pi` facade also provides `model.set` and the low-level Pi event bus.
The event bus uses raw channel data and is intended for coordination with other Pi extensions.

All host operations return Effects when they can fail or require an abort signal.
The adapter maps host failures to typed errors.

## Session state

Use `PiSession` to persist state that must survive session reloads or session changes:

```ts
import { PiSession } from '@eratio08/pi-effect'
import { Effect } from 'effect'

const saveState = Effect.gen(function* () {
  const session = yield* PiSession
  yield* session.appendEntry('example/state', { enabled: true })
  yield* session.setName('Example session')
})
```

Use session entries for state that must survive process exit.
Use Effect service state for resources that only live for one installed plugin.

## Effect tools

An Effect tool uses a TypeBox schema for parameters and an Effect program for execution.
The tool definition also includes prompt metadata that Pi uses when it describes the tool to the model.

```ts
import { PiToolContext, PiToolError, type EffectToolDefinition } from '@eratio08/pi-effect'
import { Effect } from 'effect'
import { Type } from 'typebox'

const summarizeParameters = Type.Object({ text: Type.String() })
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
  execute: ({ text }) =>
    Effect.gen(function* () {
      const tool = yield* PiToolContext
      yield* tool.onUpdate({
        content: [{ type: 'text', text: 'Creating the summary.' }],
      })

      return {
        content: [{ type: 'text', text: text.slice(0, 120) }],
        details: { inputLength: text.length },
      }
    }),
}
```

Register the tool in the plugin setup program:

```ts
effect: ({ tools }) =>
  Effect.gen(function* () {
    yield* tools.register(summarizeTool)
  })
```

`PiToolContext.toolSignal` carries cancellation for the current tool call.
`PiToolContext.onUpdate` sends partial tool output to Pi.
A tool failure is mapped to `PiToolError` at the adapter boundary.

## Validation boundaries

The SDK uses Effect Schema for package-owned registration data, including flag definitions.
Pi owns event payloads, invocation contexts, and tool parameter validation.
The SDK keeps TypeBox tool schemas because Pi consumes those schemas at the host boundary.
The adapter passes host-owned event and context data through the typed Pi host boundary.
The raw Pi event bus remains an escape hatch and accepts unknown data by design.

## UI and execution modes

`PiContext.mode` identifies the current mode as `tui`, `rpc`, `json`, or `print`.
`PiContext.hasUI` identifies whether interactive UI operations are available.

Dialog, custom component, editor, and other TUI-only operations return `PiUiUnavailableError` when the current mode has no UI.
Safe status and widget updates preserve Pi no-op behavior when UI is unavailable.
Pass an invocation signal to long-running host operations when the service accepts a dialog or tool signal.

## Errors

The SDK exports these error types:

- `PiHostError` represents a failed Pi host operation.
- `PiUiUnavailableError` represents an operation that needs unavailable UI capabilities.
- `PiRuntimeDisposedError` represents a callback that ran after plugin disposal.
- `PiRegistrationError` represents a failed registration.
- `PiToolError` represents a tool execution or progress update failure.
- `PiExtensionError` is the union of the SDK extension errors.

Handle errors inside an Effect program with Effect error operators.
Do not convert typed errors to untyped strings at the domain boundary.

## Testing

The testing entrypoint exposes a fake Pi host and an in-memory installer harness.
Import test helpers from `@eratio08/pi-effect/testing`:

```ts
import { PiExtension } from '@eratio08/pi-effect'
import { installFakePlugin } from '@eratio08/pi-effect/testing'
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
Use `createFakeExtensionContext` when a test needs a custom working directory or host context.
Use `invokeEvent`, `invokeCommand`, `invokeCommandCompletions`, and `invokeTool` to exercise the installed adapter.

## Package exports

The package exposes two public entrypoints:

```text
@eratio08/pi-effect
@eratio08/pi-effect/testing
```

The main entrypoint exports the production SDK.
The testing entrypoint exports fake host helpers and does not expose the internal adapter implementation.

## Development

Run the package gates from the package root:

```bash
bun run typecheck
bun test tests/*.test.ts
bun run check
```

The package uses explicit public exports from `src/index.ts` and `src/testing.ts`.
Internal source files are not package entrypoints.
