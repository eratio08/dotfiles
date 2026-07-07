import assert from "node:assert/strict";
import test from "node:test";
import { convertHTMLToMarkdown, extractTextFromHTML } from "./html.ts";
import { acceptHeaderForFormat, assertSafePublicHttpUrl } from "./webfetch.ts";

test("webfetch blocks localhost and private IPv4", () => {
	assert.throws(() => assertSafePublicHttpUrl("http://localhost"));
	assert.throws(() => assertSafePublicHttpUrl("http://127.0.0.1"));
	assert.throws(() => assertSafePublicHttpUrl("http://192.168.1.10"));
	assert.doesNotThrow(() => assertSafePublicHttpUrl("https://example.com"));
});

test("html helpers return readable text and markdown", () => {
	const html = "<html><body><h1>Hello</h1><p>World</p><script>bad()</script></body></html>";
	assert.match(extractTextFromHTML(html), /Hello/);
	assert.match(extractTextFromHTML(html), /World/);
	assert.doesNotMatch(extractTextFromHTML(html), /bad/);
	assert.match(convertHTMLToMarkdown(html), /# Hello/);
	assert.match(convertHTMLToMarkdown(html), /World/);
});

test("webfetch accept headers vary by format", () => {
	assert.match(acceptHeaderForFormat("markdown"), /text\/markdown/);
	assert.match(acceptHeaderForFormat("text"), /text\/plain/);
	assert.match(acceptHeaderForFormat("html"), /text\/html/);
});
