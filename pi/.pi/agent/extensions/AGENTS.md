# Pi extension instructions

Treat the extension specification as the source of truth.
Implement the specification end to end.
Do not add unrelated features.
Ask for clarification only when essential information is missing.

## Runtime and implementation

Use Bun as the runtime, not Node.js.
Use TypeScript and standard APIs that work in both Bun and Node.js.
Do not use `Bun.*` APIs, Bun-only modules, or Bun-only globals.
Implement the extension as a Pi-idiomatic TypeScript extension.
Read the relevant Pi documentation before you write code, especially `docs/extensions.md`, `docs/keybindings.md`, and `docs/tui.md`.
Use Pi APIs and components when they provide the required behavior.
Write all extension code in TypeScript.
Export the default factory function that receives `ExtensionAPI`.
Keep the implementation minimal.
Do not add code comments unless they explain a non-obvious constraint.
Do not hard-code Pi defaults that users can configure.

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

## Formatting and checks

Give every extension a `biome.json` file.
Use this configuration in every extension:

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 120
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "asNeeded",
      "trailingCommas": "all"
    }
  },
  "linter": {
    "enabled": true,
    "rules": {
      "preset": "recommended"
    }
  },
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  }
}
```

Add `"check": "biome check ."` to each extension's `scripts`.
Keep an existing type-check script when you add the Biome check script.
Add `@biomejs/biome` to each extension's `devDependencies`.
Use Bun to install dependencies and update `bun.lock`.
Run `bun run check` in every extension before you finish.
Fix all Biome formatter and linter errors before you finish.

## TUI, cancellation, and tests

Guard TUI-only behavior with `ctx.mode === "tui"`.
Use `ctx.hasUI` before UI methods that require an available UI.
Respect cancellation through the provided `AbortSignal`.
Add focused tests for the implemented logic.
Use Bun's native test runner instead of adding a testing framework.
Test custom rendering in both collapsed and expanded states when applicable.
Run the relevant tests and type checks with Bun before you finish.
