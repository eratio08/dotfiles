import { Effect } from 'effect'
import type { OpensrcFailure, OutputLimits, SerializedOutput } from '../core/model.ts'
import { truncateOutput } from '../core/output.ts'
import { failureFromUnknown } from './failure.ts'

function serializeValue(value: unknown): Effect.Effect<string, OpensrcFailure> {
  if (value === undefined) return Effect.succeed('undefined')
  if (value === null) return Effect.succeed('null')
  if (typeof value === 'string') return Effect.succeed(value)
  return Effect.gen(function* () {
    const serialized = yield* Effect.match(
      Effect.try({
        try: () => JSON.stringify(value, null, 2),
        catch: (cause) => failureFromUnknown(cause, 'runtime', 'serialize', 'Unable to serialize the value.'),
      }),
      {
        onFailure: () => undefined,
        onSuccess: (result) => result,
      },
    )
    if (serialized !== undefined) return serialized
    return yield* Effect.try({
      try: () => String(value),
      catch: (cause) => failureFromUnknown(cause, 'runtime', 'serialize', 'Unable to serialize the value.'),
    })
  })
}

function serializeOutput(value: unknown, limits: OutputLimits): Effect.Effect<SerializedOutput, OpensrcFailure> {
  return serializeValue(value).pipe(Effect.map((output) => truncateOutput(output, limits)))
}

export { serializeOutput, serializeValue }
