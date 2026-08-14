import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import todoExtension from "../index.ts";

type EventHandler = (event: any, ctx: ExtensionContext) => Promise<any> | any;
type PlannotatorPhase = "idle" | "planning" | "executing";
type StatusRequest = { respond: (response: unknown) => void };
type SentMessage = {
	message: {
		customType: string;
		content: string;
		display: boolean;
	};
	options?: { triggerTurn?: boolean; deliverAs?: "steer" | "followUp" | "nextTurn" };
};

type RegisteredTool = {
	execute: (...args: any[]) => Promise<any>;
};

type RegisteredCommand = {
	handler: (...args: any[]) => Promise<void>;
};

function harness(branch: unknown[] = [], idle = true, phase?: PlannotatorPhase) {
	const events = new Map<string, EventHandler>();
	const sentMessages: SentMessage[] = [];
	const activeTools = ["read", "todowrite", "write"];
	const widgets = new Map<string, string[] | undefined>();
	const notifications: string[] = [];
	let registeredTool: RegisteredTool | undefined;
	let registeredCommand: RegisteredCommand | undefined;
	let currentPhase = phase;

	const theme = {
		fg(_color: string, text: string) {
			return text;
		},
		bold(text: string) {
			return text;
		},
		strikethrough(text: string) {
			return text;
		},
	};
	const pi = {
		on(event: string, handler: EventHandler) {
			events.set(event, handler);
		},
		registerTool(tool: RegisteredTool) {
			registeredTool = tool;
		},
		registerCommand(_name: string, command: RegisteredCommand) {
			registeredCommand = command;
		},
		sendMessage(message: SentMessage["message"], options: SentMessage["options"]) {
			sentMessages.push({ message, options });
		},
		getActiveTools() {
			return [...activeTools];
		},
		setActiveTools(next: string[]) {
			activeTools.splice(0, activeTools.length, ...next);
		},
		events: {
			emit(channel: string, data: StatusRequest) {
				if (channel === "plannotator:request" && currentPhase) {
					data.respond({ status: "handled", result: { phase: currentPhase } });
				}
			},
			on() {
				return () => {};
			},
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		hasUI: true,
		mode: "tui",
		ui: {
			theme,
			setWidget(key: string, content: string[] | undefined) {
				widgets.set(key, content);
			},
			notify(message: string) {
				notifications.push(message);
			},
			async custom() {
				return undefined;
			},
		},
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

	return {
		ctx,
		events,
		sentMessages,
		activeTools,
		widgets,
		notifications,
		get registeredTool() {
			return registeredTool;
		},
		get registeredCommand() {
			return registeredCommand;
		},
		setPhase(next: PlannotatorPhase | undefined) {
			currentPhase = next;
		},
	};
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

async function waitForTimers(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function restoreTodos(harnessValue: ReturnType<typeof harness>) {
	const sessionStart = harnessValue.events.get("session_start");
	assert.ok(sessionStart);
	await sessionStart({ type: "session_start", reason: "startup" }, harnessValue.ctx);
	await waitForTimers();
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

function approvedPlanResult(approved = true) {
	return {
		type: "tool_result",
		toolCallId: "plan-call",
		toolName: "plannotator_submit_plan",
		input: { filePath: "PLAN.md" },
		content: [],
		isError: !approved,
		details: { approved },
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

test("keeps local tracking enabled during planning", async () => {
	const value = harness(branchWithTodos, true, "planning");
	await restoreTodos(value);

	assert.ok(value.activeTools.includes("todowrite"));
	assert.notEqual(value.widgets.get("todo"), undefined);
});

test("suspends local tracking after automatic plan approval", async () => {
	const value = harness(branchWithTodos, true, "planning");
	await restoreTodos(value);
	value.setPhase("executing");

	const toolResult = value.events.get("tool_result");
	assert.ok(toolResult);
	await toolResult(approvedPlanResult(), value.ctx);

	assert.equal(value.activeTools.includes("todowrite"), false);
	assert.equal(value.widgets.get("todo"), undefined);

	const sessionCompact = value.events.get("session_compact");
	assert.ok(sessionCompact);
	await sessionCompact(compactionEvent(false, "manual"), value.ctx);
	assert.equal(value.sentMessages.length, 0);

	const result = await value.registeredTool?.execute(
		"todo-call",
		{ todos: [{ content: "new", status: "in_progress", priority: "high" }] },
		undefined,
		undefined,
		value.ctx,
	);
	assert.equal(result.details.error, "Todo tracking is disabled while Plannotator executes the approved plan.");
});

test("does not suspend local tracking for denied or external approval", async () => {
	const denied = harness(branchWithTodos, true, "planning");
	await restoreTodos(denied);
	const deniedResult = denied.events.get("tool_result");
	assert.ok(deniedResult);
	await deniedResult(approvedPlanResult(false), denied.ctx);
	assert.ok(denied.activeTools.includes("todowrite"));

	const external = harness(branchWithTodos, true, "idle");
	await restoreTodos(external);
	const externalResult = external.events.get("tool_result");
	assert.ok(externalResult);
	await externalResult(approvedPlanResult(), external.ctx);
	assert.ok(external.activeTools.includes("todowrite"));
});

test("restores local tracking when Plannotator returns to idle", async () => {
	const value = harness(branchWithTodos, true, "executing");
	await restoreTodos(value);
	assert.equal(value.activeTools.includes("todowrite"), false);

	value.setPhase("idle");
	const input = value.events.get("input");
	assert.ok(input);
	await input({ type: "input", text: "continue" }, value.ctx);

	assert.ok(value.activeTools.includes("todowrite"));
	assert.notEqual(value.widgets.get("todo"), undefined);
});

test("rejects /todos while suspended and allows it after idle", async () => {
	const value = harness(branchWithTodos, true, "executing");
	await restoreTodos(value);
	const command = value.registeredCommand?.handler;
	assert.ok(command);

	await command("", value.ctx);
	assert.match(value.notifications[0] ?? "", /disabled while Plannotator/);

	value.setPhase("idle");
	await command("", value.ctx);
	assert.equal(value.notifications.length, 1);
});

test("leaves tracking unchanged when Plannotator status is unavailable", async () => {
	const value = harness(branchWithTodos, true);
	await restoreTodos(value);
	const toolResult = value.events.get("tool_result");
	assert.ok(toolResult);
	await toolResult(approvedPlanResult(), value.ctx);

	assert.ok(value.activeTools.includes("todowrite"));
	assert.notEqual(value.widgets.get("todo"), undefined);
});
