import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { initTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import readPdfExtension, { pagesToMarkdown, readPdf } from "../index.ts";

function pdfWithText(text: string): Buffer {
	const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${text}) Tj\nET\n`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	let pdf = "%PDF-1.4\n";
	const offsets = [0];
	for (let index = 0; index < objects.length; index++) {
		offsets.push(Buffer.byteLength(pdf));
		pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
	}
	const xrefOffset = Buffer.byteLength(pdf);
	pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
	pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
	return Buffer.from(pdf);
}

function loadTool() {
	let tool: any;
	readPdfExtension({
		registerTool(candidate: unknown) {
			tool = candidate;
		},
	} as ExtensionAPI);
	assert.ok(tool);
	assert.equal(tool.name, "read-pdf");
	assert.equal(tool.promptSnippet, "Read a PDF file and convert it to Markdown");
	return tool;
}

const theme = {
	fg: (_role: string, text: string) => text,
	bold: (text: string) => text,
};

test("converts extracted pages into Markdown headings and paragraphs", () => {
	assert.equal(
		pagesToMarkdown(["Title\n\nFirst paragraph\nsecond line", "  Another page  "]),
		"# Page 1\n\nTitle\n\nFirst paragraph\nsecond line\n\n# Page 2\n\nAnother page",
	);
});

test("reads a PDF and returns Markdown", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-read-pdf-"));
	try {
		const path = join(cwd, "sample.pdf");
		await writeFile(path, pdfWithText("Hello PDF"));
		assert.deepEqual(await readPdf(path), { markdown: "# Page 1\n\nHello PDF", pages: 1 });
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});

test("renders a compact result and expandable Markdown", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "pi-read-pdf-"));
	try {
		const path = join(cwd, "sample.pdf");
		await writeFile(path, pdfWithText("Hello PDF"));
		initTheme("dark");
		const tool = loadTool();
		const result = await tool.execute("call-1", { path: "sample.pdf" }, undefined, undefined, { cwd });
		const compact = tool.renderResult(result, { expanded: false, isPartial: false }, theme, { isError: false });
		const expanded = tool.renderResult(result, { expanded: true, isPartial: false }, theme, { isError: false });
		assert.match(compact.render(80).join("\n"), /1 page/);
		assert.match(expanded.render(80).join("\n"), /# Page 1[\s\S]*Hello PDF/);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
});
