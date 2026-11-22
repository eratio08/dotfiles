# biome-anti-slop

This Pi extension installs Biome anti-slop rules into a repository.
The repository owns the installed rules and runs them without Pi.
The port is not a complete replacement for anti-slop.
The rule results and known gaps are in `assets/anti-slop/UPSTREAM.md`.

The extension targets Biome `2.6.4`.
It does not install or upgrade Biome.
The target also needs compatible `@biomejs/runtime` declarations if its TypeScript check includes the installed plugin source.

## Commands

Open Pi in a trusted Git repository with an interactive UI.
Run these commands without an agent turn:

- `/anti-slop-install [--config PATH] [--effect]`
- `/anti-slop-update [--config PATH]`
- `/anti-slop-remove [--config PATH]`

Each command shows one compact confirmation before it changes files.
If you decline, the command makes no changes.
If the target, bundled files, or project trust change during confirmation, the command stops.
The commands also stop when the target is unsafe or ownership is unknown.

`--config` selects an existing `biome.json` or `biome.jsonc`.
A relative path starts from Pi's current directory.
The command installs and manages the rules relative to the selected configuration.

Without `--config`, the commands look for a configuration in the current directory only.
If both configuration files exist, select one with `--config`.
If neither exists, install can create `biome.json`.
If a parent configuration exists, install stops for review instead.
Update and remove require an existing configuration.

## Installation

Effect rules are off by default, even when the project depends on Effect.
To enable the Effect rules, run `/anti-slop-install --effect`.
The confirmation shows the Effect choice and the rules that the port does not implement.

The extension stores the rules in `tools/biome/anti-slop/rules` beside the selected configuration.
Biome loads the selected rules through `tools/biome/anti-slop/rules/anti-slop.ts`.
To disable a rule, remove its export from that file.
The installer preserves other plugins and JSONC comments.
It does not copy bundled tests into the repository.
For an existing configuration, it keeps a copy in `tools/biome/anti-slop/biome-config.backup`.

## Updates and removal

Update keeps disabled rules, local-only files, unrelated configuration, and the installed Effect choice.
It enables new applicable rules and reports their count in the confirmation.
A collision occurs when both the installed file and incoming file differ from their shared base.
The confirmation names every collision.
Approval replaces each named local file with the incoming version.
If the details do not fit in the dialog, the command stops without changes.

The file `tools/biome/anti-slop/port-base.snapshot` records the installed base for later comparisons.
Do not edit that file to represent local changes.
Update does not create backup files or run bundled tests.

Remove deletes the anti-slop registration and managed files that still match the installed base.
It lists modified and local-only files that remain.
It preserves the configuration backup and existing configuration exclusions.
It also preserves other plugins and JSONC comments.
If another configuration uses the rules, remove stops for review.
If configuration inheritance prevents a safe review, remove also stops.

## Rule gaps

The port does not implement `require-readable-spacing` or `require-safety-comment-for-type-assertion`.
Biome `2.6.4` does not suppress JavaScript plugin diagnostics with the tested named suppression.
The port does not support per-rule severity configuration or fixes.
The installed `UPSTREAM.md` lists the other rule limits.

## Development

Run `bun install` to install dependencies.
Run `bun run check` to check the extension and plugin sources.
Run `bun run typecheck` to check TypeScript.
Run `bun test tests assets/anti-slop/tests` to run the tests.
The tests also check plugin sources after Biome formats them without semicolons.
