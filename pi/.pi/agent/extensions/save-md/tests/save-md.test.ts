import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { InMemoryCredentialStore, type AssistantMessage } from "@earendil-works/pi-ai";
import {
	discoverAndLoadExtensions,
	ExtensionRunner,
	ModelRegistry,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

const extensionPath = join(dirname(fileURLToPath(import.meta.url)), "..", "index.ts");

function assistantMessage(
	markdown: string,
	content: AssistantMessage["content"] = [{ type: "text", text: markdown }],
): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "test-model",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

async function createHarness(cwd: string) {
	const sessionManager = SessionManager.inMemory(cwd);
	const loaded = await discoverAndLoadExtensions([extensionPath], cwd, join(cwd, ".agent"));
	assert.deepEqual(loaded.errors, []);
	const modelRuntime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});

	const runner = new ExtensionRunner(
		loaded.extensions,
		loaded.runtime,
		cwd,
		sessionManager,
		new ModelRegistry(modelRuntime),
	);
	const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
	runner.setUIContext({
		...runner.getUIContext(),
		notify: (message, type) => notifications.push({ message, type }),
	});

	return { notifications, runner, sessionManager };
}

test("saves only assistant text blocks as Markdown", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));

	try {
		const { runner, sessionManager } = await createHarness(cwd);
		sessionManager.appendMessage(assistantMessage("ignored", [
			{ type: "thinking", thinking: "private reasoning" },
			{ type: "text", text: "first" },
			{ type: "toolCall", id: "tool-1", name: "read", arguments: {} },
			{ type: "text", text: "second" },
		]));

		const command = runner.getCommand("save-md");
		assert.ok(command);
		await command.handler("filtered", runner.createCommandContext());

		assert.equal(await readFile(join(cwd, "filtered.md"), "utf8"), "first\n\nsecond\n");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("rejects file names outside the current working directory", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));
	const escapedPath = join(cwd, "..", "escaped.md");

	try {
		const { notifications, runner, sessionManager } = await createHarness(cwd);
		sessionManager.appendMessage(assistantMessage("# Protected"));

		const command = runner.getCommand("save-md");
		assert.ok(command);
		await command.handler("../escaped", runner.createCommandContext());

		await assert.rejects(readFile(escapedPath));
		assert.deepEqual(notifications, [
			{
				message: "File name must stay inside the current working directory",
				type: "warning",
			},
		]);
	} finally {
		await rm(cwd, { recursive: true, force: true });
		await rm(escapedPath, { force: true });
	}
});

test("saves the latest assistant response as Markdown", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));

	try {
		const { notifications, runner, sessionManager } = await createHarness(cwd);
		const markdown = "# Design\n\n- Preserve **Markdown**\n\n```ts\nconst ready = true;\n```";
		sessionManager.appendMessage(assistantMessage(markdown));

		const command = runner.getCommand("save-md");
		assert.ok(command);
		await command.handler("design", runner.createCommandContext());

		const path = join(cwd, "design.md");
		assert.equal(await readFile(path, "utf8"), `${markdown}\n`);
		assert.deepEqual(notifications, [
			{ message: `Saved Markdown to ${path}`, type: "info" },
		]);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("preserves Markdown that already ends with a newline", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));

	try {
		const { runner, sessionManager } = await createHarness(cwd);
		const markdown = "Paragraph with deliberate trailing space  \n\n";
		sessionManager.appendMessage(assistantMessage(markdown));

		const command = runner.getCommand("save-md");
		assert.ok(command);
		await command.handler("verbatim.md", runner.createCommandContext());

		assert.equal(await readFile(join(cwd, "verbatim.md"), "utf8"), markdown);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("warns when the command has no file name", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));

	try {
		const { notifications, runner, sessionManager } = await createHarness(cwd);
		sessionManager.appendMessage(assistantMessage("# Unsaved"));

		const command = runner.getCommand("save-md");
		assert.ok(command);
		await command.handler("   ", runner.createCommandContext());

		assert.deepEqual(notifications, [
			{ message: "Usage: /save-md name", type: "warning" },
		]);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("does not overwrite an existing file", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));

	try {
		const path = join(cwd, "design.md");
		await writeFile(path, "existing content\n", "utf8");
		const { notifications, runner, sessionManager } = await createHarness(cwd);
		sessionManager.appendMessage(assistantMessage("# Replacement"));

		const command = runner.getCommand("save-md");
		assert.ok(command);
		await command.handler("design", runner.createCommandContext());

		assert.equal(await readFile(path, "utf8"), "existing content\n");
		assert.deepEqual(notifications, [
			{ message: `File already exists: ${path}`, type: "error" },
		]);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("saves the latest assistant response on the active branch", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));

	try {
		const { runner, sessionManager } = await createHarness(cwd);
		const activeAssistantId = sessionManager.appendMessage(assistantMessage("# Active branch"));
		sessionManager.appendMessage(assistantMessage("# Abandoned branch"));
		sessionManager.branch(activeAssistantId);

		const command = runner.getCommand("save-md");
		assert.ok(command);
		await command.handler("branch", runner.createCommandContext());

		assert.equal(await readFile(join(cwd, "branch.md"), "utf8"), "# Active branch\n");
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("warns when the latest assistant response has no Markdown text", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));

	try {
		const { notifications, runner, sessionManager } = await createHarness(cwd);
		sessionManager.appendMessage(assistantMessage("   "));

		const command = runner.getCommand("save-md");
		assert.ok(command);
		await command.handler("answer", runner.createCommandContext());

		assert.deepEqual(notifications, [
			{ message: "The latest assistant response has no Markdown text", type: "warning" },
		]);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("warns when there is no assistant response to save", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-save-md-"));

	try {
		const { notifications, runner } = await createHarness(cwd);

		const command = runner.getCommand("save-md");
		assert.ok(command);
		await command.handler("answer", runner.createCommandContext());

		assert.deepEqual(notifications, [
			{ message: "No assistant response to save", type: "warning" },
		]);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
