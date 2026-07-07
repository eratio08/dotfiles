import test from "node:test";
import assert from "node:assert/strict";
import {
	DEFAULT_MODE,
	getModeInstructions,
	parseCavemanCommand,
	parseModeChange,
	resolveSessionMode,
} from "./core.ts";

test("parse command modes", () => {
	assert.deepEqual(parseCavemanCommand(""), { type: "set-mode", mode: DEFAULT_MODE });
	assert.deepEqual(parseCavemanCommand("ultra"), { type: "set-mode", mode: "ultra" });
	assert.deepEqual(parseCavemanCommand("stop"), { type: "set-mode", mode: "off" });
	assert.equal(parseCavemanCommand("bogus").type, "invalid");
});

test("parse natural language toggles", () => {
	assert.equal(parseModeChange("talk like caveman"), DEFAULT_MODE);
	assert.equal(parseModeChange("please stop caveman mode"), "off");
	assert.equal(parseModeChange("/caveman wenyan"), "wenyan-full");
	assert.equal(parseModeChange("nothing to see here"), null);
});

test("resolve last saved mode from branch", () => {
	const entries = [
		{ type: "custom", customType: "caveman-mode", data: { mode: "lite" } },
		{ type: "custom", customType: "other", data: { mode: "off" } },
		{ type: "custom", customType: "caveman-mode", data: { mode: "ultra" } },
	];
	assert.equal(resolveSessionMode(entries), "ultra");
	assert.equal(resolveSessionMode([], "lite"), "lite");
});

test("instructions include active level", () => {
	const text = getModeInstructions("full");
	assert.match(text, /CAVEMAN MODE ACTIVE — level: full/);
	assert.match(text, /Drop articles/);
});
