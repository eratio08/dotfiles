import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	DEFAULT_MODE,
	getModeInstructions,
	parseCavemanCommand,
	parseModeChange,
	resolveSessionMode,
	type CavemanMode,
} from "./core.ts";

const SAVE_TYPE = "caveman-mode";
const LEVEL_ICONS: Record<Exclude<CavemanMode, "off">, string> = {
	lite: "🌿",
	full: "⚡",
	ultra: "🔥",
	"wenyan-lite": "🌿",
	"wenyan-full": "⚡",
	"wenyan-ultra": "🔥",
};

function syncStatus(ctx: ExtensionContext | null, mode: CavemanMode, isActive: boolean) {
	if (!ctx?.ui?.setStatus || !ctx.ui.theme?.fg) return;
	if (mode === "off") {
		ctx.ui.setStatus("caveman", "");
		return;
	}
	const theme = ctx.ui.theme;
	const indicator = isActive ? theme.fg("accent", "●") : theme.fg("dim", "○");
	const icon = LEVEL_ICONS[mode as Exclude<CavemanMode, "off">] ?? "🪨";
	const label = mode.toUpperCase();
	ctx.ui.setStatus("caveman", indicator + " 🪨 " + theme.fg("muted", "caveman: ") + theme.fg("text", icon + " " + label));
}

function restoreMode(ctx: ExtensionContext, fallbackMode: CavemanMode) {
	return resolveSessionMode(ctx.sessionManager.getBranch(), fallbackMode);
}

export default function cavemanExtension(pi: ExtensionAPI) {
	let currentMode: CavemanMode = DEFAULT_MODE;
	let lastCtx: ExtensionContext | null = null;
	let isActive = false;

	function setMode(mode: CavemanMode, ctx?: ExtensionContext | null, notify = true) {
		currentMode = mode;
		pi.appendEntry(SAVE_TYPE, { mode });
		if (ctx) lastCtx = ctx;
		syncStatus(ctx ?? lastCtx, currentMode, isActive);
		if (notify) {
			(ctx ?? lastCtx)?.ui?.notify?.(`caveman: ${currentMode}`, "info");
		}
	}

	function sendAlias(skillName: string, args: string, ctx?: ExtensionContext | null) {
		const suffix = String(args || "").trim();
		const message = suffix ? `/skill:${skillName} ${suffix}` : `/skill:${skillName}`;
		if (ctx?.isIdle?.() === false) {
			pi.sendUserMessage(message, { deliverAs: "followUp" });
			ctx.ui.notify(`${skillName} queued`, "info");
			return;
		}
		pi.sendUserMessage(message);
	}

	pi.registerCommand("caveman", {
		description: "Set caveman mode: off|lite|full|ultra|wenyan-lite|wenyan-full|wenyan-ultra",
		handler: async (args, ctx) => {
			lastCtx = ctx;
			const parsed = parseCavemanCommand(args, DEFAULT_MODE);
			if (parsed.type !== "set-mode") {
				ctx.ui.notify("Unknown caveman mode", "warning");
				return;
			}
			setMode(parsed.mode, ctx);
		},
	});

	pi.registerCommand("caveman-commit", {
		description: "Run /skill:caveman-commit",
		handler: async (args, ctx) => sendAlias("caveman-commit", args, ctx),
	});

	pi.registerCommand("caveman-review", {
		description: "Run /skill:caveman-review",
		handler: async (args, ctx) => sendAlias("caveman-review", args, ctx),
	});

	pi.registerCommand("caveman-compress", {
		description: "Run /skill:caveman-compress",
		handler: async (args, ctx) => sendAlias("caveman-compress", args, ctx),
	});

	pi.on("session_start", async (_event, ctx) => {
		lastCtx = ctx;
		currentMode = restoreMode(ctx, DEFAULT_MODE);
		syncStatus(ctx, currentMode, isActive);
	});

	pi.on("session_tree", async (_event, ctx) => {
		lastCtx = ctx;
		currentMode = restoreMode(ctx, DEFAULT_MODE);
		syncStatus(ctx, currentMode, isActive);
	});

	pi.on("agent_start", async (_event, ctx) => {
		lastCtx = ctx;
		isActive = true;
		syncStatus(ctx, currentMode, isActive);
	});

	pi.on("agent_end", async (_event, ctx) => {
		lastCtx = ctx;
		isActive = false;
		syncStatus(ctx, currentMode, isActive);
	});

	pi.on("input", async (event) => {
		if (event.source === "extension") return { action: "continue" };
		const nextMode = parseModeChange(event.text, DEFAULT_MODE);
		if (nextMode) {
			setMode(nextMode, lastCtx, false);
		}
		return { action: "continue" };
	});

	pi.on("before_agent_start", async (event) => {
		if (!currentMode || currentMode === "off") return;
		const instructions = getModeInstructions(currentMode);
		if (!instructions) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${instructions}`,
		};
	});
}
