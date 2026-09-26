import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withFileMutationQueue } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer, Predicate, Schema } from 'effect'

const WebToolsFilesystemCause = Schema.Struct({
  name: Schema.String,
  message: Schema.String,
})
type WebToolsFilesystemCause = Schema.Schema.Type<typeof WebToolsFilesystemCause>

class WebToolsFilesystemError extends Schema.TaggedError<WebToolsFilesystemError>()('WebToolsFilesystemError', {
  operation: Schema.String,
  path: Schema.String,
  message: Schema.String,
  cause: Schema.optional(WebToolsFilesystemCause),
}) {}

type WebToolsTemporaryOutputService = {
  readonly writeOutput: (prefix: string, content: string) => Effect.Effect<string, WebToolsFilesystemError>
}

class WebToolsTemporaryOutput extends Context.Service<WebToolsTemporaryOutput, WebToolsTemporaryOutputService>()(
  'web-tools/WebToolsTemporaryOutput',
) {}

type TemporaryOutputWrite = { readonly prefix: string; readonly content: string; readonly path: string }

function temporaryOutputError(operation: string, path: string, cause: unknown): WebToolsFilesystemError {
  const causeDetails: WebToolsFilesystemCause | undefined = Predicate.isError(cause)
    ? { name: cause.name, message: cause.message }
    : Predicate.isString(cause)
      ? { name: 'Error', message: cause }
      : undefined
  return new WebToolsFilesystemError({
    operation,
    path,
    message: Predicate.isError(cause) ? cause.message : `Unable to ${operation} temporary output`,
    cause: causeDetails,
  })
}

function tryTemporaryOutput<A>(
  operation: string,
  path: string,
  execute: (signal: AbortSignal) => PromiseLike<A>,
): Effect.Effect<A, WebToolsFilesystemError> {
  return Effect.tryPromise({
    try: execute,
    catch: (cause: unknown) => temporaryOutputError(operation, path, cause),
  })
}

const writeOutput = Effect.fn('WebToolsTemporaryOutput.writeOutput')(function* (
  prefix: string,
  content: string,
): Effect.fn.Return<string, WebToolsFilesystemError> {
  const tempDir = yield* tryTemporaryOutput('mkdtemp', prefix, () => mkdtemp(join(tmpdir(), `${prefix}-`)))
  const fullOutputPath = join(tempDir, 'output.txt')
  yield* tryTemporaryOutput('writeFile', fullOutputPath, (signal) =>
    withFileMutationQueue(fullOutputPath, () => writeFile(fullOutputPath, content, { encoding: 'utf8', signal })),
  )
  return fullOutputPath
})

const WebToolsTemporaryOutputLive: Layer.Layer<WebToolsTemporaryOutput> = Layer.succeed(
  WebToolsTemporaryOutput,
  WebToolsTemporaryOutput.of({ writeOutput }),
)

function createWebToolsTemporaryOutputTestLayer(
  writes: TemporaryOutputWrite[],
  root = '/tmp',
): Layer.Layer<WebToolsTemporaryOutput> {
  let sequence = 0
  return Layer.succeed(
    WebToolsTemporaryOutput,
    WebToolsTemporaryOutput.of({
      writeOutput: (prefix: string, content: string) =>
        Effect.sync(() => {
          const path = join(root, `${prefix}-${sequence++}`, 'output.txt')
          writes.push({ prefix, content, path })
          return path
        }),
    }),
  )
}

export {
  createWebToolsTemporaryOutputTestLayer,
  type TemporaryOutputWrite,
  WebToolsFilesystemError,
  WebToolsTemporaryOutput,
  WebToolsTemporaryOutputLive,
}
