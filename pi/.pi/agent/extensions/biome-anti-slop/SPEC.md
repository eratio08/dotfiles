# Spec: Biome anti-slop Pi extension

## Problem Statement

Developers who use Biome need a repository-owned anti-slop ruleset without adding Oxlint to run it.
The upstream installation skill vendors Oxlint rules into each repository, but Biome cannot execute those rules as written.
A Biome port must preserve the upstream rules and respect each repository's existing policy.

A repository can have local rule changes, existing Biome configuration, and uncommitted work.
An installer that replaces those choices or silently upgrades Biome can change policy or lose work.
The installation must also remain usable after the Pi extension is removed.

## Solution

Build a Pi extension that inspects a target repository and installs a separate, repository-owned Biome plugin.
The extension also reviews updates, changes approved configuration, and verifies the installed rules.
It makes no target changes at startup.

Port the upstream rules to Biome and test them against upstream examples.
The first complete release targets Biome 2.6.4 and all 24 rules listed below.
A partial release must identify its gaps before installation and must not claim full equivalence.

## User Stories

1. As a developer, I want to install anti-slop rules for Biome, so that my repository does not need Oxlint to run them.
2. As a developer, I want to request installation explicitly, so that opening Pi does not change my repository.
3. As a developer, I want to inspect a repository first, so that I understand the proposed changes.
4. As a developer, I want the current Pi working directory to be the default target, so that I can work in the repository I opened.
5. As a developer, I want to select another target directory, so that I can manage a different repository.
6. As a maintainer, I want the rules copied into the repository, so that the repository owns its policy.
7. As a maintainer, I want a suitable existing tooling location used when available, so that the installation follows repository conventions.
8. As a maintainer, I want to select the destination, so that I can keep the rules in an approved location.
9. As a developer, I want Biome to run the installed rules without Pi, so that editors and CI can use them independently.
10. As a developer, I want installation to preserve applicable licenses, so that the copied rules retain their notices.
11. As a developer, I want inspection to report the package manager and Biome versions, so that I can review dependency changes.
12. As a developer, I want inspection to identify relevant configurations and inherited policy, so that the proposal reflects effective behavior.
13. As a developer, I want inspection to identify an existing Biome port, so that installation does not overwrite it.
14. As a maintainer, I want inspection to report staged, unstaged, and untracked changes in affected files, so that I can protect my work.
15. As a maintainer, I want inspection to read repository instructions, so that proposals respect local requirements.
16. As a developer, I want inspection to report proposed file and dependency changes, so that I can approve a known scope.
17. As a developer, I want inspection to report known parity gaps, so that I can decide whether a partial installation is acceptable.
18. As a developer, I want inspection to avoid installation scripts and writes, so that I can review a repository safely.
19. As a developer, I want installation to require my approval, so that the extension cannot make unrequested policy changes.
20. As a developer, I want an interactive confirmation when Pi supports one, so that I can approve the proposed change.
21. As an automation user, I want a non-interactive operation to require authorization in my request, so that tool arguments cannot invent approval.
22. As a maintainer, I want a changed proposal to require a new review, so that approval applies to the actual changes.
23. As a maintainer, I want an occupied destination reported, so that a fresh installation does not overwrite existing files.
24. As a maintainer, I want resolved paths kept inside the approved target, so that symbolic links cannot redirect writes elsewhere.
25. As a maintainer, I want backups before existing assets change, so that I can recover my prior policy.
26. As a maintainer, I want cancellation to report completed changes and recovery information, so that I can recover safely.
27. As a maintainer, I want my Git state preserved, so that installation does not reset or stash my changes.
28. As a developer, I want existing Biome plugins retained, so that adding anti-slop does not disable other checks.
29. As a developer, I want configuration comments and formatting retained, so that repository configuration remains readable.
30. As a maintainer, I want existing includes, overrides, and inherited configuration retained, so that source coverage and policy do not change unexpectedly.
31. As a maintainer, I want only necessary exclusions added, so that the installer does not hide unrelated source files.
32. As a maintainer, I want an incompatible or missing Biome version reported, so that I can approve any required dependency change.
33. As a maintainer, I want unrelated dependency ranges and lockfile entries retained, so that installation has a narrow scope.
34. As a developer, I want verified generic rules enabled as errors, so that violations fail my normal checks.
35. As a developer, I want Effect rules enabled for a direct dependency or explicit choice, so that unrelated repositories do not receive Effect policy.
36. As a workspace maintainer, I want direct dependencies checked in relevant packages, so that a transitive dependency does not enable Effect rules.
37. As a developer, I want Effect selection reported and preserved, so that an update does not silently change my policy.
38. As a developer, I want `no-array-filter-map` to report upstream eager array chains and preserve iterator and unknown-receiver exceptions.
39. As a developer, I want `no-reduce-accumulator-copy` to detect the upstream copies and preserve alias, shadowing, and array-evidence boundaries.
40. As a developer, I want `no-accumulating-spread` to detect supported accumulator spreads in reducers and loops.
41. As a developer, I want `no-chained-type-assertions` to report assertion chains and preserve the `as const` exception.
42. As a developer, I want `no-conditional-empty-object-spread` to report the upstream pattern without an automatic semantic rewrite.
43. As a developer, I want `no-known-value-widening` to preserve upstream evidence, alias, dictionary, and type predicate behavior.
44. As a developer, I want `no-module-mocking` to report the upstream Jest and Vitest module-mocking calls.
45. As a developer, I want `no-object-parameters` to report upstream object parameter forms and supported aliases.
46. As a developer, I want `no-reflect-apply` to report global `Reflect.apply` without reporting a locally shadowed binding.
47. As a developer, I want `no-reflect-get` to report global `Reflect.get` without reporting a locally shadowed binding.
48. As a developer, I want `no-runtime-typeof` to preserve existence probes and its type-guard option.
49. As a developer, I want `no-shape-in-symbol-names` to report locally owned forbidden names and preserve static member exceptions.
50. As a developer, I want `no-unknown-parameters` to preserve the `cause` and type predicate exceptions.
51. As a developer, I want `no-unknown-returns` to report upstream return forms and supported aliases.
52. As a developer, I want `no-unknown-type-aliases` to report upstream aliases and supported generic forms.
53. As a developer, I want `no-unsafe-dictionary-type` to preserve upstream value, finite-key, constraint, and alias boundaries.
54. As a developer, I want `no-widen-then-assert` to report the upstream immutable same-file widening and assertion flow.
55. As a developer, I want `require-readable-spacing` to preserve upstream diagnostics and whitespace-only fixes.
56. As a developer, I want `require-safety-comment-for-type-assertion` to preserve comment placement, non-empty justifications, const exceptions, and custom markers.
57. As an Effect developer, I want `no-manual-effect-error-tag` to report upstream manual tag checks in broad Effect error handlers.
58. As an Effect developer, I want `no-manual-tag-comparison` to report upstream direct tag comparisons and switches.
59. As an Effect developer, I want `no-manual-tagged-construction` to report manual tagged objects and preserve matching-pattern exceptions.
60. As an Effect developer, I want `no-service-constructor-imports` to report relative named constructor imports and preserve test and spec file exceptions.
61. As an Effect developer, I want `prefer-effect-match` to report upstream chained literal ternaries over the same expression.
62. As a maintainer, I want the two configurable upstream rules to retain their defaults and support editable custom values.
63. As a maintainer, I want a configuration gap reported before a change, so that unsupported options do not silently change my policy.
64. As a developer, I want spacing fixes to preserve comments, documentation, binding groups, and overloads, so that fixes do not alter meaning.
65. As a developer, I want formatting and a second fix pass to leave fixed files unchanged, so that the fix is stable.
66. As a maintainer, I want each rule enabled independently when required, so that I can retain local rule choices.
67. As a maintainer, I want existing disabled rules and severity choices preserved, so that an update does not strengthen my policy without approval.
68. As a maintainer, I want unsupported severity or suppression choices reported, so that I can decide how to proceed.
69. As a maintainer, I want to update the Biome port separately from its upstream source revision, so that provenance is accurate.
70. As a maintainer, I want upstream changes reviewed and ported before an update is offered, so that an Oxlint change is not mistaken for Biome code.
71. As a maintainer, I want an update compared with the exact installed base, so that local and incoming changes are distinguishable.
72. As a maintainer, I want local-only rules, tests, options, overrides, and Effect choices preserved, so that an update retains my work.
73. As a maintainer, I want conflicts and locally modified upstream deletions reported, so that I decide how to resolve them.
74. As a maintainer, I want new rule enablement approved, so that an update does not add policy without my consent.
75. As a maintainer, I want an unknown update base treated conservatively, so that the installer does not guess which changes are local.
76. As a maintainer, I want unresolved updates left pending and reported, so that partial adoption remains visible.
77. As a maintainer, I want existing lint configuration left unchanged, so that installation does not alter unrelated policy.
78. As a developer, I want Biome rules to run without another linter, so that the installed port remains independent.
79. As a developer, I want to reconfigure only the choices I request, so that unrelated policy stays intact.
80. As a developer, I want a check operation that does not edit application source, so that verification cannot hide findings.
81. As a developer, I want vendored rule tests run even when the vendored assets are excluded from application linting.
82. As a developer, I want the target's Biome lint and typecheck commands run, so that I can see integration failures.
83. As a developer, I want application findings separated from plugin load errors, test failures, and unavailable checks.
84. As a developer, I want structured results and a readable summary, so that both Pi and I can use the outcome.
85. As a developer, I want access to full output when a summary is truncated, so that I can investigate failures.
86. As a maintainer, I want provenance to identify source and port revisions, tested Biome version, licenses, and verification results.
87. As a maintainer, I want local deviations and unresolved conflicts recorded, so that future updates do not erase context.
88. As a maintainer, I want a partial update to retain its prior base and record adopted changes, so that later comparisons remain trustworthy.
89. As a developer, I want a per-rule parity report, so that I can distinguish verified behavior from unsupported behavior.
90. As a developer, I want application cleanup left to a separate request, so that installation does not rewrite my code.

## Implementation Decisions

The extension and the Biome plugin are separate components.
The extension bundles a tested copy of the plugin, its tests, licenses, and provenance.
The installer copies those assets into the target repository.
The installed plugin must not depend on the extension or its installation directory.

Expose inspection, installation, update, reconfiguration, and checking through a Pi tool.
Inspection is read-only.
Each mutating operation must have an explicit user request and authorization for its proposed scope.
Interactive approval uses Pi's supported confirmation dialog.
In a non-interactive session, a tool argument alone does not establish user authorization.

The proposal identifies affected files, dependencies, policy changes, and coverage gaps before any write.
An incomplete ruleset requires explicit approval before installation.
Recheck affected state after approval and stop if it changed.
Stage incoming assets separately, retain recoverable backups for existing assets, and report partial changes on failure or cancellation.
Do not overwrite an occupied destination during fresh installation.
Resolve symbolic links before accepting destinations and keep writes within the approved target.
Serialize file read-modify-write operations with Pi's file mutation queue.

Use the repository's existing package manager and known command arguments without a shell.
Do not accept arbitrary shell commands from the model.
Preserve existing configuration, including comments, inheritance, plugins, overrides, and effective source coverage.
If a safe merge or equivalent policy cannot be established, stop and report the decision needed.
Do not edit generated lockfiles by hand.

Use Biome 2.6.4 as the initial compatibility target.
Its JavaScript plugin API is a developer preview, so other versions require the same compatibility tests.
Do not silently upgrade an existing Biome installation.
When the repository typechecks the vendored TypeScript, provide compatible runtime type declarations.
Biome's embedded plugin runtime does not itself require that npm type package.

Implement the first-release rules in TypeScript with Biome's JavaScript plugin API.
Biome's JavaScript API exposes semantic and file information needed for shadowing and file-specific exceptions.
GritQL lacks those capabilities in Biome and introduces a second rule format.
A later GritQL implementation needs a specific benefit and the same parity evidence.
Local plugin imports must use explicit file extensions.

Preserve rule defaults, exceptions, diagnostic behavior, and supported fixes.
The accumulating-spread rule replaces the upstream Oxlint companion for its supported reducer and loop cases.
Keep Effect rules separate from generic rules.
Inspect relevant package manifests for direct Effect dependencies and honor an explicit Effect choice.
Report the upstream limitation for package-alias imports.

Test independent rule registration, severity, suppression, and options before relying on them.
Biome's documented JavaScript rule context does not expose an options object.
Provide an editable repository-owned equivalent for the two upstream configurable rules.
If existing options or policy cannot be represented, block the change and report the gap.

Treat the spacing fix as a release gate.
It must insert whitespace without changing meaning or comment attachment.
A formatter pass and a second fix and format pass must be stable.
If the implementation cannot meet those conditions, report the rule or fix as unsupported.

For updates, distinguish the upstream source revision from the Biome port revision.
Use the exact pristine port base when available and compare base, local, and incoming changes.
Keep local-only behavior and request decisions for conflicts, upstream deletions with local changes, and new rule enablement.
If the base is unknown, apply only independently understood changes with focused tests.
Record the previous base and adopted changes for a partial update.
Record an unavailable base as unknown.

The extension does not inspect or migrate other linters.
Do not edit unrelated lint configuration.

Record source and port revisions, the tested Biome version, installed assets, licenses, local deviations, conflicts, and verification results.
Separate application diagnostics from plugin loading, test, and availability failures.
Never suppress findings or edit application source to make verification pass.

## Testing Decisions

Test observable behavior through two consumer boundaries.
The main boundary is the registered Pi tool, exercised with a fake Pi host and temporary repositories.
Use real filesystem changes and a real Biome 2.6.4 process for the installation and verification flow.
The fake host controls approval and cancellation without testing internal helper calls.

The second boundary is Biome itself.
After installation, make the extension bundle unavailable and invoke Biome against the repository-owned plugin.
This separate check is necessary because the installed plugin must work without Pi.
Exercise the actual target configuration rather than calling individual rule functions.

Use upstream valid and invalid examples for every ported rule.
Record their source revision and compare diagnostic behavior and locations.
Include shadowing, local aliases, type predicates, malformed syntax, comments, and the Effect test-file exception.
Test reducer and loop accumulator spreads alongside non-accumulator spreads.
Test both configurable rules with default and custom values.
Test spacing fixes with attached documentation, trailing comments, overloads, grouped bindings, and repeated fix and format passes.

Exercise installation with existing JSONC comments, inherited configuration, plugins, overrides, and includes.
Cover direct and transitive Effect dependencies and explicit Effect selection.
Cover destination collisions, dirty files, symbolic links, changed state after review, cancellation, and missing dependencies.
Make sure that declined or absent authorization produces no writes.

Exercise known-base and unknown-base updates, local deletions, conflicts, and partial updates.
Make sure that local choices and provenance survive each supported update.
Make sure that unrelated lint configuration remains unchanged.
Distinguish plugin load errors, findings, unavailable checks, test failures, and truncated output.

A complete release requires a per-rule parity report with no unresolved required behavior.
A partial release must list missing rules, options, fixes, and other known gaps before approval.
Do not claim compatibility from a successful plugin load alone.

## Out of Scope

- Automatic linting after every Pi edit or a project change at Pi startup.
- A global Biome policy or an overlay that replaces repository ownership.
- Migration from other linters.
- Removal or disablement of unrelated lint policy.
- Application code cleanup or suppression of findings.
- Biome versions that have not passed the compatibility tests.
- GritQL rules in the first release.

## Further Notes

The upstream installation skill uses repository-local ownership.
The reference upstream revision is 13909c9e07590f5a85d93c62712259fe14a883f7.
The [upstream skill](https://github.com/dmmulroy/anti-slop/blob/13909c9e07590f5a85d93c62712259fe14a883f7/skills/install-anti-slop/SKILL.md) and its rule fixtures define the behavior to port.

Research demonstrated that Biome 2.6.4 can load a TypeScript plugin and report diagnostics.
That proof does not establish full rule parity, option support, safe fixes, or configuration isolation.
A complete implementation must establish those behaviors through the tests above.
