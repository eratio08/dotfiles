# Research: anti-slop with Biome

Research date: 2026-11-01.

## Conclusion

Biome 2.6 provides a JavaScript plugin API that is a plausible target for an anti-slop port.
The API is a developer preview, and its behavior can change in patch releases.
The Oxlint plugin cannot run unchanged because it uses a different rule API and syntax tree.
The port must prove each rule against upstream examples before it claims equivalent behavior.
[Biome plugin documentation](https://biomejs.dev/linter/plugins/), [Biome 2.6 announcement](https://biomejs.dev/blog/biome-v2-6/), [upstream plugin entry point](https://github.com/dmmulroy/anti-slop/blob/13909c9e07590f5a85d93c62712259fe14a883f7/skills/install-anti-slop/assets/anti-slop/index.ts).

## Source and local context

The upstream research uses commit [`13909c9e07590f5a85d93c62712259fe14a883f7`](https://github.com/dmmulroy/anti-slop/commit/13909c9e07590f5a85d93c62712259fe14a883f7).
OpenSrc fetched both `main` and that commit.
The skill directory and `src/` in those cached copies matched at research time.
The `main` skill and readable-spacing rule also matched the Git blob IDs returned for that commit.

This extension directory contains a Bun starter and an empty `src/extensions.ts`.
It has no anti-slop implementation.
The surrounding working tree already contains changes, including the sibling [`anti-slop/`](../anti-slop/README.md) extension.
That extension runs the Oxlint rules from its own directory and does not install them in target projects.

It provides separate inspection, lint, preview, update, migration, verification, and spacing tools.
Its preview and apply flow uses a preview hash and interactive confirmation.
Its global policy does not inherit the target project's rules.
The sibling also contains a [snapshot merge implementation](../anti-slop/src/anti-slop-snapshot.ts) and tests, but its source assets and execution paths are Oxlint-specific.

## What the skill does

The [installation skill](https://github.com/dmmulroy/anti-slop/blob/13909c9e07590f5a85d93c62712259fe14a883f7/skills/install-anti-slop/SKILL.md) treats the installed rules as repository-owned source.
A fresh installation copies 18 generic rules, enables the native Oxlint accumulating-spread rule, and enables five Effect rules when Effect is a direct dependency or the user requests them.
It preserves existing configuration, excludes agent assets and the vendored rules from linting, runs checks, and records the source identity.
It reports application findings instead of fixing them without permission.

The [update procedure](https://github.com/dmmulroy/anti-slop/blob/13909c9e07590f5a85d93c62712259fe14a883f7/skills/install-anti-slop/references/update.md) protects local changes.
It stages incoming files, recovers a genuine base where possible, and reviews a three-way merge.
Without a base, it preserves unexplained differences and ports only understood changes.
The [copy script](https://github.com/dmmulroy/anti-slop/blob/13909c9e07590f5a85d93c62712259fe14a883f7/skills/install-anti-slop/scripts/install.mjs) does not fetch or merge updates.

The [upstream README](https://github.com/dmmulroy/anti-slop/blob/13909c9e07590f5a85d93c62712259fe14a883f7/README.md#analysis-boundaries) states that its rules use syntax and lexical scope, not the TypeScript type checker.
They resolve some same-file aliases but do not infer imported types or cross-file signatures.
The [upstream test files](https://github.com/dmmulroy/anti-slop/tree/13909c9e07590f5a85d93c62712259fe14a883f7/src) provide accepted and rejected examples for the port.

## Biome plugin capabilities

Biome supports GritQL plugins and JavaScript plugins.
GritQL matches syntax patterns but does not expose Biome's semantic model or file information.
JavaScript plugins query a concrete syntax tree, which includes tokens and comments, and can request same-file binding and reference information.
Biome strips types from `.ts` plugin files and runs them as JavaScript.
[Plugin documentation](https://biomejs.dev/linter/plugins/), [Biome 2.6 announcement](https://biomejs.dev/blog/biome-v2-6/#javascript-plugins).

The published `@biomejs/runtime@2.6.4` declarations expose `ast`, `semantic`, `defineRule`, `registerDiagnostic`, and mutation APIs for code fixes.
The semantic model exposes bindings, scopes, reads, and writes for the analyzed file.
The exposed rule context does not include rule options or a type checker.
The tracking issue lists rule options and type inference as future possibilities, so neither is a basis for this design.
[Runtime declarations](https://github.com/biomejs/biome/blob/main/packages/%40biomejs/runtime/plugin.d.ts), [semantic declarations](https://github.com/biomejs/biome/blob/main/packages/%40biomejs/runtime/semantic.d.ts), [tracking issue](https://github.com/biomejs/biome/issues/11420).

A JavaScript rule reports its severity in `registerDiagnostic`.
The supplied API supports safe and unsafe fixes, but the declarations do not establish that it can reproduce the upstream whitespace fix.
The spacing rule uses comment-aware insertion and preserves overload groups.
Its compatibility with Biome's mutation API and formatter needs a specific test.
[Runtime declarations](https://github.com/biomejs/biome/blob/main/packages/%40biomejs/runtime/plugin.d.ts), [upstream spacing rule](https://github.com/dmmulroy/anti-slop/blob/13909c9e07590f5a85d93c62712259fe14a883f7/src/rules/require-readable-spacing.ts).

Biome registers plugin paths in the top-level `plugins` array.
The documented plugin suppression category is `lint/plugin`.
Biome documents `lint/plugin/<plugin-name>` for GritQL plugin files, but this research did not verify rule-specific suppression for JavaScript plugins.
Do not assume Oxlint-style rule names, per-rule severity configuration, or options work in Biome.
[Plugin configuration](https://biomejs.dev/linter/plugins/), [suppression documentation](https://biomejs.dev/analyzer/suppressions/#plugin-suppressions).

The upstream native `oxc/no-accumulating-spread` rule covers array and object accumulator spreads in reducers and loops.
The custom `no-reduce-accumulator-copy` rule intentionally leaves spread cases to that companion.
A Biome port needs a separately tested replacement or must report that gap.
[Oxlint rule](https://oxc.rs/docs/guide/usage/linter/rules/oxc/no-accumulating-spread), [upstream reducer tests](https://github.com/dmmulroy/anti-slop/blob/13909c9e07590f5a85d93c62712259fe14a883f7/src/rules/no-reduce-accumulator-copy.test.ts).

## Local experiment

On 2026-11-01, the npm registry returned `2.6.4` for both `@biomejs/biome` and `@biomejs/runtime`.
A disposable project installed those exact versions and registered a `.ts` plugin in `biome.json`.
Running `biome lint input.ts` on a `debugger;` statement emitted both diagnostics from two named rule exports.
The same plugin loaded an explicitly named `./helper.ts` import.
An extensionless `./helper` import failed with `module not found (native)`.
The diagnostic also appeared after the installed `@biomejs/runtime` package was temporarily removed from the disposable project.

The experiment proves loading and diagnostics for that version and those examples only.
It does not prove anti-slop rule parity, TypeScript checking, fixing, suppressions, editor behavior, or compatibility with other versions.
`biome inspect plugins` listed the plugin file but stated that it did not run JavaScript plugins or list their rule names.

## Pi integration

Pi extensions can register model-facing tools and user-facing commands.
Tool results carry `content` and `details`, and file-mutating tools must serialize their read-modify-write work.
Pi provides working-directory context and cancellation for tool execution.
UI dialogs work when `ctx.hasUI` is true, including supported RPC dialogs, but terminal-only components require `ctx.mode === "tui"`.
[Pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), [Pi packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md).

The local Pi extension guidelines require Bun, TypeScript, an `index.ts` integration layer, and `src/extension.ts`.
They require focused tests and a `bun run check` script for an implemented extension.
The guidelines also prohibit changing Biome configuration without an explicit request.
The requested work here is research and a spec, not installation into this repository.
