import assert from "node:assert/strict";
import {
	extractLatestTodoSnapshot,
	formatTodoReminder,
	getTodoCounts,
	normalizeTodos,
	summarizeTodos,
	validateTodoUpdate,
} from "../state.ts";

const snapshot = normalizeTodos([
	{ content: "  first task  ", status: "pending", priority: "high" },
	{ content: "ship", status: "completed", priority: "low" },
]);

assert.deepEqual(snapshot, [
	{ content: "first task", status: "pending", priority: "high" },
	{ content: "ship", status: "completed", priority: "low" },
]);

assert.equal(normalizeTodos([{ content: "", status: "pending", priority: "high" }]), undefined);

const plan = normalizeTodos([
	{ content: "first", status: "in_progress", priority: "high" },
	{ content: "second", status: "pending", priority: "low" },
])!;
assert.equal(validateTodoUpdate([], plan), undefined);
assert.equal(
	validateTodoUpdate(plan, [
		{ content: "first", status: "completed", priority: "high" },
		{ content: "second", status: "completed", priority: "low" },
	]),
	"Complete one todo at a time; update the list again before completing another.",
);
assert.equal(
	validateTodoUpdate(plan, [
		{ content: "first", status: "completed", priority: "high" },
		{ content: "second", status: "pending", priority: "low" },
	]),
	"Keep one open todo in_progress while work remains.",
);
assert.match(formatTodoReminder(plan), /Current item: first/);

const restored = extractLatestTodoSnapshot([
	{
		type: "message",
		message: {
			role: "toolResult",
			toolName: "todowrite",
			details: { todos: [{ content: "old", status: "pending", priority: "medium" }] },
		},
	},
	{
		type: "message",
		message: {
			role: "toolResult",
			toolName: "todowrite",
			details: {
				todos: [
					{ content: "now", status: "in_progress", priority: "high" },
					{ content: "done", status: "completed", priority: "low" },
				],
			},
		},
	},
]);

assert.deepEqual(restored, [
	{ content: "now", status: "in_progress", priority: "high" },
	{ content: "done", status: "completed", priority: "low" },
]);

assert.deepEqual(getTodoCounts(restored), {
	total: 2,
	pending: 0,
	inProgress: 1,
	completed: 1,
	cancelled: 0,
	open: 1,
	closed: 1,
});

assert.equal(summarizeTodos(restored), "Updated 2 todos: 1 in progress, 1 completed.");

console.log("todo extension check: ok");
