import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

// Usage: /gpt-context-mode [low|high|toggle]; Ctrl+Shift+L toggles default/long context.
export const GPT5_HIGH_CONTEXT_WINDOW = 1_050_000;

const GPT5_6_LOW_CONTEXT_WINDOWS = new Map([
	["gpt-5.6-luna", 200_000],
	["gpt-5.6-sol", 272_000],
	["gpt-5.6-terra", 272_000],
]);

export type GptContextMode = "low" | "high";

const MODE_ENTRY = "gpt-context-mode";
const STATUS_KEY = "gpt-context-mode";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isGptContextMode(value: unknown): value is GptContextMode {
	return value === "low" || value === "high";
}

function contextModeEmoji(mode: GptContextMode): string {
	return mode === "low" ? "🪶" : "🚀";
}

function contextStatusLabel(ctx: ExtensionContext): string {
	return ctx.ui.theme?.fg ? ctx.ui.theme.fg("muted", "context: ") : "context: ";
}

export function parseGptContextCommand(
	args: string,
	currentMode: GptContextMode,
): GptContextMode | undefined {
	const command = args.trim().toLowerCase();
	if (!command || command === "toggle") {
		return currentMode === "low" ? "high" : "low";
	}
	if (command === "low" || command === "high") {
		return command;
	}
	return undefined;
}

export function restoreGptContextMode(
	branch: readonly unknown[],
	fallback: GptContextMode = "low",
): GptContextMode {
	let mode = fallback;
	for (const value of branch) {
		if (!isRecord(value) || value.type !== "custom" || value.customType !== MODE_ENTRY) {
			continue;
		}
		const data = value.data;
		if (isRecord(data) && isGptContextMode(data.mode)) {
			mode = data.mode;
		}
	}
	return mode;
}

function isGpt5Model(model: Model<Api> | undefined): model is Model<Api> {
	return model?.api === "openai-responses" && GPT5_6_LOW_CONTEXT_WINDOWS.has(model.id);
}

function modelKey(model: Model<Api>): string {
	return `${model.provider}/${model.id}`;
}

function contextModel(
	model: Model<Api>,
	mode: GptContextMode,
	lowContextWindow: number,
): Model<Api> {
	const contextWindow = mode === "high" ? GPT5_HIGH_CONTEXT_WINDOW : lowContextWindow;
	return model.contextWindow === contextWindow ? model : { ...model, contextWindow };
}

function updateStatus(ctx: ExtensionContext, mode: GptContextMode, model: Model<Api> | undefined): void {
	const active = isGpt5Model(model);
	ctx.ui.setStatus(
		STATUS_KEY,
		`${contextStatusLabel(ctx)}${contextModeEmoji(mode)}${active ? "" : " (inactive)"}`,
	);
}

export default function gptContextModeExtension(pi: ExtensionAPI): void {
	let mode: GptContextMode = "low";
	const lowContextWindows = new Map<string, number>();

	async function applyMode(model: Model<Api> | undefined, ctx: ExtensionContext): Promise<boolean> {
		if (!isGpt5Model(model)) {
			updateStatus(ctx, mode, model);
			return false;
		}

		const key = modelKey(model);
		const lowContextWindow = lowContextWindows.get(key) ?? GPT5_6_LOW_CONTEXT_WINDOWS.get(model.id) ?? model.contextWindow;
		lowContextWindows.set(key, lowContextWindow);
		const nextModel = contextModel(model, mode, lowContextWindow);
		if (nextModel !== model) {
			try {
				await pi.setModel(nextModel);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Unable to set GPT-5.6 context mode: ${message}`, "error");
				updateStatus(ctx, mode, model);
				return false;
			}
		}
		updateStatus(ctx, mode, nextModel);
		return true;
	}

	async function setMode(nextMode: GptContextMode, ctx: ExtensionContext): Promise<void> {
		mode = nextMode;
		pi.appendEntry(MODE_ENTRY, { mode });
		const model = ctx.model;
		const applied = await applyMode(model, ctx);
		if (!isGpt5Model(model)) {
			ctx.ui.notify("GPT-5.6 context mode only applies to GPT-5.6 models", "warning");
			return;
		}
		if (applied) {
			ctx.ui.notify(`${contextStatusLabel(ctx)}${contextModeEmoji(mode)}`, "info");
		}
	}

	async function runCommand(args: string, ctx: ExtensionContext): Promise<void> {
		const nextMode = parseGptContextCommand(args, mode);
		if (!nextMode) {
			ctx.ui.notify("Usage: /gpt-context-mode [high|low|toggle]", "warning");
			return;
		}
		await setMode(nextMode, ctx);
	}

	pi.registerCommand("gpt-context-mode", {
		description: "Switch GPT-5.6 between default and long context windows",
		handler: runCommand,
	});

	pi.registerShortcut("ctrl+shift+l", {
		description: "Toggle GPT-5.6 default and long context",
		handler: async (ctx) => runCommand("toggle", ctx),
	});

	pi.on("session_start", async (_event, ctx) => {
		mode = restoreGptContextMode(ctx.sessionManager.getBranch());
		await applyMode(ctx.model, ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		mode = restoreGptContextMode(ctx.sessionManager.getBranch());
		await applyMode(ctx.model, ctx);
	});

	pi.on("model_select", async (event, ctx) => {
		await applyMode(event.model, ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
	});
}
