import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import gptContextModeExtension, {
	GPT5_HIGH_CONTEXT_WINDOW,
	parseGptContextCommand,
	restoreGptContextMode,
	type GptContextMode,
} from "../index.ts";

type Gpt5Model = Model<"openai-responses">;
type Command = { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> };
type EventHandler = (event: never, ctx: ExtensionContext) => Promise<void>;

function model(contextWindow = 272000): Gpt5Model {
	return {
		id: "gpt-5.6-sol",
		name: "GPT-5.6 Sol",
		api: "openai-responses",
		provider: "github-copilot",
		baseUrl: "https://api.enterprise.githubcopilot.com",
		reasoning: true,
		input: ["text", "image"],
		cost: { input: 5, output: 30, cacheRead: 0.5, cacheWrite: 6.25 },
		contextWindow,
		maxTokens: 128000,
	};
}

function contextHarness(initialModel = model()) {
	let activeModel = initialModel;
	const commands = new Map<string, Command>();
	const events = new Map<string, EventHandler>();
	const savedModes: Array<{ mode: GptContextMode }> = [];
	const notifications: string[] = [];
	const statuses: string[] = [];
	const modelChanges: Gpt5Model[] = [];
	let branch: unknown[] = [];
	let entries: unknown[] = [];

	const pi = {
		registerCommand(name: string, command: Command) {
			commands.set(name, command);
		},
		on(event: string, handler: EventHandler) {
			events.set(event, handler);
		},
		appendEntry(_type: string, data: { mode: GptContextMode }) {
			savedModes.push(data);
		},
		async setModel(nextModel: Gpt5Model) {
			activeModel = nextModel;
			modelChanges.push(nextModel);
		},
	} as unknown as ExtensionAPI;

	const ctx = {
		mode: "tui",
		hasUI: true,
		get model() {
			return activeModel;
		},
		ui: {
			notify(message: string) {
				notifications.push(message);
			},
			setStatus(_key: string, status: string | undefined) {
				if (status) statuses.push(status);
			},
		},
		sessionManager: {
			getBranch() {
				return branch;
			},
			getEntries() {
				return entries;
			},
		},
	} as unknown as ExtensionCommandContext;

	gptContextModeExtension(pi);

	return {
		commands,
		events,
		savedModes,
		notifications,
		statuses,
		modelChanges,
		ctx,
		setBranch(nextBranch: unknown[]) {
			branch = nextBranch;
		},
		setEntries(nextEntries: unknown[]) {
			entries = nextEntries;
		},
	};
}

test("parses high, low, and toggle context commands", () => {
	assert.equal(parseGptContextCommand("high", "low"), "high");
	assert.equal(parseGptContextCommand("low", "high"), "low");
	assert.equal(parseGptContextCommand("toggle", "low"), "high");
	assert.equal(parseGptContextCommand("", "high"), "low");
	assert.equal(parseGptContextCommand("unknown", "low"), undefined);
});

test("restores the latest saved context mode", () => {
	assert.equal(
		restoreGptContextMode([
			{ type: "custom", customType: "gpt-context-mode", data: { mode: "high" } },
			{ type: "custom", customType: "other", data: { mode: "low" } },
			{ type: "custom", customType: "gpt-context-mode", data: { mode: "low" } },
		]),
		"low",
	);
	assert.equal(restoreGptContextMode([]), "low");
});

test("switches the active GPT-5.6 model without changing its upstream identity", async () => {
	const harness = contextHarness();
	const command = harness.commands.get("gpt-context-mode");
	assert.ok(command);
	await command.handler("high", harness.ctx);

	assert.equal(harness.modelChanges.at(-1)?.contextWindow, GPT5_HIGH_CONTEXT_WINDOW);
	assert.equal(harness.modelChanges.at(-1)?.id, "gpt-5.6-sol");
	assert.equal(harness.modelChanges.at(-1)?.provider, "github-copilot");
	assert.equal(harness.modelChanges.at(-1)?.maxTokens, 128000);
	assert.deepEqual(harness.savedModes, [{ mode: "high" }]);
	assert.match(harness.statuses.at(-1) ?? "", /context: 🚀/);
});

test("returns to the configured low context window after high mode", async () => {
	const harness = contextHarness();
	const command = harness.commands.get("gpt-context-mode");
	assert.ok(command);

	await command.handler("high", harness.ctx);
	await command.handler("low", harness.ctx);

	assert.equal(harness.modelChanges.at(-1)?.contextWindow, 272000);
	assert.deepEqual(harness.savedModes, [{ mode: "high" }, { mode: "low" }]);
});

test("uses the documented default threshold for each GPT-5.6 model", async () => {
	const harness = contextHarness({ ...model(), id: "gpt-5.6-luna", contextWindow: GPT5_HIGH_CONTEXT_WINDOW });
	const command = harness.commands.get("gpt-context-mode");
	assert.ok(command);

	await command.handler("low", harness.ctx);

	assert.equal(harness.modelChanges.at(-1)?.contextWindow, 200000);
});

test("reapplies saved high mode after session restore and model selection", async () => {
	const harness = contextHarness();
	harness.setEntries([{ type: "custom", customType: "gpt-context-mode", data: { mode: "high" } }]);
	const sessionStart = harness.events.get("session_start");
	const modelSelect = harness.events.get("model_select");
	assert.ok(sessionStart);
	assert.ok(modelSelect);

	await sessionStart({} as never, harness.ctx);
	await modelSelect({
		model: model(),
		previousModel: undefined,
		source: "cycle",
	} as never, harness.ctx);

	assert.equal(harness.modelChanges.at(-1)?.contextWindow, GPT5_HIGH_CONTEXT_WINDOW);
});

test("restores a persisted mode from another branch during session start", async () => {
	const harness = contextHarness({ ...model(), contextWindow: GPT5_HIGH_CONTEXT_WINDOW });
	const activeBranchMode = { type: "custom", customType: "gpt-context-mode", data: { mode: "high" } };
	harness.setBranch([activeBranchMode]);
	harness.setEntries([
		activeBranchMode,
		{ type: "custom", customType: "gpt-context-mode", data: { mode: "low" } },
	]);
	const sessionStart = harness.events.get("session_start");
	assert.ok(sessionStart);

	await sessionStart({} as never, harness.ctx);

	assert.equal(harness.modelChanges.at(-1)?.contextWindow, 272000);
});

test("restores a persisted mode from another branch during session tree switching", async () => {
	const harness = contextHarness({ ...model(), contextWindow: GPT5_HIGH_CONTEXT_WINDOW });
	const activeBranchMode = { type: "custom", customType: "gpt-context-mode", data: { mode: "high" } };
	harness.setBranch([activeBranchMode]);
	harness.setEntries([
		activeBranchMode,
		{ type: "custom", customType: "gpt-context-mode", data: { mode: "low" } },
	]);
	const sessionTree = harness.events.get("session_tree");
	assert.ok(sessionTree);

	await sessionTree({} as never, harness.ctx);

	assert.equal(harness.modelChanges.at(-1)?.contextWindow, 272000);
});

test("does not alter other GPT-5 models", async () => {
	const harness = contextHarness({ ...model(), id: "gpt-5.5" });
	const command = harness.commands.get("gpt-context-mode");
	assert.ok(command);

	await command.handler("high", harness.ctx);

	assert.equal(harness.modelChanges.length, 0);
	assert.match(harness.notifications.at(-1) ?? "", /only applies to GPT-5\.6 models/);
});
