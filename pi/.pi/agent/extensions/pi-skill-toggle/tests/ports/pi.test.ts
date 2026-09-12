import { describe, test } from 'bun:test'
import { strict as assert } from 'node:assert'
import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { Cause, Effect, Exit } from 'effect'
import { PiHost, PiHostError, PiHostLive } from '../../src/ports/pi.ts'

describe('PiHostLive', () => {
  test('does not call UI methods when UI is unavailable', async () => {
    //given
    const notifications: string[] = []
    const ctx = {
      hasUI: false,
      ui: {
        notify: (message: string) => notifications.push(message),
        custom: async () => ({ action: 'cancel' as const, drafts: [] }),
      },
      reload: async () => {},
    }

    //when
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const host = yield* PiHost
        yield* host.notify('ignored')
        return yield* Effect.exit(host.showToggleUi([]))
      }).pipe(Effect.provide(PiHostLive(ctx as unknown as ExtensionCommandContext))),
    )

    //then
    assert.deepEqual(notifications, [])
    assert.equal(Exit.isFailure(result), true)
    if (Exit.isFailure(result)) {
      const failure = result.cause.reasons.find(Cause.isFailReason)
      assert.ok(failure)
      if (failure) assert.ok(failure.error instanceof PiHostError)
    }
  })
})
