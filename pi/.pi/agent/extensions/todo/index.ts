import { randomUUID } from "node:crypto";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, Theme, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	TODO_PRIORITIES,
	TODO_STATUSES,
	cloneTodos,
	extractLatestTodoSnapshot,
	formatTodoContext,
	formatTodoReminder,
	getTodoCounts,
	isOpenTodo,
	normalizeTodos,
	summarizeTodos,
	validateTodoUpdate,
	type Todo,
	type TodoPriority,
	type TodoStatus,
} from "./state.ts";

interface TodoToolDetails {
	todos: Todo[];
	error?: string;
}

type PlannotatorPhase = "idle" | "planning" | "executing";

type PlannotatorStatusResponse =
	| { status: "handled"; result: { phase: PlannotatorPhase } }
	| { status: "unavailable"; error?: string }
	| { status: "error"; error: string };

type PlannotatorStatusRequest = {
	requestId: string;
	action: "plan-mode";
	payload: { mode: "status" };
	respond: (response: PlannotatorStatusResponse) => void;
};

interface TodoTrackingState {
	lastKnownPhase?: PlannotatorPhase;
	suspended: boolean;
	wasActiveBeforeSuspend: boolean;
}

const TODO_TOOL_NAME = "todowrite";
const PLAN_SUBMIT_TOOL_NAME = "plannotator_submit_plan";
const PLANNOTATOR_REQUEST_CHANNEL = "plannotator:request";
const SUSPENDED_TODO_ERROR = "Todo tracking is disabled while Plannotator executes the approved plan.";

function isPlannotatorPhase(value: unknown): value is PlannotatorPhase {
	return value === "idle" || value === "planning" || value === "executing";
}

function isPlannotatorStatusResponse(value: unknown): value is PlannotatorStatusResponse {
	if (!value || typeof value !== "object") {
		return false;
	}

	const response = value as { status?: unknown; result?: unknown; error?: unknown };
	if (response.status === "unavailable") {
		return true;
	}
	if (response.status === "error") {
		return typeof response.error === "string";
	}
	if (response.status !== "handled" || !response.result || typeof response.result !== "object") {
		return false;
	}

	return isPlannotatorPhase((response.result as { phase?: unknown }).phase);
}

function isApprovedPlanSubmission(event: ToolResultEvent): boolean {
	if (event.toolName !== PLAN_SUBMIT_TOOL_NAME || event.isError) {
		return false;
	}
	const details = event.details;
	return !!details && typeof details === "object" && (details as { approved?: unknown }).approved === true;
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

function updateUi(ctx: ExtensionContext, todos: readonly Todo[], suspended = false): void {
	if (!ctx.hasUI) {
		return;
	}

	if (suspended || todos.length === 0) {
		ctx.ui.setWidget("todo", undefined);
		return;
	}

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
	const tracking: TodoTrackingState = {
		suspended: false,
		wasActiveBeforeSuspend: false,
	};
	let statusRequestVersion = 0;

	const suspendTracking = (ctx: ExtensionContext): void => {
		if (tracking.suspended) {
			if (ctx.hasUI) ctx.ui.setWidget("todo", undefined);
			return;
		}

		tracking.suspended = true;
		const activeTools = pi.getActiveTools();
		tracking.wasActiveBeforeSuspend = activeTools.includes(TODO_TOOL_NAME);
		if (tracking.wasActiveBeforeSuspend) {
			pi.setActiveTools(activeTools.filter((toolName) => toolName !== TODO_TOOL_NAME));
		}
		if (ctx.hasUI) ctx.ui.setWidget("todo", undefined);
	};

	const resumeTracking = (ctx: ExtensionContext): void => {
		if (!tracking.suspended) {
			return;
		}

		tracking.suspended = false;
		if (tracking.wasActiveBeforeSuspend) {
			const activeTools = pi.getActiveTools();
			if (!activeTools.includes(TODO_TOOL_NAME)) {
				pi.setActiveTools([...activeTools, TODO_TOOL_NAME]);
			}
		}
		tracking.wasActiveBeforeSuspend = false;
		updateUi(ctx, todos);
	};

	const reconcilePhase = (phase: PlannotatorPhase, ctx: ExtensionContext): void => {
		tracking.lastKnownPhase = phase;
		if (phase === "executing") {
			suspendTracking(ctx);
		} else {
			resumeTracking(ctx);
		}
	};

	const requestPlannotatorPhase = (ctx: ExtensionContext): Promise<void> => {
		const version = ++statusRequestVersion;
		return new Promise((resolve) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				resolve();
			};
			const request: PlannotatorStatusRequest = {
				requestId: randomUUID(),
				action: "plan-mode",
				payload: { mode: "status" },
				respond: (response) => {
					if (settled || version !== statusRequestVersion || !isPlannotatorStatusResponse(response)) {
						finish();
						return;
					}
					if (response.status === "handled") {
						reconcilePhase(response.result.phase, ctx);
					}
					finish();
				},
			};
			pi.events.emit(PLANNOTATOR_REQUEST_CHANNEL, request);
			queueMicrotask(finish);
		});
	};

	const scheduleSessionPhaseSync = (ctx: ExtensionContext): void => {
		setTimeout(() => {
			void requestPlannotatorPhase(ctx);
		}, 0);
	};

	const syncFromSession = (ctx: ExtensionContext) => {
		todos = extractLatestTodoSnapshot(ctx.sessionManager.getBranch());
		updateUi(ctx, todos, tracking.suspended);
		scheduleSessionPhaseSync(ctx);
	};

	pi.on("session_start", async (_event, ctx) => syncFromSession(ctx));
	pi.on("session_tree", async (_event, ctx) => syncFromSession(ctx));
	pi.on("input", async (_event, ctx) => {
		await requestPlannotatorPhase(ctx);
		return { action: "continue" };
	});
	pi.on("tool_result", async (event, ctx) => {
		if (isApprovedPlanSubmission(event)) {
			await requestPlannotatorPhase(ctx);
		}
	});
	pi.on("agent_end", async (_event, ctx) => {
		if (!tracking.suspended) {
			return;
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		await requestPlannotatorPhase(ctx);
	});
	pi.on("session_compact", async (event, ctx) => {
		if (tracking.suspended) {
			await requestPlannotatorPhase(ctx);
			if (tracking.suspended) {
				return;
			}
		}
		if (todos.length === 0) {
			return;
		}

		const message = {
			customType: "todo",
			content: formatTodoContext(todos),
			display: false,
		};
		if (event.willRetry) {
			pi.sendMessage(message, { deliverAs: "steer" });
		} else if (ctx.isIdle()) {
			pi.sendMessage(message, { triggerTurn: false });
		} else {
			pi.sendMessage(message, { deliverAs: "nextTurn" });
		}
	});
	pi.on("session_shutdown", async (_event, ctx) => {
		if (!ctx.hasUI) {
			return;
		}
		ctx.ui.setWidget("todo", undefined);
	});

	pi.registerTool({
		name: "todowrite",
		label: "Todo",
		description:
			"Maintain the accepted full todo snapshot for multi-step work. Keep one active item and advance it only after verified work.",
		promptSnippet: "Use todowrite with the full accepted list and advance one active task at a time",
		promptGuidelines: [
			"Use todowrite for work with 3+ distinct steps; skip trivial work.",
			"Accepted snapshot: every call replaces the full list, so preserve every task and its exact content.",
			"Start: mark exactly one actionable task in_progress; leave other unfinished tasks pending.",
			"Advance: after verified work, mark only the task that was in_progress in the last accepted snapshot completed.",
			"When work remains, activate exactly one pending next task in the same update; when none remains, leave all tasks closed.",
			"Starting a task and completing it require separate accepted updates: pending -> in_progress -> completed.",
			"Complete at most one task per update; the active count shown for a tool call describes the proposed snapshot, not the accepted state.",
			"On Error, no changes were applied; use the accepted state shown in the error and retry one valid transition.",
			"Continue until no open task remains or the user explicitly cancels it.",
		],
		parameters: Params,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (tracking.suspended) {
				return {
					content: [{ type: "text", text: SUSPENDED_TODO_ERROR }],
					details: { todos: cloneTodos(todos), error: SUSPENDED_TODO_ERROR } satisfies TodoToolDetails,
				};
			}

			const next = normalizeTodos(params.todos);
			const error = next ? validateTodoUpdate(todos, next) : "invalid todo list";
			if (!next || error) {
				return {
					content: [{ type: "text", text: `Error: ${error}\n${formatTodoReminder(todos)}` }],
					details: { todos: cloneTodos(todos), error } satisfies TodoToolDetails,
				};
			}

			todos = cloneTodos(next);
			updateUi(ctx, todos, tracking.suspended);

			return {
				content: [{ type: "text", text: `${summarizeTodos(todos)}\n${formatTodoReminder(todos)}` }],
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

			await requestPlannotatorPhase(ctx);
			if (tracking.suspended) {
				ctx.ui.notify(SUSPENDED_TODO_ERROR, "info");
				return;
			}

			await ctx.ui.custom<void>((_tui, theme, _keybindings, done) => {
				return new TodoViewer(todos, theme, () => done());
			});
		},
	});
}
