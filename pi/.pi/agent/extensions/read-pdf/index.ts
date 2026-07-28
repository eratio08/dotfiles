import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	keyHint,
	truncateHead,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { extractText } from "unpdf";

export interface PdfReaderDetails {
	path: string;
	pages: number;
	markdownBytes: number;
	truncated: boolean;
	fullOutputPath?: string;
}

export function pagesToMarkdown(pages: readonly string[]): string {
	return pages
		.map((page, index) => {
			const lines = page
				.replace(/\r\n?/g, "\n")
				.split("\n")
				.map((line) => line.replace(/[ \t]+/g, " ").trim());
			const paragraphs: string[] = [];
			let paragraph: string[] = [];
			for (const line of lines) {
				if (line) {
					paragraph.push(line);
				} else if (paragraph.length > 0) {
					paragraphs.push(paragraph.join("\n"));
					paragraph = [];
				}
			}
			if (paragraph.length > 0) paragraphs.push(paragraph.join("\n"));
			return `# Page ${index + 1}${paragraphs.length > 0 ? `\n\n${paragraphs.join("\n\n")}` : ""}`;
		})
		.join("\n\n");
}

export async function readPdf(path: string, signal?: AbortSignal): Promise<{ markdown: string; pages: number }> {
	if (signal?.aborted) throw new Error("Operation aborted");
	const data = await readFile(path);
	if (signal?.aborted) throw new Error("Operation aborted");
	const extracted = await extractText(new Uint8Array(data), { mergePages: false });
	if (signal?.aborted) throw new Error("Operation aborted");
	return { markdown: pagesToMarkdown(extracted.text), pages: extracted.totalPages };
}

const parameters = Type.Object({
	path: Type.String({ description: "Path to a PDF file, relative to the current working directory" }),
});

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "read-pdf",
		label: "read-pdf",
		description: "Read a PDF file and convert its extracted text to Markdown. Output is limited to 50KB or 2000 lines; truncated output is saved to a temporary Markdown file.",
		promptSnippet: "Read a PDF file and convert it to Markdown",
		promptGuidelines: ["Use read-pdf instead of treating a PDF as plain text."],
		parameters,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const absolutePath = resolve(ctx.cwd, params.path);
			const { markdown, pages } = await readPdf(absolutePath, signal);
			const truncation = truncateHead(markdown, {
				maxBytes: DEFAULT_MAX_BYTES,
				maxLines: DEFAULT_MAX_LINES,
			});
			let text = truncation.content;
			let fullOutputPath: string | undefined;
			if (truncation.truncated) {
				fullOutputPath = join(tmpdir(), `pi-read-pdf-${randomUUID()}.md`);
				await writeFile(fullOutputPath, markdown, "utf8");
				text += `\n\n[Output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Full output saved to: ${fullOutputPath}]`;
			}
			return {
				content: [{ type: "text", text }],
				details: {
					path: params.path,
					pages,
					markdownBytes: Buffer.byteLength(markdown),
					truncated: truncation.truncated,
					fullOutputPath,
				} satisfies PdfReaderDetails,
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(theme.fg("toolTitle", theme.bold("read-pdf ")) + theme.fg("muted", args.path));
			return text;
		},
		renderResult(result, { expanded, isPartial }, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			if (isPartial) {
				text.setText(theme.fg("warning", "Reading PDF..."));
				return text;
			}
			const content = result.content.find((item) => item.type === "text");
			const details = result.details as PdfReaderDetails | undefined;
			if (!details || context.isError) {
				text.setText(theme.fg(context.isError ? "error" : "muted", content?.type === "text" ? content.text : ""));
				return text;
			}
			if (expanded) {
				text.setText(theme.fg("toolOutput", content?.type === "text" ? content.text : ""));
				return text;
			}
			const size = formatSize(details.markdownBytes);
			text.setText(`${theme.fg("success", "✓")} ${details.pages} page${details.pages === 1 ? "" : "s"}, ${size}${theme.fg("muted", ` (${keyHint("app.tools.expand", "to expand")})`)}`);
			return text;
		},
	});
}
