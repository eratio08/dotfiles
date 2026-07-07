import assert from "node:assert/strict";
import test from "node:test";
import { hasWebSearchCredentials, parseSearchResponse, selectProvider } from "./websearch.ts";

test("websearch registration gate checks credentials", () => {
	assert.equal(hasWebSearchCredentials({} as NodeJS.ProcessEnv), false);
	assert.equal(hasWebSearchCredentials({ EXA_API_KEY: "x" } as NodeJS.ProcessEnv), true);
	assert.equal(hasWebSearchCredentials({ PARALLEL_API_KEY: "x" } as NodeJS.ProcessEnv), true);
	assert.equal(hasWebSearchCredentials({ EXA_API_KEY: "   " } as NodeJS.ProcessEnv), false);
});

test("websearch selects configured provider", () => {
	assert.equal(selectProvider({ PI_WEBSEARCH_PROVIDER: "parallel" } as NodeJS.ProcessEnv), "parallel");
	assert.equal(selectProvider({ EXA_API_KEY: "x" } as NodeJS.ProcessEnv), "exa");
	assert.equal(selectProvider({ PARALLEL_API_KEY: "x" } as NodeJS.ProcessEnv), "parallel");
	assert.equal(selectProvider({} as NodeJS.ProcessEnv), "exa");
});

test("websearch parses direct json and sse responses", () => {
	const direct = JSON.stringify({ result: { content: [{ type: "text", text: "direct hit" }] } });
	const sse = [
		"event: message",
		`data: ${JSON.stringify({ result: { content: [{ type: "text", text: "sse hit" }] } })}`,
	].join("\n");
	assert.equal(parseSearchResponse(direct), "direct hit");
	assert.equal(parseSearchResponse(sse), "sse hit");
	assert.equal(parseSearchResponse("data: not-json"), undefined);
});
