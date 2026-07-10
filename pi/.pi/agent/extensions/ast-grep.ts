import { spawn } from "node:child_process";
import { Type } from "@earendil-works/pi-ai";
import { keyHint, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

interface AstGrepDetails {
	output: string;
	summary: string;
}

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
		description: "Structurally search code with ast-grep. Use `$NAME` for one AST node and `$$$NAMES` for zero or more nodes. Set `lang` for reliable parsing, narrow `path` when possible, and set `json: true` for structured match locations. Use this before ast_grep_rewrite.",
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
					details: { output: `Error: ${result.stderr}`, summary: "Search failed." } satisfies AstGrepDetails,
					isError: true,
				};
			}

			const output = result.stdout.trim();
			return {
				content: [{ type: "text", text: output || "No matches found." }],
				details: { output, summary: output ? "Search completed." : "No matches found." } satisfies AstGrepDetails,
			};
		},
		renderResult(result, { expanded, isPartial }, theme, context) {
			const text = context.lastComponent as Text | undefined ?? new Text("", 0, 0);
			if (isPartial) {
				text.setText(theme.fg("warning", "Searching..."));
				return text;
			}
			const details = result.details as AstGrepDetails | undefined;
			const content = result.content.find((item) => item.type === "text");
			const output = details?.output ?? (content?.type === "text" ? content.text : "");
			const summary = details?.summary ?? "Search completed.";
			text.setText(expanded && output ? theme.fg("toolOutput", output) : `${theme.fg("success", summary)}${expanded ? "" : theme.fg("muted", ` (${keyHint("app.tools.expand", "to expand")})`)}`);
			return text;
		},
	});

	pi.registerTool({
		name: "ast_grep_rewrite",
		label: "AST Grep Rewrite",
		description: "Structurally rewrite code with ast-grep and update matching files in place. First use ast_grep_search with the same `pattern`, `path`, and `lang` to verify matches. Use `$NAME` and `$$$NAMES` consistently between `pattern` and `rewrite`. Narrow `path` to avoid unintended edits.",
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
					details: { output: `Error: ${result.stderr}`, summary: "Rewrite failed." } satisfies AstGrepDetails,
					isError: true,
				};
			}

			const output = result.stdout.trim();
			return {
				content: [{ type: "text", text: output || "Rewrite completed." }],
				details: { output, summary: "Rewrite completed." } satisfies AstGrepDetails,
			};
		},
		renderResult(result, { expanded, isPartial }, theme, context) {
			const text = context.lastComponent as Text | undefined ?? new Text("", 0, 0);
			if (isPartial) {
				text.setText(theme.fg("warning", "Rewriting..."));
				return text;
			}
			const details = result.details as AstGrepDetails | undefined;
			const content = result.content.find((item) => item.type === "text");
			const output = details?.output ?? (content?.type === "text" ? content.text : "");
			const summary = details?.summary ?? "Rewrite completed.";
			text.setText(expanded && output ? theme.fg("toolOutput", output) : `${theme.fg("success", summary)}${expanded ? "" : theme.fg("muted", ` (${keyHint("app.tools.expand", "to expand")})`)}`);
			return text;
		},
	});
}
