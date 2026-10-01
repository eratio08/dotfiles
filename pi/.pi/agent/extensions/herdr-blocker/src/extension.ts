import { Pi, type PiEventMap, type PiOperationsError } from '@eratio/pi-effect'
import { Context, Effect, Layer, Ref } from 'effect'

type HerdrBlockerStatus = {
  readonly blockedAfterCompaction: boolean
  readonly compactionPending: boolean
}

class HerdrBlockerState extends Context.Service<HerdrBlockerState, { readonly status: Ref.Ref<HerdrBlockerStatus> }>()(
  'herdr-blocker/HerdrBlockerState',
) {
  static readonly layer = Layer.effect(
    HerdrBlockerState,
    Effect.gen(function* () {
      const status = yield* Ref.make<HerdrBlockerStatus>({
        blockedAfterCompaction: false,
        compactionPending: false,
      })
      return HerdrBlockerState.of({ status })
    }),
  )
}

const handleHerdrSessionCompact = Effect.fnUntraced(function* (
  event: PiEventMap['session_compact'],
): Effect.fn.Return<void, never, HerdrBlockerState> {
  if (event.reason === 'manual' || event.willRetry) return
  const { status } = yield* HerdrBlockerState
  yield* Ref.update(status, (current) => ({ ...current, compactionPending: true }))
})

const handleHerdrTurnStart = Effect.fnUntraced(function* (): Effect.fn.Return<void, never, HerdrBlockerState> {
  const { status } = yield* HerdrBlockerState
  yield* Ref.update(status, (current) => ({ ...current, compactionPending: false }))
})

const handleHerdrAgentSettled = Effect.fnUntraced(function* (): Effect.fn.Return<
  void,
  PiOperationsError,
  HerdrBlockerState | Pi
> {
  const { status } = yield* HerdrBlockerState
  const shouldBlock = yield* Ref.modify(
    status,
    (current) =>
      [
        current.compactionPending && !current.blockedAfterCompaction,
        {
          ...current,
          blockedAfterCompaction: current.blockedAfterCompaction || current.compactionPending,
          compactionPending: false,
        },
      ] as const,
  )
  if (!shouldBlock) return

  const pi = yield* Pi
  yield* pi.events.emit('herdr:blocked', {
    active: true,
    label: 'Waiting for user after compaction',
  })
})

const clearHerdrCompactionBlock = Effect.fnUntraced(function* (): Effect.fn.Return<
  void,
  PiOperationsError,
  HerdrBlockerState | Pi
> {
  const { status } = yield* HerdrBlockerState
  const shouldClear = yield* Ref.modify(
    status,
    (current) =>
      [
        current.blockedAfterCompaction,
        { ...current, blockedAfterCompaction: false, compactionPending: false },
      ] as const,
  )
  if (!shouldClear) return

  const pi = yield* Pi
  yield* pi.events.emit('herdr:blocked', { active: false })
})

export {
  clearHerdrCompactionBlock,
  HerdrBlockerState,
  handleHerdrAgentSettled,
  handleHerdrSessionCompact,
  handleHerdrTurnStart,
}
