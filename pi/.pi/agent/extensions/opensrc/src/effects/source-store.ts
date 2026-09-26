import { Context, Effect, Layer, Ref, Semaphore } from 'effect'
import type { OpensrcFailure, Source } from '../core/model.ts'
import { createOpensrcFailure } from '../core/model.ts'
import { OpenSrcCli } from './opensrc-cli.ts'
import { normalizeSources } from './source-index.ts'

type SourceStoreMutation<A> = {
  readonly before: readonly Source[]
  readonly after: readonly Source[]
  readonly value: A
}

type SourceStoreService = {
  readonly current: () => readonly Source[]
  readonly load: () => Effect.Effect<readonly Source[], OpensrcFailure>
  readonly refresh: () => Effect.Effect<readonly Source[], OpensrcFailure>
  readonly mutate: <A>(
    operation: (before: readonly Source[]) => Effect.Effect<A, OpensrcFailure>,
  ) => Effect.Effect<SourceStoreMutation<A>, OpensrcFailure>
  readonly snapshot: Effect.Effect<readonly Source[], OpensrcFailure>
}

class SourceStore extends Context.Service<SourceStore, SourceStoreService>()('opensrc/SourceStore') {}

function SourceStoreLive(): Layer.Layer<SourceStore, never, OpenSrcCli> {
  return Layer.effect(
    SourceStore,
    Effect.gen(function* () {
      const cli = yield* OpenSrcCli
      const state = yield* Ref.make<readonly Source[]>([])
      const lock = yield* Semaphore.make(1)
      const refreshState = (): Effect.Effect<readonly Source[], OpensrcFailure> =>
        Effect.gen(function* () {
          const index = yield* cli.list()
          const sources = yield* normalizeSources(index).pipe(
            Effect.mapError((cause) =>
              createOpensrcFailure({
                _tag: 'parser',
                operation: 'source-store.refresh',
                message: cause.message || 'Unable to normalize the source index.',
                cause,
              }),
            ),
            Effect.map(freezeSources),
          )
          yield* Ref.set(state, sources)
          return sources
        })
      const refresh = (): Effect.Effect<readonly Source[], OpensrcFailure> => lock.withPermits(1)(refreshState())
      const mutate: SourceStoreService['mutate'] = <A>(
        operation: (before: readonly Source[]) => Effect.Effect<A, OpensrcFailure>,
      ) =>
        lock.withPermits(1)(
          Effect.gen(function* () {
            const before = yield* Ref.get(state)
            const value = yield* operation(before)
            const after = yield* refreshState()
            return { before, after, value }
          }),
        )
      const service: SourceStoreService = {
        current: () => Ref.getUnsafe(state),
        load: refresh,
        refresh,
        mutate,
        snapshot: Ref.get(state),
      }
      return SourceStore.of(service)
    }),
  )
}

function freezeSources(value: readonly Source[]): readonly Source[] {
  return Object.freeze(value.map((source) => Object.freeze({ ...source })))
}

export { SourceStore, SourceStoreLive, type SourceStoreMutation, type SourceStoreService }
