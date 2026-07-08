import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	TODO_PRIORITIES,
	TODO_STATUSES,
	cloneTodos,
	extractLatestTodoSnapshot,
	getTodoCounts,
	isOpenTodo,
	normalizeTodos,
	summarizeTodos,
	type Todo,
	type TodoPriority,
	type TodoStatus,
} from "./state.ts";

interface TodoToolDetails {
	todos: Todo[];
	error?: string;
}

const TodoSchema = Type.Object({
	content: Type.String({ description: "Todo text" }),
	status: StringEnum(TODO_STATUSES),
	priority: StringEnum(TODO_PRIORITIES),
});

const Params = Type.Object({
	todos: Type.Array(TodoSchema, { description: "Full todo list snapshot" }),
});

class TodoViewer {
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private readonly todos: readonly Todo[],
		private readonly theme: Theme,
		private readonly onClose: () => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onClose();
		}
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const counts = getTodoCounts(this.todos);
		const lines: string[] = [];
		const header = `${this.theme.fg("accent", " Todos ")}${this.theme.fg("dim", ` ${formatCounts(counts)}`)}`;
		lines.push("");
		lines.push(truncateToWidth(header, width));
		lines.push("");

		if (this.todos.length === 0) {
			lines.push(truncateToWidth(`  ${this.theme.fg("dim", "No todos")}`, width));
		} else {
			for (const todo of this.todos) {
				lines.push(truncateToWidth(`  ${renderTodoLine(todo, this.theme, true)}`, width));
			}
		}

		lines.push("");
		lines.push(truncateToWidth(`  ${this.theme.fg("dim", "Press Escape to close")}`, width));
		lines.push("");

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
}

function formatCounts(counts: ReturnType<typeof getTodoCounts>): string {
	const parts: string[] = [];
	if (counts.pending > 0) parts.push(`${counts.pending} pending`);
	if (counts.inProgress > 0) parts.push(`${counts.inProgress} active`);
	if (counts.completed > 0) parts.push(`${counts.completed} done`);
	if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`);
	return parts.join(" • ") || "empty";
}

function renderMarker(status: TodoStatus, theme: Theme): string {
	switch (status) {
		case "pending":
			return theme.fg("dim", "[ ]");
		case "in_progress":
			return theme.fg("accent", "[•]");
		case "completed":
			return theme.fg("success", "[✓]");
		case "cancelled":
			return theme.fg("warning", "[-]");
	}
}

function renderPriority(priority: TodoPriority, theme: Theme): string {
	switch (priority) {
		case "high":
			return theme.fg("error", "high");
		case "medium":
			return theme.fg("warning", "medium");
		case "low":
			return theme.fg("dim", "low");
	}
}

function renderContent(todo: Todo, theme: Theme): string {
	if (todo.status === "completed" || todo.status === "cancelled") {
		return theme.fg("muted", theme.strikethrough(todo.content));
	}
	if (todo.status === "in_progress") {
		return theme.fg("text", todo.content);
	}
	return theme.fg("muted", todo.content);
}

function renderTodoLine(todo: Todo, theme: Theme, includePriority: boolean): string {
	const priority = includePriority ? ` ${theme.fg("dim", `(${renderPriority(todo.priority, theme)})`)}` : "";
	return `${renderMarker(todo.status, theme)} ${renderContent(todo, theme)}${priority}`;
}

function updateUi(ctx: ExtensionContext, todos: readonly Todo[]): void {
	if (!ctx.hasUI) {
		return;
	}

	if (todos.length === 0) {
		ctx.ui.setWidget("todo", undefined);
		ctx.ui.setStatus("todo", undefined);
		return;
	}

	const counts = getTodoCounts(todos);
	const status = `${counts.completed}/${counts.total} done${counts.cancelled > 0 ? ` • ${counts.cancelled} cancelled` : ""}`;
	ctx.ui.setStatus("todo", ctx.ui.theme.fg("accent", `todo ${status}`));

	const unfinished = todos.filter(isOpenTodo);
	if (unfinished.length === 0) {
		ctx.ui.setWidget("todo", undefined);
		return;
	}

	const lines = unfinished.slice(0, 8).map((todo) => renderTodoLine(todo, ctx.ui.theme, false));
	if (unfinished.length > 8) {
		lines.push(ctx.ui.theme.fg("dim", `… ${unfinished.length - 8} more`));
	}
	ctx.ui.setWidget("todo", lines);
}

export default function (pi: ExtensionAPI) {
	let todos: Todo[] = [];

	const syncFromSession = (ctx: ExtensionContext) => {
		todos = extractLatestTodoSnapshot(ctx.sessionManager.getBranch());
		updateUi(ctx, todos);
	};

	pi.on("session_start", async (_event, ctx) => syncFromSession(ctx));
	pi.on("session_tree", async (_event, ctx) => syncFromSession(ctx));
	pi.on("session_shutdown", async (_event, ctx) => {
		if (!ctx.hasUI) {
			return;
		}
		ctx.ui.setWidget("todo", undefined);
		ctx.ui.setStatus("todo", undefined);
	});

	pi.registerTool({
		name: "todowrite",
		label: "Todo",
		description:
			"Replace the current session todo list with a full snapshot. Use this for work with 3+ distinct steps or other non-trivial tasks, not trivial one-step tasks.",
		promptSnippet: "Track work with 3+ distinct steps using a full todo list snapshot via todowrite({ todos: [...] })",
		promptGuidelines: [
			"Use todowrite for work with 3+ distinct steps or other non-trivial tasks that benefit from explicit progress tracking.",
			"Do not use todowrite for trivial one-step requests, single straightforward tasks, or work you can finish immediately.",
			"Use todowrite with the full current list each time: todowrite({ todos: [...] }).",
			"Keep exactly one todowrite item in_progress while work remains, unless the user explicitly wants parallel active tasks.",
			"Update todowrite in real time as work progresses instead of batching updates at the end.",
			"Preserve user commands verbatim inside todowrite todo text when relevant.",
		],
		parameters: Params,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const next = normalizeTodos(params.todos);
			if (!next) {
				return {
					content: [{ type: "text", text: "Error: invalid todo list" }],
					details: { todos: cloneTodos(todos), error: "invalid todo list" } satisfies TodoToolDetails,
				};
			}

			todos = cloneTodos(next);
			updateUi(ctx, todos);

			return {
				content: [{ type: "text", text: summarizeTodos(todos) }],
				details: { todos: cloneTodos(todos) } satisfies TodoToolDetails,
			};
		},
		renderCall(args, theme) {
			const next = normalizeTodos(args.todos) ?? [];
			const counts = getTodoCounts(next);
			return new Text(
				theme.fg("toolTitle", theme.bold("todowrite ")) +
					theme.fg("muted", `${counts.total} item${counts.total === 1 ? "" : "s"}`) +
					(counts.inProgress > 0 ? ` ${theme.fg("accent", `${counts.inProgress} active`)}` : ""),
				0,
				0,
			);
		},
		renderResult(result, { expanded }, theme) {
			const details = result.details as TodoToolDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			if (details.error) {
				return new Text(theme.fg("error", `Error: ${details.error}`), 0, 0);
			}

			const list = normalizeTodos(details.todos) ?? [];
			if (list.length === 0) {
				return new Text(theme.fg("dim", "Todo list cleared"), 0, 0);
			}

			const counts = getTodoCounts(list);
			const visible = expanded
				? list
				: (() => {
					const unfinished = list.filter(isOpenTodo);
					return (unfinished.length > 0 ? unfinished : list).slice(0, 4);
				})();
			const lines = [theme.fg("muted", formatCounts(counts))];
			for (const todo of visible) {
				lines.push(renderTodoLine(todo, theme, true));
			}
			if (!expanded && visible.length < list.length) {
				lines.push(theme.fg("dim", `… ${list.length - visible.length} more`));
			}
			return new Text(lines.join("\n"), 0, 0);
		},
	});

	pi.registerCommand("todos", {
		description: "Show todos on the current branch",
		handler: async (_args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/todos requires interactive mode", "error");
				return;
			}

			await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
				return new TodoViewer(todos, theme, () => done());
			});
		},
	});
}
