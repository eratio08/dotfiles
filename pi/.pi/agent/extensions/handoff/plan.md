# Same-session handoff plan

## Decision

Use same-session tree branching instead of `ctx.newSession()`.
The minimal supported branch point is the first stored session entry.
That preserves the original root user message and the generated handoff prompt.
If the requirement is zero previous messages, add a Pi host seam for `resetLeaf()` first.
Do not cast the read-only `ctx.sessionManager` to a mutable `SessionManager`.

## Current call flow

```text
/handoff
  ├─ read current branch and selected model
  ├─ load optional Todo snapshot
  ├─ serialize conversation
  ├─ show BorderedLoader
  │    └─ call modelRegistry.complete()
  ├─ ctx.newSession()
  │    ├─ append handoff model state
  │    ├─ append hidden Todo context
  │    └─ send generated prompt
  └─ new session before_agent_start
       ├─ restore model and thinking level
       └─ Todo extension restores Todo state
```

## Target call flow

```text
/handoff
  ├─ wait for current agent to become idle
  ├─ read current branch, model, and Todo snapshot
  ├─ generate handoff prompt
  │    └─ cancellable model completion
  ├─ navigateTree(branchPointId, { summarize: false })
  │    ├─ Pi runs session_before_tree handlers
  │    ├─ Pi moves the leaf to the branch point
  │    └─ Todo session_tree handler restores branch state
  ├─ append HANDOFF_MODEL_ENTRY to the new branch
  ├─ append hidden Todo snapshot when the branch needs it
  ├─ send generated prompt as a user message
  │    ├─ handoff before_agent_start restores model
  │    ├─ Todo before_agent_start restores injected snapshot
  │    └─ Pi starts the agent turn
  └─ old branch remains available through /tree
```

All fallible work happens before tree navigation.
If generation is cancelled or fails, the active branch remains unchanged.
After navigation, append-only behavior means a failed final send can leave a branch without its user message, so the command must report that failure clearly.

## Effect architecture

Follow the existing Todo architecture.

### `handoff/index.ts`

Keep this file as the Pi adapter and composition root.

It should:
- Create one `ManagedRuntime`.
- Register the `/handoff` command.
- Register `before_agent_start`.
- Dispose the runtime once during `session_shutdown`.
- Convert Pi callbacks into `runtime.runPromise(...)` calls.
- Keep UI notifications at the outer boundary.

It should not contain conversation preparation, branching, Todo integration, or model restoration logic.

### `handoff/src/effects.ts`

Add a `HandoffEffects` `Context.Service`.

Expose a small interface:

```text
run(commandContext)
restoreModel(extensionContext)
```

Implement `HandoffEffectsLayer(pi)` with `Layer.effect`.
Use `Effect.gen` for the workflow.
Use `Effect.sync` for synchronous Pi calls.
Use `Effect.tryPromise` for model and session operations.
Use an Effect callback bridge for the `ctx.ui.custom()` loader if outer cancellation must control it.

The service owns this sequence:

```text
waitForIdle
prepare current branch
generate prompt
navigate branch
persist continuation state
send user message
```

The service should return typed errors for generation and navigation failures.
Cancellation should be a normal result, not an exception.

### Pure handoff logic

Keep `handoff/src/handoff-model.ts` pure.

Add pure helpers only when they reduce orchestration complexity, such as:
- Select the branch point.
- Build the handoff model state.
- Build the Todo continuation message.
- Build the serialized conversation input.

Do not put Pi calls or UI calls in these helpers.

### Todo integration

Do not depend on `TodoEffects` or `TodoStore` from the handoff extension.
Those services belong to the Todo extension runtime.

Keep the existing optional dynamic import of `todo/src/state.ts`.
Wrap it in an Effect adapter that returns no integration when Todo is unavailable.
Use only the stable pure functions:

```text
extractLatestTodoSnapshot
getTodoHandoffSnapshot
formatTodoContext
```

After branching, send the hidden Todo custom message before the handoff user message.
This gives the Todo extension a branch-local snapshot without coupling the two Effect runtimes.

### Model restoration

Reuse the existing custom-entry protocol.

After successful branching:

```text
append HANDOFF_MODEL_ENTRY
send handoff prompt
```

The existing `before_agent_start` handler then:
- Finds the pending model state on the active branch.
- Calls `pi.setModel()`.
- Restores the thinking level.
- Appends `HANDOFF_MODEL_APPLIED_ENTRY`.

This keeps model restoration branch-local and avoids adding a second model-state mechanism.

## Ordered implementation steps

1. Add `handoff/src/effects.ts` with `HandoffEffects`, `HandoffEffectsLayer`, typed errors, and the command workflow.
2. Move conversation preparation and prompt generation out of `handoff/index.ts`.
3. Replace `ctx.newSession()` with `ctx.navigateTree(branchPointId, { summarize: false })`.
4. Append model state and the hidden Todo snapshot only after navigation succeeds.
5. Send the generated prompt with `pi.sendUserMessage()`.
6. Move model restoration into the Effect service while preserving `getPendingHandoffModel()`.
7. Add the handoff runtime and shutdown lifecycle to `handoff/index.ts`.
8. Add `effect` and TypeScript dependencies to `handoff/package.json`.
9. Add a handoff type-check script and update `handoff/bun.lock`.
10. Keep `todo/src/effects.ts` unchanged unless a test exposes a real branch-sync defect.

## Test plan

Add `handoff/tests/handoff-flow.test.ts`.

Test through the extension command and event seams.

Cover:
- Generation cancellation does not navigate or append entries.
- Generation failure does not navigate.
- Navigation uses the selected branch point and `summarize: false`.
- `newSession()` is never called.
- The session file and session ID remain unchanged.
- The old branch remains available.
- Model metadata is appended before the handoff user message.
- Hidden Todo context is appended before the handoff user message.
- The handoff prompt becomes the new user node.
- A cancelled tree navigation leaves the current branch untouched.
- `before_agent_start` restores the captured model and thinking level.
- Missing Todo integration does not block handoff.
- Runtime disposal happens once.

Keep existing `handoff-model.test.ts` for pure state parsing.
Reuse the existing Todo tests for restoration of `custom_message` snapshots.
Run the handoff and Todo tests because the new call flow crosses both extensions.

## Acceptance criteria

- `/handoff` stays in the current session file.
- `/tree` shows both the old branch and the handoff branch.
- The active branch contains only entries through the chosen branch point plus the handoff state and prompt.
- The original root prompt remains when branching from the first stored entry.
- No branch summary is generated automatically.
- Todo state is available to the new agent on the handoff branch.
- Model and thinking-level state match the values captured before generation.
- `/handoff` remains cancellable before branch mutation.
- `bun run check`, `bun run typecheck`, and the focused tests pass.
