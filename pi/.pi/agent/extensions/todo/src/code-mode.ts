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
  readonly status?: TodoStatus;
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
Use show() to inspect up to five tasks.
Use show({ ids: [id] }) to select tasks by ID.
Use show({ status: 'pending' }) to select pending tasks.
Set limit to change the cap for broad and status queries.
An explicit ID list returns every requested task.

Example:
\`\`\`typescript
${TODO_CODE_EXAMPLE.trim()}
\`\`\`
`

const TODO_PROMPT = `Use todo only for non-trivial work with three or more tasks.
Write export default async (todo: TodoApi) => ... and await mutations in order.
Available methods: add, update, show, next, complete, omit, restore, clear.
By default, show() returns up to 5 tasks.
Call todo.help() for exact types, options, and examples.
`

export { TODO_API_HELP, TODO_CODE_EXAMPLE, TODO_CODE_TYPES, TODO_PROMPT }
