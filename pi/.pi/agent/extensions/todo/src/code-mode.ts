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

interface TodoCompleteResult {
  readonly completed: Todo;
  readonly remaining: {
    readonly pending: number;
    readonly inProgress: number;
    readonly blocked: number;
  };
  readonly allDone: boolean;
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
  complete(): Promise<TodoCompleteResult>;
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

export { TODO_CODE_EXAMPLE, TODO_CODE_TYPES }
