# @eratio/pi-codemode-core

`@eratio/pi-codemode-core` evaluates trusted local TypeScript programs through one effect-based evaluator.
The term `effect-based` describes the evaluator and host contract.
Programs receive ordinary JavaScript methods and can use `await` on asynchronous methods.
The package does not import Pi, `@earendil-works/pi-tui`, or `typebox`.

## Package boundary

The root entry exports `createCodeModeCore`, the public contracts, definition validators, and tagged failure helpers.
The `@eratio/pi-codemode-core/output` entry exports raw-value formatting and output truncation.
The core returns one final structured-cloneable value in version 0.1.
The core does not stream program output.
Arguments, host responses, and the final worker result must cross structured-clone transport.
Functions, live resources, Effects, Pi contexts, and other non-cloneable values cannot cross that boundary.
The core supports typed arrays and buffers when the selected runtime can transfer them, but it has no binary-specific output formatter.

## Create an evaluator

Call `createCodeModeCore` once for an evaluator instance.
The evaluator owns one Jiti instance and a diagnostic evaluation counter.
The caller owns the Effect runtime that runs each returned Effect.

```ts
import { Effect, Layer, ManagedRuntime } from 'effect'
import { createCodeModeCore } from '@eratio/pi-codemode-core'

const core = createCodeModeCore<never, HostFailure>()
const runtime = ManagedRuntime.make(Layer.empty)

const evaluation = core.evaluate(definition, host, source, {
  cwd: '/tmp',
  filenamePrefix: 'program',
  timeoutMs: 30_000,
})

const value = await runtime.runPromise(evaluation)
await runtime.dispose()
```

The host type parameter `R` names the Effect services that the host needs.
The host type parameter `E` names typed host failures.
`CodeModeFailure` is the built-in structured-cloneable failure and needs no codec.
Worker mode preserves another `E` only when the host provides an `errorCodec` with synchronous `encode` and `decode` functions.
In-process mode returns `E` directly because no worker transport is used.
The codec encodes a wire-safe value before a host failure enters the worker and decodes it after the worker returns the failure.
The core does not create a runtime and does not call `Effect.runPromise` or `Effect.runSync` for individual host methods.

## Effect and transport boundaries

`CodeModeFailure` is the Effect-facing tagged failure for failures that the evaluator creates or returns.
The built-in failure tags are finite and include validation, transform, compile, invoke, timeout, cancellation, worker, transport, deserialize, and serialize.
Worker messages use the separate `CodeModeFailureWireValue` data transfer object so that transport validation does not depend on Effect error classes.
The worker and parent validate public values and worker messages with Effect Schema before they use them.
The parent keeps narrow native checks for `MessagePort` and `SharedArrayBuffer` because Schema does not model those handles.
A malformed worker failure becomes a `deserialize` failure instead of entering the Effect error channel as an untyped value.

## Definition and host

`CodeModeDefinition.declarations` contains code-facing TypeScript declarations.
`CodeModeDefinition.methods` is the runtime allow-list.
A method marked `sync` must return synchronously.
A method marked `async` returns a Promise to the evaluated program.
The core rejects a Promise returned by a sync method.

```ts
type ExampleApi = {
  read(path: string): Promise<string>
  count(): number
}

const definition = {
  apiName: 'ExampleApi',
  programName: 'ExampleProgram',
  declarations: 'type ExampleApi = { read(path: string): Promise<string>; count(): number }',
  methods: [
    { name: 'read', kind: 'async' },
    { name: 'count', kind: 'sync' },
  ],
  examples: [],
}

const host = {
  invoke: (method: string, args: readonly unknown[], signal: AbortSignal) =>
    Effect.succeed(runAsyncHostMethod(method, args, signal)),
  invokeSync: (method: string, args: readonly unknown[]) => runSyncHostMethod(method, args),
}
```

The host adapter owns input validation and service access.
The host adapter receives the per-call `AbortSignal` for asynchronous work.
The host adapter owns Pi schemas, prompts, renderers, operation counts, UI updates, transaction state, persistence, and rollback.
The core only schedules host Effects and returns their raw values.
A Pi adapter can map the raw result to `{ content, details }` and throw failures from its `execute` callback.
The core does not create that Pi tool result or render it.

## Evaluation lifecycle

The evaluator validates the definition, options, and source before it creates a worker.
It prefixes the source with the declaration text and transforms the TypeScript source with Jiti.
It creates a fresh restricted VM context for each invocation.
It requires a callable default export and invokes that function with one API object.
It awaits the final value and returns it without rendering or persisting it.

Worker mode is the default.
The evaluator starts one worker for each evaluation and terminates it after success, failure, timeout, or cancellation.
The worker receives serializable definition data, transformed source, options, and request messages.
The worker never receives a host object, Effect, Pi context, or live resource.
Asynchronous host calls use a scoped serial request queue in the caller runtime.
If evaluated worker code catches a custom host failure, it sees the encoded host error envelope instead of the outer `E` value.
If the failure reaches the outer evaluation boundary, the parent decodes it and returns `E`.
A missing codec or a codec failure returns a `serialize` or `deserialize` `CodeModeFailure` instead of the custom host failure.
Synchronous host calls use the parent-side sync transport and cannot run asynchronous work.

The caller can set `execution: 'in-process'` for trusted low-latency code.
In-process mode uses the same source and host contract but cannot reliably stop asynchronous continuations or CPU loops that start after `await`.
The caller must use worker mode when hard timeout behavior matters.

## Cancellation and failures

The evaluator combines the caller signal, Effect lifecycle signal, and evaluation deadline.
The deadline is a scoped resource that removes its listeners and native timer when the evaluation scope closes.
A native wall-clock timer remains because the parent must be able to start worker shutdown when worker code blocks the event loop.
The remaining deadline covers transformation, compilation, invocation, asynchronous waiting, and shutdown initiation.
The evaluator rejects an already-aborted evaluation before source transformation or worker creation.
A deadline produces a `timeout` failure.
Caller or runtime cancellation produces a `cancellation` failure.
Cancellation wins unless the deadline fired first.
The request queue is a scoped serial resource that rejects queued and active calls, interrupts its child worker, removes abort listeners, and shuts down its Effect Queue during release.
The evaluator closes the request queue and worker transport on every outcome.

Failures use `CodeModeFailure` with a `_tag` and `operation`.
The core uses `validation`, `transform`, `compile`, `invoke`, `timeout`, `cancellation`, `worker`, `transport`, `deserialize`, and `serialize` tags.
Worker errors preserve tagged failure fields and ordinary exception name, message, and stack data when the runtime provides them.
Worker mode cannot preserve an arbitrary custom `E` without a synchronous codec that maps it to a structured-cloneable wire value.
Codec encode or decode failures become structured `serialize` or `deserialize` failures.

## Trust model

`node:vm` limits accidental access to host globals but is not a security boundary.
The context does not provide `require`, `process`, timers, `fetch`, Bun, Deno, or a module loader.
The context disables string and WebAssembly code generation.
These limits do not stop malicious code, denial of service, or excessive capabilities exposed by a host adapter.
Only run trusted local programs and expose the smallest host allow-list that the application needs.

## Output entry

Use `@eratio/pi-codemode-core/output` after evaluation when a host tool needs text.
`serializeCodeModeOutput` formats primitive and JSON-like values and applies byte and line limits.
Circular values fall back to `String`.
The result has the shape `{ output, truncated }`.
The core does not choose tool output limits.

See [`IMPLEMENTATION-DECISIONS.md`](./IMPLEMENTATION-DECISIONS.md) for the fixed version 0.1 decisions.
