const TODO_CODE_TYPES = `
type TodoId = string;

type TodoStatus = "pending" | "in_progress" | "completed" | "omitted" | "blocked";

interface Todo {
  readonly id: TodoId;
  readonly content: string;
  readonly details?: string;
  readonly status: TodoStatus;
  readonly dependsOn: readonly TodoId[];
}

interface TodoInput {
  readonly content: string;
  readonly details?: string;
  readonly dependsOn?: readonly TodoId[];
}

interface TodoPatch {
  readonly content?: string;
  readonly details?: string | null;
  readonly dependsOn?: readonly TodoId[];
}

interface TodoShowOptions {
  readonly ids?: readonly TodoId[] | null;
  readonly status?: readonly TodoStatus[];
  readonly limit?: number;
  readonly includeDetails?: boolean;
}

interface TodoApi {
  add(input: TodoInput): Promise<Todo>;
  update(id: TodoId, patch: TodoPatch): Promise<Todo>;
  show(options?: TodoShowOptions): Promise<readonly Todo[]>;
  next(): Promise<Todo>;
  complete(): Promise<Todo>;
  omit(id: TodoId): Promise<Todo>;
  restore(id: TodoId): Promise<Todo>;
  clear(): Promise<{ readonly cleared: number }>;
  help(): string;
}

type TodoProgram = (todo: TodoApi) => unknown | Promise<unknown>;
`

const TODO_CODE_EXAMPLE = `
export default async (todo: TodoApi) => {
  const task = await todo.add({ content: 'Design the API' });
  return task;
}
`

const TODO_API_HELP = `# todo API reference

Use todo only for non-trivial work with three or more tasks.
${TODO_CODE_TYPES}
Create a dependency before the task that depends on it and await mutation calls in order.
Use show() to inspect tasks.
If status is omitted and IDs are absent, null, or empty, status defaults to ['in_progress', 'pending'].
If IDs are absent, null, or empty, limit defaults to 5.
The includeDetails option defaults to false, so task details are hidden unless you set it to true.
All results are sorted by ID in ascending order.
The limit applies after filtering and ID sorting.
A non-empty ID list cannot be combined with a status filter and returns every requested task, regardless of limit.
An empty status array returns no tasks.
An empty or null ID list behaves like an omitted ID list.
Use show({ ids: [id] }) to select tasks by ID.
Use show({ status: ['pending', 'in_progress'] }) to select tasks with either status.
Set limit to a positive integer to change the cap for broad and status queries.

Example:
\`\`\`typescript
${TODO_CODE_EXAMPLE.trim()}
\`\`\`
`

const TODO_PROMPT = `Use todo only for non-trivial work with three or more tasks.
Write export default async (todo: TodoApi) => ... and await mutations in order.
Available methods: add, update, show, next, complete, omit, restore, clear.
Call todo.help() for exact types, options, defaults, behavior, and examples.
`

export { TODO_API_HELP, TODO_CODE_EXAMPLE, TODO_CODE_TYPES, TODO_PROMPT }
