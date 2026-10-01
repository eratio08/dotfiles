## Problem Statement
Pi Skill Toggle currently changes a skill's invocation mode, but it does not remove the skill from Pi's loaded resources.
A manual-only skill still loads and remains available through an explicit skill command.
Users need a separate way to disable a skill without changing its invocation mode or files.

## Solution
Add a skill enablement control beside the existing invocation-mode control.
Store a disabled choice as a minus-prefixed exact skill path in Pi's top-level `skills` setting.
Store the choice in the settings scope that matches the skill source.
On apply, write each changed settings file safely and reload Pi once after at least one successful change.
Keep disabled skills in the toggle list so users can enable them again.

## User Stories
1. As a Pi user, I want to disable a skill completely, so that Pi does not load it after reload.
2. As a Pi user, I want to enable a disabled skill, so that Pi can load it again when no other Pi rule excludes it.
3. As a Pi user, I want separate enablement and invocation controls, so that I can choose whether Pi loads a skill and how Pi invokes it.
4. As a Pi user, I want to distinguish a manual-only skill from a disabled skill, so that I know whether an explicit skill command will work.
5. As a Pi user, I want to re-enable a skill without changing its invocation mode, so that its previous invocation mode returns.
6. As a Pi user, I want to see a skill's enablement state in the list, so that I can review it before applying changes.
7. As a Pi user, I want disabled skills to remain in the list, so that I can enable them again.
8. As a Pi user, I want to search the skill list while retaining each skill's state, so that I can find a skill without losing track of its changes.
9. As a Pi user, I want a separate action for enablement, so that I do not change invocation mode by mistake.
10. As a Pi user, I want the existing Space action to keep changing invocation mode, so that the current interaction remains familiar.
11. As a Pi user, I want Ctrl+S to apply both enablement and invocation-mode changes, so that I can finish one editing session with one action.
12. As a Pi user, I want cancel to discard every staged change, so that an accidental action does not edit files.
13. As a Pi user, I want to disable a read-only skill when its Pi settings file is writable, so that skill-file permissions do not block settings changes.
14. As a Pi user, I want the extension to mark enablement read-only when its settings file is not writable, so that I know why I cannot change it.
15. As a Pi user, I want user and global skills to use user-level settings, so that their enablement follows their user scope.
16. As a project user, I want project skills to use project-level settings, so that their enablement stays with the project.
17. As a project user, I want project settings changes to require project trust, so that the extension follows Pi's trust rules.
18. As a Pi user, I want skill identity to use its exact resource path, so that two skills with the same name remain separate.
19. As a Pi user, I want repeated disable actions to create no duplicate exclusion, so that the settings list stays clean.
20. As a Pi user, I want enable to remove only the matching exact exclusion, so that unrelated settings remain unchanged.
21. As a Pi user, I want other Pi filters to remain unchanged, so that this extension does not override choices made elsewhere.
22. As a Pi user, I want a missing settings file or `skills` array to be created when needed, so that I can use the feature before I set other skill paths.
23. As a Pi user, I want malformed settings JSON to remain unchanged, so that a failed update does not destroy my configuration.
24. As a Pi user, I want an invalid `skills` value to produce a clear error, so that I can repair the settings file safely.
25. As a Pi user, I want concurrent settings edits to be detected, so that applying the dialog does not overwrite newer changes.
26. As a Pi user, I want the command to report successful and failed changes separately, so that I know which choices took effect.
27. As a Pi user, I want Pi to reload once after a successful change, so that the new enablement takes effect in the active session.
28. As a Pi user, I want cancel and no-op apply actions to skip reload, so that Pi does not restart resources unnecessarily.
29. As a Pi user, I want a disabled skill removed from Pi's loaded skill list and slash commands, so that it cannot be selected or invoked after reload.
30. As a Pi user, I want a manual-only skill to remain available through its explicit command, so that manual invocation remains distinct from disablement.
31. As a Pi user, I want the interface to distinguish toggle state from availability, so that other Pi rules are not hidden.
32. As a Pi user with a custom agent directory, I want user-level settings to use that directory, so that the feature changes the same configuration that Pi reads.
33. As a Pi user, I want multiple skill choices applied in one session, so that I can update several skills without reopening the list.

## Implementation Decisions
- Use the domain terms `enablement`, `availability`, and `invocation mode` as defined in the extension glossary.
- Keep invocation mode as `agent-invocable` or `manual-only` and continue to store it in skill frontmatter.
- Represent enablement with the exact exclusion entry supported by Pi's top-level `skills` setting.
- Use the absolute path of each discovered skill file as the exact setting target rather than its display name.
- Add one exact minus-prefixed path when disabling and remove only matching exact entries when enabling.
- Treat an enabled state as this extension's choice only, because other Pi filters and project trust can still affect effective availability.
- Preserve other Pi filters and do not add force-include entries to make an enabled skill override them.
- Use user-level settings for user and global sources and project-level settings for project and project-legacy sources.
- Do not write project-level settings until Pi grants project trust.
- Keep the current command flow as the coordinator and reuse the existing inventory, overlay, planner, writer, and file-system port.
- Have inventory read the extension's exact exclusion state, have the overlay stage enablement, have the planner prepare settings and frontmatter changes, and have the writer apply them.
- Base enablement editability on access to the matching settings file, not access to the skill file.
- Create a missing settings object or `skills` array without changing other settings.
- Reject malformed JSON, a non-string `skills` value, an unwritable settings file, an untrusted project scope, or a stale file without overwriting existing data.
- Write each changed file atomically and report partial success when separate changes fail.
- Reload Pi once after any successful settings or frontmatter write and skip reload after cancellation or a no-op.
- Limit the first version to skills that the current inventory discovers.

## Testing Decisions
- Good tests assert user-visible state, persisted settings, frontmatter, notifications, and reload behavior rather than private helper calls.
- Use the existing command scenario harness as the primary seam and run the real inventory, planner, and writer against the in-memory file system.
- Stub the Pi UI to supply the user's staged choices and stub reload to record whether the command reloaded Pi.
- Test disable, enable, duplicate prevention, settings preservation, invocation-mode preservation, project and user scope, reload count, cancellation, and no-op behavior through the command seam.
- Test invalid JSON, a malformed `skills` value, a stale settings file, missing write access, and untrusted project scope through the same command seam.
- Add one focused overlay test for the separate enablement action and visible state because the command seam does not exercise terminal input or rendering.
- Use the existing command scenarios, in-memory file-system writer tests, overlay tests, and extension registration test as prior art.
- Keep the tests in the existing Bun test setup and use the required `//given`, `//when`, and `//then` sections.

## Out of Scope
- Changing the meaning of `agent-invocable` or `manual-only`.
- Editing or deleting skill files as part of the new enablement control.
- Changing Pi's settings schema or implementation.
- Managing package-provided skills or skill paths that the current inventory does not discover.
- Rewriting glob filters, force-include entries, package filters, or settings from other tools.
- Showing the complete effective availability result when another Pi filter or trust rule controls it.
- Adding bulk selection or a new command.

## Further Notes
The extension area had no domain glossary or applicable ADR before this work.
The glossary now defines enablement separately from invocation mode and effective availability.
Pi's settings rules support exact minus-prefixed skill-path exclusions and apply them on reload.
The selected test seam is the command scenario with real services and an in-memory file system, plus one focused overlay test.
