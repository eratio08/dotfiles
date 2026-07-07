import { Parser } from "htmlparser2";
import TurndownService from "turndown";

const BLOCK_TAGS = new Set([
	"address",
	"article",
	"aside",
	"blockquote",
	"br",
	"div",
	"dl",
	"fieldset",
	"figcaption",
	"figure",
	"footer",
	"form",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"header",
	"hr",
	"li",
	"main",
	"nav",
	"ol",
	"p",
	"pre",
	"section",
	"table",
	"tbody",
	"td",
	"th",
	"thead",
	"tr",
	"ul",
]);

function pushBreak(chunks: string[]) {
	const last = chunks[chunks.length - 1] ?? "";
	if (!last.endsWith("\n")) chunks.push("\n");
}

export function extractTextFromHTML(html: string): string {
	const chunks: string[] = [];
	let skipDepth = 0;
	const parser = new Parser({
		onopentag(name) {
			if (skipDepth > 0 || ["script", "style", "noscript", "iframe", "object", "embed"].includes(name)) {
				skipDepth += 1;
				return;
			}
			if (BLOCK_TAGS.has(name)) pushBreak(chunks);
		},
		ontext(text) {
			if (skipDepth === 0) chunks.push(text);
		},
		onclosetag(name) {
			if (skipDepth > 0) {
				skipDepth -= 1;
				return;
			}
			if (BLOCK_TAGS.has(name)) pushBreak(chunks);
		},
	});
	parser.write(html);
	parser.end();
	return chunks
		.join("")
		.replace(/\u00a0/g, " ")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n[ \t]+/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

export function convertHTMLToMarkdown(html: string): string {
	const turndown = new TurndownService({
		headingStyle: "atx",
		hr: "---",
		bulletListMarker: "-",
		codeBlockStyle: "fenced",
		emDelimiter: "*",
	});
	turndown.remove(["script", "style", "meta", "link"]);
	return turndown.turndown(html);
}
