import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRewrite, resolveRewrite } from "./index.ts";

test("normalizeRewrite returns rewritten command when changed", () => {
	assert.equal(normalizeRewrite("ls", "eza\n"), "eza");
});

test("normalizeRewrite ignores empty output", () => {
	assert.equal(normalizeRewrite("ls", "\n\n"), null);
});

test("normalizeRewrite ignores unchanged output", () => {
	assert.equal(normalizeRewrite("ls", "ls\n"), null);
});

test("resolveRewrite keeps rewritten stdout even when rtk exits non-zero", () => {
	assert.equal(resolveRewrite("ls", { code: 3, stdout: "rtk ls\n" }), "rtk ls");
});

test("resolveRewrite ignores empty stdout on non-zero exit", () => {
	assert.equal(resolveRewrite("ls", { code: 1, stdout: "" }), null);
});
