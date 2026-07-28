---
description: Implement a Pi extension from a specification
argument-hint: "<extension specification>"
---

Implement the following Pi extension specification:

<extension-specification>
$ARGUMENTS
</extension-specification>

Treat the specification as the source of truth.
Implement it end-to-end without inventing unrelated features.
Ask for clarification only when essential information is missing.

Implement the extension as a Pi-idiomatic TypeScript extension.
Read the relevant Pi documentation before coding, especially `docs/extensions.md`, `docs/keybindings.md`, and `docs/tui.md`.
Use Pi's existing APIs and components instead of reimplementing behavior already provided by Pi.
Write 100% TypeScript.
Export the extension's default factory function receiving `ExtensionAPI`.
Give every custom tool a `promptSnippet`.
Give every custom tool concise `promptGuidelines` describing when to use it and important constraints.
Keep the implementation minimal.
Do not add comments unless they explain a non-obvious constraint.
Do not hard-code Pi defaults that users can configure.
For every custom tool with visible output:
- Return Pi's exact tool result shape with `content` and `details`.
- Implement `renderResult` when custom presentation is needed.
- Use the renderer's `expanded` value to provide a compact collapsed view and additional detail when expanded.
- Make the output expandable and collapsible through Pi's built-in tool-output action.
- Reference the configured action with `keyHint("app.tools.expand", "to expand")` or `keyText("app.tools.expand")`.
- Never hard-code `ctrl+o` or define a replacement shortcut for tool-output expansion.
- Use Pi's injected `theme` and existing TUI components.
- Keep custom renderer output within the available terminal width.
Truncate large tool output using Pi's truncation utilities before returning it to the model.
Preserve enough structured data in `details` for rendering and state restoration.
Throw from `execute` when the tool should report an error.
Guard TUI-only behavior with `ctx.mode === "tui"`.
Use `ctx.hasUI` before UI methods that require an available UI.
Respect cancellation through the provided `AbortSignal`.
Add focused tests for the implemented logic.
Test custom rendering behavior for both collapsed and expanded states when applicable.
Use the runtime's native test runner instead of adding a testing framework.
Run the relevant tests and type checks before finishing.
