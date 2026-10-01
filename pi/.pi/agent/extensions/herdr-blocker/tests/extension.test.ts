import { expect, test } from 'bun:test'
import { installFakePlugin } from '@eratio/pi-effect/testing'
import herdrBlockerExtension from '../index.ts'

type LifecycleEvent = {
  readonly name: string
  readonly event: unknown
}

type FakeHerdrBlockerExtension = Awaited<ReturnType<typeof installFakePlugin>>

async function invokeHerdrBlockerEvents(
  extension: FakeHerdrBlockerExtension,
  events: readonly LifecycleEvent[],
): Promise<void> {
  for (const { name, event } of events) {
    await extension.invokeEvent(name, event)
  }
}

test('should emit and clear one block given manual and retrying compactions are ignored', async () => {
  const extension = await installFakePlugin(herdrBlockerExtension)
  const emitted: unknown[] = []
  extension.api.events.on('herdr:blocked', (event) => {
    emitted.push(event)
  })

  await invokeHerdrBlockerEvents(extension, [
    { name: 'session_compact', event: { type: 'session_compact', reason: 'manual', willRetry: false } },
    { name: 'agent_settled', event: { type: 'agent_settled' } },
    { name: 'session_compact', event: { type: 'session_compact', reason: 'auto', willRetry: true } },
    { name: 'agent_settled', event: { type: 'agent_settled' } },
    { name: 'session_compact', event: { type: 'session_compact', reason: 'auto', willRetry: false } },
    { name: 'turn_start', event: { type: 'turn_start' } },
    { name: 'agent_settled', event: { type: 'agent_settled' } },
    { name: 'session_compact', event: { type: 'session_compact', reason: 'auto', willRetry: false } },
    { name: 'agent_settled', event: { type: 'agent_settled' } },
    { name: 'agent_settled', event: { type: 'agent_settled' } },
    { name: 'agent_start', event: { type: 'agent_start' } },
    { name: 'session_shutdown', event: { type: 'session_shutdown', reason: 'quit' } },
  ])

  expect(emitted).toEqual([{ active: true, label: 'Waiting for user after compaction' }, { active: false }])
})
