---
name: build-pi-extension
description: Instructions on how to build a pi agent extension. Use when working on pi agent extensions.
---
## Runtime and implementation

Use Bun as the runtime, not Node.js.
Use TypeScript and standard APIs that work in both Bun and Node.js.
Do not use `Bun.*` APIs, Bun-only modules, or Bun-only globals.
Implement the extension as a Pi-idiomatic TypeScript extension.
Read the relevant Pi documentation before you write extension code via `read`.
Use Pi APIs and components when they provide the required behavior.
Use one final explicit export list in every TypeScript file.
Declare exported values and types without inline `export` keywords, then include them in one `export { ... }` clause at the end of the file, using `type` for type-only exports, such as `export { type Config, connect }`.
Use `export { name as default }` in the same clause when the module has a default export.
In barrel files use `export { ... } from "..."` instead of `import` + `export`.
Export the default factory function that receives `ExtensionAPI`.
Do not hard-code Pi defaults that users can configure.
Add return types to all non-test code.
Prefer functions over closures.
When designing modules you must read the [module design guidelines](references/modules.md).

## Custom tools

Give every custom tool a `promptSnippet`.
Give every custom tool concise `promptGuidelines` that describe when to use it and its important constraints.

For every custom tool with visible output:
- Return Pi's exact tool result shape with `content` and `details`.
- Implement `renderResult` when custom presentation is needed.
- Use the renderer's `expanded` value to show a compact collapsed view and more detail when expanded.
- Make the output expandable and collapsible through Pi's built-in tool-output action.
- Reference the configured action with `keyHint("app.tools.expand", "to expand")` or `keyText("app.tools.expand")`.
- Never hard-code `ctrl+o` or define a replacement shortcut for tool-output expansion.
- Use the injected `theme` and existing TUI components.
- Keep custom renderer output within the available terminal width.
- Truncate large tool output with Pi's truncation utilities before you return it to the model.
- Preserve enough structured data in `details` for rendering and state restoration.
- Throw from `execute` when the tool must report an error.
- Module inter-dependencies must be kept low, when you have to import more than 5 types of another module, better merge them into one.
Use vertical space to separate logical block in logic.
Use guard-clause style programming, the happy path goes last.
The happy path is considered a logical block.

## TUI, cancellation, and tests

Guard TUI-only behavior with `ctx.mode === "tui"`.
Use `ctx.hasUI` before UI methods that require an available UI.
Respect cancellation through the provided `AbortSignal`.
Add focused tests for the implemented logic.
Use Bun's native test runner instead of adding a testing framework.
Test custom rendering in both collapsed and expanded states when applicable.
Run the relevant tests and type checks with Bun before you finish.
Use BDD style tests using `//given //when //then` structuring; each section must only be used once in a single test.
The `//when` section must only contain a single invocation.
Test names must follow the BDD pattern of "should <expected outcome> given <scenario>".

## EffectJS

When working with EffectJS you must read the [EffectJS guidelines](references/effectjs.md).

## Formatting and checks

When setting up a new extension you must read the [setup guidelines](references/setup.md).
When managing dependencies you must read the [peer-dependencies guidelines](references/peer-dependencies.md)
You must never change biome configurations without being explicitly asked to.
Use Bun to install dependencies and update `bun.lock`.
Run `bun run check` in every extension before you finish.
Fix all Biome formatter and linter errors before you finish.
