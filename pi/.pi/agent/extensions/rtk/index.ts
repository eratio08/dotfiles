import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function normalizeRewrite(command: string, stdout: string): string | null {
	const rewritten = stdout.trim();
	if (!rewritten || rewritten === command) {
		return null;
	}
	return rewritten;
}

export function resolveRewrite(command: string, result: { code: number; stdout: string }): string | null {
	return normalizeRewrite(command, result.stdout);
}

export default async function (pi: ExtensionAPI) {
	let enabled = false;

	try {
		const result = await pi.exec("rtk", ["--version"]);
		enabled = result.code === 0;
	} catch {}

	if (!enabled) {
		console.warn("[rtk] rtk binary not found in PATH — extension disabled");
		return;
	}

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") {
			return;
		}

		const command = event.input?.command;
		if (typeof command !== "string" || !command) {
			return;
		}

		try {
			const result = await pi.exec("rtk", ["rewrite", command], {
				signal: ctx.signal,
			});
			const rewritten = resolveRewrite(command, result);
			if (rewritten) {
				event.input.command = rewritten;
			}
		} catch {}
	});
}
