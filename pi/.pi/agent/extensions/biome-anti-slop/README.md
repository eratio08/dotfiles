# biome-anti-slop

This Pi extension installs a partial Biome anti-slop port into a repository.
The repository owns the installed rules and runs them without Pi.
The port is not a complete replacement for anti-slop.
The per-rule results and known gaps are in `assets/anti-slop/UPSTREAM.md`.

The extension targets Biome `2.6.4`.
It does not install or upgrade Biome.
Bun is required for focused update tests.
The target also needs compatible `@biomejs/runtime` declarations if its TypeScript check includes the installed plugin source.

## Installation

Open Pi in the target Git repository.
Ask Pi to inspect the repository with the `biome_anti_slop` tool and its `inspect` operation.
Review the proposed files, configuration, Effect selection, and gaps.
Ask Pi to install the port with the returned `previewHash`.
Approve the confirmation before the extension changes the repository.

If Pi has no interactive UI, reply with the exact approval text in the preview.
A tool argument alone does not grant approval.
If the repository or proposal changes, inspect it again.

The default destination is `tools/biome/anti-slop`.
The extension stores the plugin files in `tools/biome/anti-slop/rules`.
The extension stores license notices, update data, and configuration backups in `tools/biome/anti-slop`.
The installer does not copy bundled tests into the repository.
The extension preserves existing Biome plugins.
It adds the optional Effect rules for a direct workspace dependency or an explicit `effect` choice.
It does not select Effect rules for a transitive dependency alone.

## Updates

Ask Pi to run `inspect-update` before an `update`.
The preview lists file contents before and after each proposed change.
For each conflict, set `decisions.conflicts` to `incoming` or `local` for that asset path.
For each new rule, set `decisions.rules` to `enable` or `disabled` for that asset path.
Review the new preview and approve its `previewHash`.

An update keeps local-only files and retains the installed Effect choice.
Unresolved changes remain pending.
If the installed base is unknown, the extension changes only individually approved rule files that pass focused tests.
It does not enable rules or replace shared files automatically for an unknown base.

The extension stores update backups and verification results under `tools/biome/anti-slop/backups`.
The `tools/biome/anti-slop/port-base.snapshot` file records the pristine installed port for later comparisons.
Do not edit that file to represent local changes.

## Configuration and checks

To change `no-runtime-typeof`, ask Pi to inspect `inspect-configure` with `allowInTypeGuards` set to `true` or `false`.
Review the preview and approve `configure` with the returned `previewHash`.
If the option cannot be identified safely, the extension asks for manual review.
The extension does not configure per-rule severity or the unsupported safety-comment rule.

Ask Pi to run `check` to run supported read-only verification commands.
The result distinguishes findings, plugin errors, and unavailable checks.
The extension does not rewrite application source.

## Development

Run `bun install` to install dependencies.
Run `bun run check` to check the extension and plugin sources.
Run `bun run typecheck` to check TypeScript.
Run `bun test tests assets/anti-slop/tests` to run the tests.
The tests also check plugin sources after Biome formats them without semicolons.
