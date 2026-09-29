## EffectJS

Any operation that can fail has to be modeled as an effect.
Any operation that has a side effect must be modeled as an effect.
Dependencies must never be injected via arguments to an effect or a layer, use requirements to express this.
Always differentiate the effect layer from the core pure logic layer.
No effect or layer type is permitted to express an error type as a generic `unknown` or `Error` but must use a well defined error type.
Effects are never run in the logic, they are run at the outer layer at a single point.

An Effect service provides data or operations.
The `R` type lists the services an Effect needs.
Get each service inside the Effect that needs it with `yield* ServiceTag`.
Do not get a service outside that Effect and capture it in a closure.
Pass request data as function arguments.
Do not capture other values that the Effect needs when it runs.

Terms like `Host` and `Port` are forbidden; this is not a hexagonal architecture pattern.

Read [LLMS.md](https://github.com/Effect-TS/effect/blob/main/LLMS.md) for official EffectJS v4 guidance.
