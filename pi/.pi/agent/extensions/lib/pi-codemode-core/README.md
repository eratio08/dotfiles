# @eratio/pi-codemode-core

Run trusted TypeScript programs against methods that your application provides.
The evaluator returns the program's result.

## Quick start

The definition lists the methods that the program can call.
The host implements those methods.
`core.evaluate` creates an effect, a description of work that requires the host service.
`hostLayer` provides that service when `ManagedRuntime.make` creates the runtime.
`runtime.runPromise` executes the effect in that runtime as a separate step.

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
const hostLayer = Layer.succeed(CodeModeEffectHost<never, never>(), host)
const runtime = ManagedRuntime.make(hostLayer)
const source = 'export default async (api: MathApi) => api.add(2, 3)'
const evaluation = core.evaluate(definition, source, {
  cwd: process.cwd(),
  filenamePrefix: 'example',
  timeoutMs: 30_000,
})

const result = await runtime.runPromise(evaluation)

console.log(result)
await runtime.dispose()
```

Use this package only with code that you trust.
