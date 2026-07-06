import { spawn } from "node:child_process";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function runSg(args: string[], signal?: AbortSignal): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn("sg", args, { stdio: ["ignore", "pipe", "pipe"] });
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];

		child.stdout.on("data", (chunk) => stdout.push(chunk));
		child.stderr.on("data", (chunk) => stderr.push(chunk));
		child.on("error", reject);
		const onAbort = () => child.kill();
		signal?.addEventListener("abort", onAbort, { once: true });
		child.on("close", (exitCode) => {
			signal?.removeEventListener("abort", onAbort);
			resolve({
				exitCode: exitCode ?? 1,
				stdout: Buffer.concat(stdout).toString(),
				stderr: Buffer.concat(stderr).toString(),
			});
		});
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "ast_grep_search",
		label: "AST Grep Search",
		description: "Search code with ast-grep structural pattern matching",
		parameters: Type.Object({
			pattern: Type.String({ description: "AST pattern to match" }),
			path: Type.Optional(Type.String({ description: "Path to search" })),
			lang: Type.Optional(
				Type.Union([
					Type.Literal("typescript"),
					Type.Literal("tsx"),
					Type.Literal("javascript"),
					Type.Literal("python"),
					Type.Literal("rust"),
					Type.Literal("go"),
					Type.Literal("java"),
					Type.Literal("c"),
					Type.Literal("cpp"),
					Type.Literal("csharp"),
					Type.Literal("kotlin"),
					Type.Literal("swift"),
					Type.Literal("ruby"),
					Type.Literal("lua"),
					Type.Literal("elixir"),
					Type.Literal("html"),
					Type.Literal("css"),
					Type.Literal("json"),
					Type.Literal("yaml"),
				]),
			),
			json: Type.Optional(Type.Boolean({ description: "Output as JSON" })),
		}),
		async execute(_toolCallId, params, signal) {
			const args = ["--pattern", params.pattern];
			if (params.lang) args.push("--lang", params.lang);
			if (params.json) args.push("--json");
			args.push(params.path ?? ".");

			const result = await runSg(args, signal);
			if (result.exitCode !== 0 && result.stderr.trim()) {
				return {
					content: [{ type: "text", text: `Error: ${result.stderr}` }],
					details: {},
					isError: true,
				};
			}

			return {
				content: [{ type: "text", text: result.stdout.trim() || "No matches found." }],
				details: {},
			};
		},
	});

	pi.registerTool({
		name: "ast_grep_rewrite",
		label: "AST Grep Rewrite",
		description: "Rewrite code with ast-grep structural pattern matching",
		parameters: Type.Object({
			pattern: Type.String({ description: "AST pattern to match" }),
			rewrite: Type.String({ description: "Replacement pattern" }),
			path: Type.Optional(Type.String({ description: "Path to transform" })),
			lang: Type.Optional(Type.String({ description: "Language hint" })),
		}),
		async execute(_toolCallId, params, signal) {
			const args = ["--pattern", params.pattern, "--rewrite", params.rewrite, "--update-all"];
			if (params.lang) args.push("--lang", params.lang);
			args.push(params.path ?? ".");

			const result = await runSg(args, signal);
			if (result.exitCode !== 0 && result.stderr.trim()) {
				return {
					content: [{ type: "text", text: `Error: ${result.stderr}` }],
					details: {},
					isError: true,
				};
			}

			return {
				content: [{ type: "text", text: result.stdout.trim() || "No changes needed." }],
				details: {},
			};
		},
	});
}
