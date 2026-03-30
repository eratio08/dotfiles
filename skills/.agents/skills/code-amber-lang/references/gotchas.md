# Gotchas

## Core Sharp Edges

Do not overuse `trust`.
It bypasses the safety model that makes Amber valuable.

Remember that top-level code outside `main` runs during import.
Keep side effects in `main` unless import-time execution is intentional.

Prefer `Int` over `Num` unless decimal arithmetic is required.
`Num` may rely on `bc` at runtime depending on the version and environment.

Do not assume nested arrays are supported.
Check the stable docs before modeling data that way.

Treat `lines()` carefully.
It has been documented as a sharp edge because its failure behavior can be surprising.

## Version Drift

Stable docs are canonical for this skill.
Repository examples and nightly docs can be useful, but they may expose APIs or syntax that differ from the stable branch.

Verify less common stdlib helpers against the stable docs before using them.
Do not infer API stability from one repo example alone.

## Agent Guidance

When in doubt, choose the smaller Amber feature set that is clearly documented in the stable docs.
If an example and the stable docs disagree, follow the stable docs and treat the example as non-authoritative.
