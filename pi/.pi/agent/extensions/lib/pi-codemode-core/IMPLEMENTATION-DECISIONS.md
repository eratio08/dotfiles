# Implementation decisions

This package uses `@eratio/pi-codemode-core` as the root package name.
The root entry exports the evaluator factory, public evaluator contracts, failure types, and definition validation.
The `@eratio/pi-codemode-core/output` entry exports output serialization and truncation functions.
The package supports Bun 1.4 or newer and Node.js 24 or newer.
The source worker entry uses standard `node:worker_threads` and is loaded from the package runtime that executes the package.
Worker mode is the default because it can stop CPU work that starts after an awaited host call.
In-process mode is explicit and is intended only for trusted low-latency programs with weaker timeout behavior.
Version 0.1 returns one final structured-cloneable program value and does not provide streaming.
Version 0.1 does not provide binary-specific output behavior, but structured-cloneable typed arrays and buffers can cross the worker when the runtime supports them.
Version 0.1 uses one serial request queue per evaluation and does not expose per-method concurrency limits.
The caller owns the Effect runtime and runs the returned evaluation Effect through that runtime.
The core does not call `Effect.runPromise` or `Effect.runSync` for individual host methods.
Public definitions, options, source, worker messages, and failure wire values use Effect Schema decoding at their boundaries.
`CodeModeFailure` is the Effect-facing finite tagged failure model, while worker transport uses the structured-cloneable `CodeModeFailureWireValue` data transfer object.
Worker mode preserves a custom host failure `E` only through a synchronous codec that produces a structured-cloneable wire value.
Worker code sees an encoded host-error envelope when it catches a custom host failure, and the parent decodes the envelope at the outer Effect boundary.
Malformed wire values and codec failures become `deserialize` or `serialize` failures.
The request queue, worker lifecycle, and deadline use scoped Effect resources with explicit release cleanup.
The deadline keeps a native wall-clock timer because a blocked worker event loop requires parent-side termination.
The implementation does not provide a security guarantee for untrusted code, host capabilities, denial of service, or resource exhaustion.
