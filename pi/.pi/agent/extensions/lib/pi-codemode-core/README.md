# @eratio/pi-codemode-core

Run trusted TypeScript programs against an API that your application provides.
Each program receives the API as a typed `api` argument and returns a value.

## Quick start

```ts
import { Effect, Layer, ManagedRuntime } from 'effect'
import { CodeModeEffectHost, createCodeModeCore } from '@eratio/pi-codemode-core'

const definition = {
  apiName: 'MathApi',
  programName: 'Add',
  declarations: 'type MathApi = { add(a: number, b: number): Promise<number> }',
  methods: [{ name: 'add', kind: 'async' }],
  examples: [],
} as const

const host = {
  invoke: (_method: string, args: readonly unknown[]) =>
    Effect.succeed(Number(args[0]) + Number(args[1])),
}

const core = createCodeModeCore<never, never>()
const runtime = ManagedRuntime.make(
  Layer.succeed(CodeModeEffectHost<never, never>(), host),
)
const source = 'export default async (api: MathApi) => api.add(2, 3)'
const result = await runtime.runPromise(
  core.evaluate(definition, source, {
    cwd: process.cwd(),
    filenamePrefix: 'example',
    timeoutMs: 30_000,
  }),
)

console.log(result)
await runtime.dispose()
```

## API

### `createCodeModeCore<R, E>()`

Creates a `CodeModeCore<R, E>`.
Call `core.evaluate(definition, source, options)` to run a program.
The returned Effect produces the program result and can fail with `CodeModeFailure` or a host error of type `E`.
`R` describes the Effect services required by the host.

### `CodeModeDefinition`

A definition describes the API available to a program:
- `apiName` names the TypeScript type used by the program's `api` argument.
- `programName` names the program.
- `declarations` provides TypeScript declarations for the API.
- `methods` lists the host methods that the program can call.
- `examples` contains example program strings.

Each method has a `name` and a `kind` of `'sync'` or `'async'`.

### `CodeModeEffectHost<R, E>()`

Returns the Effect service key used to provide the host.
The host provides `invoke` for asynchronous methods and can provide `invokeSync` for synchronous methods.
`invoke(method, args, signal)` receives an `AbortSignal` and returns an Effect.
`invokeSync(method, args)` returns a method value directly.
Optionally set `errorCodec` with `encode` and `decode` functions for host errors of type `E`.

### `CodeModeRunOptions`

- `cwd` sets the working directory.
- `filenamePrefix` sets the evaluated program's filename prefix.
- `timeoutMs` sets a positive timeout in milliseconds.
- `signal` accepts an optional `AbortSignal` for cancellation.
- `execution` selects `'worker'` or `'in-process'` execution and defaults to `'worker'`.

### `CodeModeFailure`

`CodeModeFailure` is the evaluator's error type.
Use `isCodeModeFailure(value)` to narrow a caught value to `CodeModeFailure`.

### Output formatting

Import output helpers from `@eratio/pi-codemode-core/output`:

```ts
import { serializeCodeModeOutput } from '@eratio/pi-codemode-core/output'

const value = { total: 3 }
const output = serializeCodeModeOutput(value, { maxBytes: 8_000, maxLines: 100 })
```

`serializeCodeModeOutput` formats a value and applies the byte and line limits.
`output.output` contains the formatted text, and `output.truncated` reports whether the limits changed it.
`formatCodeModeValue` formats a value as display text.
`truncateCodeModeOutput` applies limits to formatted text.
`CodeModeOutputLimits` sets `maxBytes` and `maxLines`.
`CodeModeSerializedOutput` contains the output text and truncation flag.
`CODE_MODE_TRUNCATION_NOTICE` contains the notice used for truncated output.
