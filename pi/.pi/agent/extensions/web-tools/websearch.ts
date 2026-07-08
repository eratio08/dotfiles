import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	defineTool,
	formatSize,
	truncateHead,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

export const WEBSEARCH_NAME = "websearch";
export const EXA_URL = "https://mcp.exa.ai/mcp";
export const PARALLEL_URL = "https://search.parallel.ai/mcp";
export const MAX_NUM_RESULTS = 20;
export const MAX_CONTEXT_CHARACTERS = 50000;
export const NO_RESULTS = "No search results found. Please try a different query.";

const PROVIDER_VALUES = ["exa", "parallel"] as const;
const LIVECRAWL_VALUES = ["fallback", "preferred"] as const;
const SEARCH_TYPE_VALUES = ["auto", "fast", "deep"] as const;

type WebSearchProvider = (typeof PROVIDER_VALUES)[number];

export interface WebSearchDetails {
	provider: WebSearchProvider;
	query: string;
	lineCount: number;
	preview: string[];
	truncated: boolean;
	fullOutputPath?: string;
}

const webSearchParameters = Type.Object({
	query: Type.String({ description: "Web search query" }),
	numResults: Type.Optional(Type.Number({ description: `Number of results to return. Default 8, max ${MAX_NUM_RESULTS}` })),
	livecrawl: Type.Optional(StringEnum(LIVECRAWL_VALUES, { description: "Live crawl mode: fallback or preferred" })),
	type: Type.Optional(StringEnum(SEARCH_TYPE_VALUES, { description: "Search type: auto, fast, or deep" })),
	contextMaxCharacters: Type.Optional(
		Type.Number({ description: `Maximum model context characters. Default 10000, max ${MAX_CONTEXT_CHARACTERS}` }),
	),
});

function exaUrl(apiKey: string | undefined): string {
	if (!apiKey) return EXA_URL;
	const url = new URL(EXA_URL);
	url.searchParams.set("exaApiKey", apiKey);
	return url.toString();
}

function clampInt(value: number | undefined, fallback: number, max: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.min(max, Math.max(1, Math.floor(value)));
}

export function hasWebSearchCredentials(env: NodeJS.ProcessEnv = process.env): boolean {
	return Boolean(env.EXA_API_KEY?.trim() || env.PARALLEL_API_KEY?.trim());
}

export function selectProvider(env: NodeJS.ProcessEnv = process.env): WebSearchProvider {
	const preferred = env.PI_WEBSEARCH_PROVIDER;
	const hasExa = Boolean(env.EXA_API_KEY?.trim());
	const hasParallel = Boolean(env.PARALLEL_API_KEY?.trim());
	if (preferred === "exa" || preferred === "parallel") return preferred;
	if (hasExa && !hasParallel) return "exa";
	if (hasParallel && !hasExa) return "parallel";
	return "exa";
}

export function parseSearchResponse(body: string): string | undefined {
	const parsePayload = (payload: string) => {
		const trimmed = payload.trim();
		if (!trimmed.startsWith("{")) return undefined;
		const parsed = JSON.parse(trimmed) as { result?: { content?: Array<{ text?: string }> } };
		return parsed.result?.content?.find((item) => typeof item.text === "string" && item.text.length > 0)?.text;
	};
	const direct = body.trim() ? parsePayload(body) : undefined;
	if (direct) return direct;
	for (const line of body.split("\n")) {
		if (!line.startsWith("data:")) continue;
		const text = parsePayload(line.slice(5));
		if (text) return text;
	}
	return undefined;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal) {
	const controller = new AbortController();
	const onAbort = () => controller.abort(signal?.reason);
	if (signal) {
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	}
	const timeout = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} catch (error) {
		if (controller.signal.aborted && !signal?.aborted) throw new Error("Request timed out");
		throw error;
	} finally {
		clearTimeout(timeout);
		if (signal) signal.removeEventListener("abort", onAbort);
	}
}

async function callJsonRpc(
	url: string,
	toolName: string,
	argumentsObject: Record<string, unknown>,
	headers: Record<string, string>,
	signal?: AbortSignal,
) {
	const response = await fetchWithTimeout(
		url,
		{
			method: "POST",
			headers: {
				Accept: "application/json, text/event-stream",
				"Content-Type": "application/json",
				...headers,
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: toolName,
					arguments: argumentsObject,
				},
			}),
		},
		25_000,
		signal,
	);
	if (!response.ok) {
		throw new Error(`${toolName} failed: HTTP ${response.status} ${response.statusText}`);
	}
	return parseSearchResponse(await response.text());
}

async function spillTruncatedOutput(prefix: string, output: string) {
	const tempDir = await mkdtemp(join(tmpdir(), `${prefix}-`));
	const fullOutputPath = join(tempDir, "output.txt");
	await withFileMutationQueue(fullOutputPath, async () => {
		await writeFile(fullOutputPath, output, "utf8");
	});
	return fullOutputPath;
}

function countLines(text: string): number {
	return text.length === 0 ? 0 : text.split("\n").length;
}

function truncateInline(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

export function previewLines(text: string, maxLines = 3, maxChars = 100): string[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, maxLines)
		.map((line) => truncateInline(line, maxChars));
}

export const webSearchTool = defineTool({
	name: WEBSEARCH_NAME,
	label: "websearch",
	description: `Search the public web for current information using Exa or Parallel. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.` ,
	promptSnippet: "Search the public web for current information",
	promptGuidelines: [
		"Use websearch when the user needs current public web information beyond the model cutoff.",
		"Use websearch before webfetch when the user needs discovery rather than one exact URL.",
	],
	parameters: webSearchParameters,
	renderCall(args, theme) {
		const query = truncateInline(typeof args.query === "string" ? args.query : "", 80);
		return new Text(
			`${theme.fg("toolTitle", theme.bold("websearch "))}${theme.fg("accent", query)}`,
			0,
			0,
		);
	},
	renderResult(result, { expanded, isPartial }, theme) {
		if (isPartial) return new Text(theme.fg("warning", "Searching..."), 0, 0);
		const details = result.details as WebSearchDetails | undefined;
		const content = result.content.find((item) => item.type === "text");
		const text = content?.type === "text" ? content.text : "";
		if (!details) return new Text(text || theme.fg("muted", "No results"), 0, 0);
		if (!expanded) {
			let summary = theme.fg("success", details.provider);
			summary += theme.fg("muted", ` • ${truncateInline(details.query, 80)}`);
			summary += theme.fg("dim", ` • ${details.lineCount} lines`);
			if (details.truncated) summary += theme.fg("warning", " • truncated");
			if (details.preview.length === 0) return new Text(summary, 0, 0);
			return new Text(`${summary}\n${theme.fg("toolOutput", details.preview.join("\n"))}`, 0, 0);
		}
		const body = new Text(theme.fg("toolOutput", text), 0, 0);
		if (!details.fullOutputPath) return body;
		const container = new Container();
		container.addChild(body);
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("dim", `Full output: ${details.fullOutputPath}`), 0, 0));
		return container;
	},
	async execute(toolCallId, params, signal, _onUpdate, ctx) {
		const provider = selectProvider();
		const numResults = clampInt(params.numResults, 8, MAX_NUM_RESULTS);
		const contextMaxCharacters = params.contextMaxCharacters === undefined
			? undefined
			: clampInt(params.contextMaxCharacters, 10000, MAX_CONTEXT_CHARACTERS);
		const text =
			provider === "parallel"
				? await callJsonRpc(
					PARALLEL_URL,
					"web_search",
					{
						objective: params.query,
						search_queries: [params.query],
						session_id: ctx.sessionManager.getSessionFile() ?? toolCallId,
					},
					{
						"User-Agent": "pi-web-tools",
						...(process.env.PARALLEL_API_KEY
							? { Authorization: `Bearer ${process.env.PARALLEL_API_KEY}` }
							: {}),
					},
					signal,
				)
				: await callJsonRpc(
					exaUrl(process.env.EXA_API_KEY),
					"web_search_exa",
					{
						query: params.query,
						type: params.type ?? "auto",
						numResults,
						livecrawl: params.livecrawl ?? "fallback",
						...(contextMaxCharacters ? { contextMaxCharacters } : {}),
					},
					{},
					signal,
				);
		const output = text ?? NO_RESULTS;
		const truncation = truncateHead(output, {
			maxBytes: DEFAULT_MAX_BYTES,
			maxLines: DEFAULT_MAX_LINES,
		});
		let resultText = truncation.content;
		let fullOutputPath: string | undefined;
		if (truncation.truncated) {
			fullOutputPath = await spillTruncatedOutput(`pi-${WEBSEARCH_NAME}-${randomBytes(4).toString("hex")}`, output);
			resultText += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${fullOutputPath}]`;
		}
		return {
			content: [{ type: "text", text: resultText }],
			details: {
				provider,
				query: params.query,
				lineCount: countLines(output),
				preview: previewLines(output),
				truncated: truncation.truncated,
				fullOutputPath,
			} satisfies WebSearchDetails,
		};
	},
});
