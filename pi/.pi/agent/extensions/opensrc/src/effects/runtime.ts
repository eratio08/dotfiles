import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { createOpensrcFailure, type OpensrcFailure } from '../core/model.ts'
import { CodeEvaluator, CodeEvaluatorLive } from './code-evaluator.ts'
import { OpensrcContext } from './context.ts'
import { FileSystemLive } from './file-system.ts'
import { AstParserLive, createOpensrcApi } from './opensrc-api.ts'
import {
  type OpenSrcCli,
  OpenSrcCliLive,
  type OpensrcConfig,
  OpensrcConfiguration,
  resolveOpensrcConfig,
} from './opensrc-cli.ts'
import { OpensrcPi, type PiHost, PiHostLive } from './pi-host.ts'
import { type SourceStore, SourceStoreLive } from './source-store.ts'

interface OpensrcRuntime {
  readonly run: <A = OpensrcRuntimeResult>(
    code: string,
    pi: ExtensionAPI,
    context: ExtensionContext,
    signal: AbortSignal | undefined,
    complete?: (result: OpensrcRuntimeResult) => Effect.Effect<A, OpensrcFailure>,
  ) => Promise<A>
  readonly dispose: () => Promise<void>
}

interface OpensrcRuntimeResult {
  readonly value: unknown
  readonly operations: Readonly<Record<string, number>>
}

function createOpensrcRuntime(): OpensrcRuntime {
  const baseLayer = Layer.mergeAll(FileSystemLive(), AstParserLive(), CodeEvaluatorLive())
  const managedRuntime = ManagedRuntime.make(baseLayer)
  let disposed = false
  return {
    run: <A = OpensrcRuntimeResult>(
      code: string,
      pi: ExtensionAPI,
      context: ExtensionContext,
      signal: AbortSignal | undefined,
      complete?: (result: OpensrcRuntimeResult) => Effect.Effect<A, OpensrcFailure>,
    ) => {
      if (disposed)
        return Promise.reject(
          createOpensrcFailure({
            _tag: 'runtime',
            operation: 'run',
            message: 'The opensrc runtime is disposed.',
          }),
        )
      const config = resolveOpensrcConfig()
      const callLayer = createCallLayer(pi, context, config)
      const operations = new Map<string, number>()
      const recordOperation = (operation: string): void => {
        operations.set(operation, (operations.get(operation) ?? 0) + 1)
      }
      const program = Effect.scoped(
        Effect.gen(function* () {
          const evaluator = yield* CodeEvaluator
          const api = yield* createOpensrcApi(recordOperation)
          const signal = yield* Effect.abortSignal
          const execution = {
            value: yield* evaluator.evaluate(code, api, context.cwd, signal),
            operations: Object.fromEntries(operations),
          }
          if (complete === undefined) return execution as A
          return yield* complete(execution)
        }).pipe(Effect.provide(callLayer)),
      )
      return managedRuntime.runPromise(program, { signal })
    },
    dispose: async () => {
      if (disposed) return
      disposed = true
      await managedRuntime.dispose()
    },
  }
}

function createCallLayer(
  pi: ExtensionAPI,
  context: ExtensionContext,
  config: OpensrcConfig,
): Layer.Layer<OpensrcContext | OpensrcConfiguration | PiHost | OpenSrcCli | SourceStore, never, never> {
  const hostLayer = Layer.mergeAll(
    PiHostLive.pipe(Layer.provide(Layer.succeed(OpensrcPi, pi))),
    Layer.succeed(OpensrcConfiguration, config),
  )
  const cliLayer = OpenSrcCliLive.pipe(Layer.provideMerge(hostLayer))
  const storeLayer = SourceStoreLive().pipe(Layer.provideMerge(cliLayer))
  return Layer.mergeAll(Layer.succeed(OpensrcContext, context), storeLayer)
}

export { createOpensrcRuntime, type OpensrcRuntime, type OpensrcRuntimeResult }
