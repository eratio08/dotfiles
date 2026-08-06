import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import todoExtension from "../index.ts";

type EventHandler = (event: unknown, ctx: ExtensionContext) => Promise<void> | void;

type SentMessage = {
	message: {
		customType: string;
		content: string;
		display: boolean;
	};
	options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" };
};

function harness(branch: unknown[] = [], idle = true) {
	const events = new Map<string, EventHandler>();
	const sentMessages: SentMessage[] = [];
	const pi = {
		on(event: string, handler: EventHandler) {
			events.set(event, handler);
		},
		registerTool() {},
		registerCommand() {},
		sendMessage(message: SentMessage["message"], options: SentMessage["options"]) {
			sentMessages.push({ message, options });
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		isIdle() {
			return idle;
		},
		sessionManager: {
			getBranch() {
				return branch;
			},
		},
	} as unknown as ExtensionContext;

	todoExtension(pi);

	return { ctx, events, sentMessages };
}

const branchWithTodos = [
	{
		type: "message",
		message: {
			role: "toolResult",
			toolName: "todowrite",
			details: {
				todos: [
					{ content: "first task", status: "in_progress", priority: "high" },
					{ content: "second task", status: "pending", priority: "low" },
				],
			},
		},
	},
];

async function restoreTodos(harnessValue: ReturnType<typeof harness>) {
	const sessionStart = harnessValue.events.get("session_start");
	assert.ok(sessionStart);
	await sessionStart({ type: "session_start", reason: "startup" }, harnessValue.ctx);
}

function compactionEvent(willRetry: boolean, reason: "manual" | "threshold" | "overflow") {
	return {
		type: "session_compact",
		compactionEntry: { id: "compaction-1" },
		fromExtension: false,
		reason,
		willRetry,
	};
}

test("adds one hidden snapshot after idle manual compaction without starting a turn", async () => {
	const value = harness(branchWithTodos, true);
	await restoreTodos(value);

	assert.equal(value.events.has("context"), false);
	const sessionCompact = value.events.get("session_compact");
	assert.ok(sessionCompact);
	await sessionCompact(compactionEvent(false, "manual"), value.ctx);

	assert.equal(value.sentMessages.length, 1);
	assert.equal(value.sentMessages[0]?.options?.triggerTurn, false);
	assert.equal(value.sentMessages[0]?.message.customType, "todo");
	assert.equal(value.sentMessages[0]?.message.display, false);
	assert.match(value.sentMessages[0]?.message.content ?? "", /first task/);
	assert.match(value.sentMessages[0]?.message.content ?? "", /in_progress/);
	assert.match(value.sentMessages[0]?.message.content ?? "", /high/);
	assert.match(value.sentMessages[0]?.message.content ?? "", /second task/);
});

test("queues one snapshot for the next prompt after active threshold compaction", async () => {
	const value = harness(branchWithTodos, false);
	await restoreTodos(value);

	const sessionCompact = value.events.get("session_compact");
	assert.ok(sessionCompact);
	await sessionCompact(compactionEvent(false, "threshold"), value.ctx);

	assert.deepEqual(value.sentMessages[0]?.options, { deliverAs: "nextTurn" });
});

test("steers one snapshot into overflow recovery", async () => {
	const value = harness(branchWithTodos, false);
	await restoreTodos(value);

	const sessionCompact = value.events.get("session_compact");
	assert.ok(sessionCompact);
	await sessionCompact(compactionEvent(true, "overflow"), value.ctx);

	assert.deepEqual(value.sentMessages[0]?.options, { deliverAs: "steer" });
});

test("does not send a snapshot when no todos are restored", async () => {
	const value = harness([], true);
	const sessionCompact = value.events.get("session_compact");
	assert.ok(sessionCompact);
	await sessionCompact(compactionEvent(false, "threshold"), value.ctx);

	assert.deepEqual(value.sentMessages, []);
});
