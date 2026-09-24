import { Schema } from 'effect'

const TODO_STATE_ENTRY = 'todo'
const TODO_STATUSES = ['pending', 'in_progress', 'completed', 'omitted', 'blocked'] as const
const TODO_ID_PATTERN = /^(?:[0-9a-f]{8}|[0-9a-f]{12})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TodoIdSchema = Schema.String.check(Schema.isPattern(TODO_ID_PATTERN))
const TodoStatusSchema = Schema.Literals(TODO_STATUSES)
const TodoContentSchema = Schema.String
const TodoDataSchema = Schema.Struct({
  id: TodoIdSchema,
  content: TodoContentSchema,
  details: Schema.optionalKey(Schema.String),
  status: TodoStatusSchema,
  dependsOn: Schema.Array(TodoIdSchema),
})
const TodoInputSchema = Schema.Struct({
  content: TodoContentSchema,
  details: Schema.optionalKey(Schema.String),
  dependsOn: Schema.optionalKey(Schema.Array(TodoIdSchema)),
})
const TodoPatchSchema = Schema.Struct({
  content: Schema.optionalKey(TodoContentSchema),
  details: Schema.optionalKey(Schema.NullOr(Schema.String)),
  dependsOn: Schema.optionalKey(Schema.Array(TodoIdSchema)),
})
const TodoShowIdsSchema = Schema.NullOr(Schema.Array(TodoIdSchema))
const TodoShowLimitSchema = Schema.Int.check(
  Schema.isGreaterThan(0, { message: 'Todo show limit must be a positive integer.' }),
)
const TodoShowOptionsSchema = Schema.Struct({
  ids: Schema.optionalKey(TodoShowIdsSchema),
  status: Schema.optionalKey(Schema.Array(TodoStatusSchema)),
  limit: Schema.optionalKey(TodoShowLimitSchema),
  includeDetails: Schema.optionalKey(Schema.Boolean),
})
const TodoListSchema = Schema.Array(TodoDataSchema)
const TodoSessionDataSchema = Schema.Struct({ todos: TodoListSchema })
const TodoSessionEntrySchema = Schema.Struct({
  type: Schema.Literal('custom'),
  customType: Schema.Literal(TODO_STATE_ENTRY),
  data: TodoSessionDataSchema,
})

type TodoId = (typeof TodoIdSchema)['Type']
type TodoStatus = (typeof TodoStatusSchema)['Type']
type Todo = (typeof TodoDataSchema)['Type']
type TodoInput = (typeof TodoInputSchema)['Type']
type TodoPatch = (typeof TodoPatchSchema)['Type']
type TodoShowOptions = (typeof TodoShowOptionsSchema)['Type']

export {
  TODO_ID_PATTERN,
  TODO_STATE_ENTRY,
  TODO_STATUSES,
  type Todo,
  TodoDataSchema,
  type TodoId,
  TodoIdSchema,
  type TodoInput,
  TodoInputSchema,
  TodoListSchema,
  type TodoPatch,
  TodoPatchSchema,
  TodoSessionDataSchema,
  TodoSessionEntrySchema,
  type TodoShowOptions,
  TodoShowOptionsSchema,
  type TodoStatus,
  TodoStatusSchema,
}
