Declare exported values and types without inline `export` keywords, then include them in one `export { ... }` clause at the end of the file, using `type` for type-only exports, such as `export { type Config, connect }`.
Use `export { name as default }` in the same clause when the module has a default export.
Do not add code comments unless they explain a non-obvious constraint.
Add focused tests for the implemented logic.
Use Bun's native test runner instead of adding a testing framework.
Run the relevant tests and type checks with Bun before you finish.
Use BDD style tests using `//given //when //then` structuring; each section must only be used once in a single test.
The `//when` section must only contain a single invocation.

## EffectJS

Any operation that can fail has to be modeled as an effect.
Any operation that has a side effect must be modeled as an effect.
Dependencies must never be injected via arguments to an effect or a layer, use requirements to express this.
Always differentiate the effect layer from the core pure logic layer.
No effect or layer type is permitted to express an error type as a generic `unknown` or `Error` but must use a well defined error type.
Effects are never run in the logic, they are run at the outer layer at a single point.

Read [LLMS.md](https://github.com/Effect-TS/effect/blob/main/LLMS.md) for official EffectJS v4 guidance.
