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
	getMarkdownTheme,
	truncateHead,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { convertHTMLToMarkdown, extractTextFromHTML } from "./html.ts";

export const WEBFETCH_NAME = "webfetch";
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const MAX_TIMEOUT_SECONDS = 120;
export const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

const FORMAT_VALUES = ["text", "markdown", "html"] as const;

type WebFetchFormat = (typeof FORMAT_VALUES)[number];

export interface WebFetchDetails {
	url: string;
	host: string;
	contentType: string;
	mime: string;
	format: WebFetchFormat;
	lineCount: number;
	preview: string[];
	truncated: boolean;
	fullOutputPath?: string;
}

const webFetchParameters = Type.Object({
	url: Type.String({ description: "The HTTP or HTTPS URL to fetch content from" }),
	format: Type.Optional(StringEnum(FORMAT_VALUES, { description: "The format to return: text, markdown, or html" })),
	timeout: Type.Optional(Type.Number({ description: `Timeout in seconds. Default ${DEFAULT_TIMEOUT_SECONDS}, max ${MAX_TIMEOUT_SECONDS}` })),
});

const browserUserAgent =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36";

export function acceptHeaderForFormat(format: WebFetchFormat): string {
	switch (format) {
		case "markdown":
			return "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
		case "text":
			return "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
		case "html":
			return "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1";
	}
}

function normalizeHost(hostname: string): string {
	return hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
}

function isPrivateIpv4(hostname: string): boolean {
	if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
	const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
	if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return false;
	if (parts[0] === 10) return true;
	if (parts[0] === 127) return true;
	if (parts[0] === 192 && parts[1] === 168) return true;
	if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
	return false;
}

export function assertSafePublicHttpUrl(rawUrl: string): URL {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error(`Invalid URL: ${rawUrl}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("URL must use http:// or https://");
	}
	const hostname = normalizeHost(url.hostname);
	if (
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		hostname === "::1" ||
		hostname === "0:0:0:0:0:0:0:1" ||
		isPrivateIpv4(hostname)
	) {
		throw new Error(`Blocked private or localhost target: ${url.hostname}`);
	}
	return url;
}

function mimeFrom(contentType: string): string {
	return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function isTextualMime(mime: string): boolean {
	return (
		!mime ||
		mime.startsWith("text/") ||
		mime === "application/json" ||
		mime.endsWith("+json") ||
		mime === "application/xml" ||
		mime.endsWith("+xml") ||
		mime === "application/javascript" ||
		mime === "application/x-javascript"
	);
}

function clampTimeout(timeout: number | undefined): number {
	if (typeof timeout !== "number" || !Number.isFinite(timeout)) return DEFAULT_TIMEOUT_SECONDS;
	return Math.min(MAX_TIMEOUT_SECONDS, Math.max(1, Math.floor(timeout)));
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutSeconds: number, signal?: AbortSignal) {
	const controller = new AbortController();
	const onAbort = () => controller.abort(signal?.reason);
	if (signal) {
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	}
	const timeout = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutSeconds * 1000);
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

async function readResponseText(response: Response, signal?: AbortSignal): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) return response.text();
	const chunks: Buffer[] = [];
	let totalBytes = 0;
	while (true) {
		if (signal?.aborted) throw new Error("Operation aborted");
		const { done, value } = await reader.read();
		if (done) break;
		if (!value) continue;
		totalBytes += value.byteLength;
		if (totalBytes > MAX_RESPONSE_BYTES) {
			await reader.cancel();
			throw new Error(`Response too large (exceeds ${formatSize(MAX_RESPONSE_BYTES)})`);
		}
		chunks.push(Buffer.from(value));
	}
	return Buffer.concat(chunks).toString("utf8");
}

function convertContent(content: string, contentType: string, format: WebFetchFormat): string {
	if (!contentType.toLowerCase().includes("text/html")) return content;
	if (format === "markdown") return convertHTMLToMarkdown(content);
	if (format === "text") return extractTextFromHTML(content);
	return content;
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

export const webFetchTool = defineTool({
	name: WEBFETCH_NAME,
	label: "webfetch",
	description: `Fetch content from an HTTP or HTTPS URL and return it as text, markdown, or HTML. Markdown is the default. Output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}.` ,
	promptSnippet: "Fetch text or HTML content from a public web URL",
	promptGuidelines: [
		"Use webfetch when the user wants a specific public web page or document fetched.",
		"Use webfetch instead of bash curl for normal public HTTP or HTTPS page retrieval.",
	],
	parameters: webFetchParameters,
	renderCall(args, theme) {
		const format = typeof args.format === "string" ? args.format : "markdown";
		let target = typeof args.url === "string" ? args.url : "";
		try {
			target = new URL(target).host || target;
		} catch {}
		return new Text(
			`${theme.fg("toolTitle", theme.bold("webfetch "))}${theme.fg("accent", target)}${theme.fg("muted", ` ${format}`)}`,
			0,
			0,
		);
	},
	renderResult(result, { expanded, isPartial }, theme) {
		if (isPartial) return new Text(theme.fg("warning", "Fetching..."), 0, 0);
		const details = result.details as WebFetchDetails | undefined;
		const content = result.content.find((item) => item.type === "text");
		const text = content?.type === "text" ? content.text : "";
		if (!details) return new Text(text || theme.fg("muted", "No content"), 0, 0);
		if (!expanded) {
			let summary = theme.fg("success", details.host);
			summary += theme.fg("muted", ` • ${details.format} • ${details.mime || details.contentType || "unknown"}`);
			summary += theme.fg("dim", ` • ${details.lineCount} lines`);
			if (details.truncated) summary += theme.fg("warning", " • truncated");
			if (details.preview.length === 0) return new Text(summary, 0, 0);
			return new Text(`${summary}\n${theme.fg("toolOutput", details.preview.join("\n"))}`, 0, 0);
		}
		const body = details.format === "markdown"
			? new Markdown(text, 0, 0, getMarkdownTheme())
			: new Text(theme.fg("toolOutput", text), 0, 0);
		if (!details.fullOutputPath) return body;
		const container = new Container();
		container.addChild(body);
		container.addChild(new Spacer(1));
		container.addChild(new Text(theme.fg("dim", `Full output: ${details.fullOutputPath}`), 0, 0));
		return container;
	},
	async execute(_toolCallId, params, signal) {
		const format = (params.format ?? "markdown") as WebFetchFormat;
		const timeoutSeconds = clampTimeout(params.timeout);
		const safeUrl = assertSafePublicHttpUrl(params.url);
		const url = safeUrl.toString();
		const response = await fetchWithTimeout(
			url,
			{
				headers: {
					"User-Agent": browserUserAgent,
					Accept: acceptHeaderForFormat(format),
					"Accept-Language": "en-US,en;q=0.9",
				},
			},
			timeoutSeconds,
			signal,
		);
		if (!response.ok) {
			throw new Error(`Unable to fetch ${url}: HTTP ${response.status} ${response.statusText}`);
		}
		const contentType = response.headers.get("content-type") ?? "";
		const mime = mimeFrom(contentType);
		if (mime.startsWith("image/")) {
			throw new Error(`Unsupported fetched image content type: ${mime}`);
		}
		if (!isTextualMime(mime)) {
			throw new Error(`Unsupported fetched file content type: ${mime || "unknown"}`);
		}
		const rawContent = await readResponseText(response, signal);
		const converted = convertContent(rawContent, contentType, format);
		const truncation = truncateHead(converted, {
			maxBytes: DEFAULT_MAX_BYTES,
			maxLines: DEFAULT_MAX_LINES,
		});
		let text = truncation.content;
		let fullOutputPath: string | undefined;
		if (truncation.truncated) {
			fullOutputPath = await spillTruncatedOutput(`pi-${WEBFETCH_NAME}-${randomBytes(4).toString("hex")}`, converted);
			text += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${fullOutputPath}]`;
		}
		return {
			content: [{ type: "text", text }],
			details: {
				url,
				host: safeUrl.host,
				contentType,
				mime,
				format,
				lineCount: countLines(converted),
				preview: previewLines(converted),
				truncated: truncation.truncated,
				fullOutputPath,
			} satisfies WebFetchDetails,
		};
	},
});
