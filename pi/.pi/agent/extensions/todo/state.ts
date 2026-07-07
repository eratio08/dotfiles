export const TODO_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export const TODO_PRIORITIES = ["high", "medium", "low"] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number];
export type TodoPriority = (typeof TODO_PRIORITIES)[number];

export interface Todo {
	content: string;
	status: TodoStatus;
	priority: TodoPriority;
}

export interface TodoCounts {
	total: number;
	pending: number;
	inProgress: number;
	completed: number;
	cancelled: number;
	open: number;
	closed: number;
}

function isTodoStatus(value: unknown): value is TodoStatus {
	return typeof value === "string" && TODO_STATUSES.includes(value as TodoStatus);
}

function isTodoPriority(value: unknown): value is TodoPriority {
	return typeof value === "string" && TODO_PRIORITIES.includes(value as TodoPriority);
}

export function cloneTodos(todos: readonly Todo[]): Todo[] {
	return todos.map((todo) => ({ ...todo }));
}

export function normalizeTodo(value: unknown): Todo | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const content = typeof (value as { content?: unknown }).content === "string"
		? (value as { content: string }).content.trim()
		: "";
	const status = (value as { status?: unknown }).status;
	const priority = (value as { priority?: unknown }).priority;

	if (!content || !isTodoStatus(status) || !isTodoPriority(priority)) {
		return undefined;
	}

	return {
		content,
		status,
		priority,
	};
}

export function normalizeTodos(value: unknown): Todo[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const todos: Todo[] = [];
	for (const item of value) {
		const todo = normalizeTodo(item);
		if (!todo) {
			return undefined;
		}
		todos.push(todo);
	}
	return todos;
}

export function isOpenTodo(todo: Todo): boolean {
	return todo.status === "pending" || todo.status === "in_progress";
}

export function getTodoCounts(todos: readonly Todo[]): TodoCounts {
	const counts: TodoCounts = {
		total: todos.length,
		pending: 0,
		inProgress: 0,
		completed: 0,
		cancelled: 0,
		open: 0,
		closed: 0,
	};

	for (const todo of todos) {
		switch (todo.status) {
			case "pending":
				counts.pending += 1;
				counts.open += 1;
				break;
			case "in_progress":
				counts.inProgress += 1;
				counts.open += 1;
				break;
			case "completed":
				counts.completed += 1;
				counts.closed += 1;
				break;
			case "cancelled":
				counts.cancelled += 1;
				counts.closed += 1;
				break;
		}
	}

	return counts;
}

export function summarizeTodos(todos: readonly Todo[]): string {
	const counts = getTodoCounts(todos);
	if (counts.total === 0) {
		return "Cleared todo list.";
	}

	const parts: string[] = [];
	if (counts.pending > 0) parts.push(`${counts.pending} pending`);
	if (counts.inProgress > 0) parts.push(`${counts.inProgress} in progress`);
	if (counts.completed > 0) parts.push(`${counts.completed} completed`);
	if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`);

	return `Updated ${counts.total} todo${counts.total === 1 ? "" : "s"}: ${parts.join(", ")}.`;
}

export function extractLatestTodoSnapshot(entries: readonly unknown[]): Todo[] {
	let latest: Todo[] = [];

	for (const entry of entries) {
		if (!entry || typeof entry !== "object") {
			continue;
		}
		if ((entry as { type?: unknown }).type !== "message") {
			continue;
		}

		const message = (entry as { message?: unknown }).message;
		if (!message || typeof message !== "object") {
			continue;
		}
		if ((message as { role?: unknown }).role !== "toolResult") {
			continue;
		}
		if ((message as { toolName?: unknown }).toolName !== "todowrite") {
			continue;
		}

		const details = (message as { details?: { todos?: unknown } }).details;
		const todos = normalizeTodos(details?.todos);
		if (todos) {
			latest = todos;
		}
	}

	return latest;
}
