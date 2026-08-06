# Research: Preserve Todo State Across Pi Compaction
## Question
How should the local `todo` extension keep its accepted todo snapshot available after Pi compacts the conversation?
## Short answer
Corrected recommendation: do not inject the snapshot through `context` on every provider request.
That hook does not persist messages, but it still pays the full snapshot token cost on every request.
Add one hidden custom message at the compaction boundary through `session_compact`, then let Pi keep or queue that single message according to the compaction mode.
If the requirement is that the saved compaction summary itself contain the snapshot with no extra message, use `session_before_compact` with a custom summary path as a separate, more invasive feature.
## What Pi does
Pi fires `session_before_compact` before both `/compact` and automatic compaction, then runs the default compactor unless an extension returns a replacement compaction result.
[Extension lifecycle documentation](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/extensions.md#session_before_compact--session_compact) and [agent-session implementation](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/src/core/agent-session.ts)
The default compactor prepares `messagesToSummarize`, generates a summary from those messages, saves a `CompactionEntry`, and rebuilds the active context from the saved summary plus the kept entries.
[Compaction documentation](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/compaction.md) and [compaction implementation](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/src/core/compaction/compaction.ts)
Pi fires the `context` hook immediately before each normal provider request, and the event contains a deep copy that the extension may replace without mutating the session.
[Context-hook documentation](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/extensions.md#context) and [extension runner implementation](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/src/core/extensions/runner.ts)
The agent loop applies that context transform before converting messages for the provider, so it runs again on the post-compaction request and on an overflow-recovery retry.
[Agent-loop implementation](https://github.com/earendil-works/pi-mono/blob/main/packages/agent-core/src/agent-loop.ts)
The `context` hook does not run for the compaction summarization request itself because the compactor calls `convertToLlm()` and `serializeConversation()` directly.
[Compaction implementation](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/compaction/compaction.ts) and [message conversion implementation](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/messages.ts)
## What the local todo extension currently does
The extension keeps the accepted snapshot in a closure variable and restores it from the active session branch on `session_start` and `session_tree`.
[Local todo extension](../extensions/todo/index.ts)
The tool result stores the complete snapshot in `details.todos`, but its visible content contains only a count summary and the current-item reminder.
[Local todo extension](../extensions/todo/index.ts)
The compaction serializer reads user text, assistant text and tool-call arguments, and truncates tool-result content, but it does not read tool-result `details`.
[Compaction serializer](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/compaction/utils.ts)
Therefore the exact accepted list can disappear from the compaction input once its original `todowrite` call is outside the retained window.
The current reminder may help the summary model recover the active item, but it does not guarantee recovery of every todo or its priority.
## Options
### Recommended minimal: add one snapshot at the compaction boundary
Add one `pi.on("session_compact", ...)` handler to the todo extension.
When the snapshot is non-empty, create one hidden custom message whose content contains every todo's exact text, status, priority, and the existing `formatTodoReminder()` output.
A custom message participates in LLM context, while `display: false` keeps it out of the visible transcript.
[Custom-message documentation](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/extensions.md#pisendmessagemessage-options) and [message conversion implementation](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/src/core/messages.ts)
Build the content from the live `todos` closure so the newest accepted snapshot is used.
For `event.willRetry === true`, queue the message with `deliverAs: "steer"` so it is included in Pi's existing overflow retry.
For threshold compaction and manual compaction while Pi is active, queue it with `deliverAs: "nextTurn"` so it does not trigger an unsolicited model turn and is included with the next user prompt.
For an idle manual compaction, append it with `triggerTurn: false` so it is immediately part of the rebuilt session without starting a turn.
This adds at most one snapshot message per compaction rather than one message per provider request.
Older snapshot messages are ordinary context and can be summarized or discarded by later compaction, while the newest compaction adds the current one again.
A compact content shape is enough, for example `TODO STATUS: authoritative accepted snapshot` followed by one line per todo and the existing reminder.
### If the saved summary must contain the snapshot
Use `session_before_compact` to provide a custom compaction result that includes an exact todo block in the returned `summary`.
The official API allows an extension to replace the default result and exposes the prepared messages, previous summary, cut point, token estimate, and abort signal.
[Custom compaction documentation](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/compaction.md#session_before_compact) and [custom compaction example](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/examples/extensions/custom-compaction.ts)
This path must preserve Pi's normal summary behavior, split-turn handling, file-operation details, usage accounting, abort handling, and retry behavior, or it will create a second compaction implementation.
The public `compact()` helper can preserve much of the default behavior, but the extension must resolve auth and accept the limitations of not receiving the session's private stream and retry configuration.
Append the exact todo block after summary generation so the summary model cannot omit it.
Use this path only when the saved compaction entry itself must be authoritative, because it is more code than adding one post-compaction message.
### Not recommended
`pi.appendEntry()` is durable state storage, but custom entries do not participate in LLM context.
[State-persistence documentation](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/extensions.md#piappendentrycustomtype-data) and [session format](https://github.com/earendil-works/pi/blob/v0.83.0/packages/coding-agent/docs/session-format.md#customentry)
`session_compact` cannot alter the summary that was just generated, but it is the correct minimal hook for adding one current snapshot message after the compaction boundary.
A `context` hook that injects the snapshot on every request is not recommended because it repeats the token cost on every request even though the injected messages are not persisted.
Changing only the existing tool-result `details` is insufficient because the compaction serializer does not serialize that metadata.
Changing only the existing tool-result text is weaker because tool-result content is truncated during summarization and the summary model is free to omit details.
## Recommendation
Implement one hidden custom snapshot message from `session_compact`, with delivery chosen from `willRetry` and idle state.
Do not use `context` for this feature because it repeats the snapshot cost on every LLM request.
Keep `details.todos` as the persistence and restoration source of truth.
Add custom compaction only if the saved compaction entry must itself contain the complete authoritative todo list.
The todo extension now implements the recommended post-compaction snapshot message.
## Verification plan
Test the formatter with empty, active, completed, cancelled, and multi-item snapshots.
Test that threshold and manual compaction queue one `nextTurn` snapshot without triggering an unsolicited turn.
Test that idle manual compaction appends one snapshot directly with no new turn.
Test that overflow compaction queues one `steer` snapshot and the existing retry sees it.
Test repeated compactions and assert that no snapshot is injected between compaction events.
Test that `convertToLlm()` turns the custom message into provider-visible user content.
