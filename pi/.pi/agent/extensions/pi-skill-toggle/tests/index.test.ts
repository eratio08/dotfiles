import { describe, test } from 'bun:test'
import { strict as assert } from 'node:assert'
import piSkillToggle from '../index.ts'

type CommandHandler = (args: string, ctx: unknown) => Promise<void>
type EventHandler = (event: unknown, ctx: unknown) => Promise<void>

async function createHarness(): Promise<{
  shutdown: () => Promise<void>
  notifications: string[]
}> {
  const commands = new Map<string, { handler: CommandHandler }>()
  const events = new Map<string, EventHandler>()
  const notifications: string[] = []
  const context = {
    mode: 'rpc',
    hasUI: true,
    cwd: '/tmp',
    signal: undefined,
    ui: {
      notify: (message: string) => notifications.push(message),
      custom: async () => ({ action: 'cancel' as const, drafts: [] }),
    },
    reload: async () => {},
    sessionManager: {
      getCwd: () => '/tmp',
      getSessionId: () => 'test',
      getSessionFile: () => undefined,
      getSessionDir: () => '/tmp',
      getLeafId: () => null,
      getLeafEntry: () => undefined,
      getEntries: () => [],
      getTree: () => [],
      getEntry: () => undefined,
      getBranch: () => [],
      buildContextEntries: () => [],
      getLabel: () => undefined,
      getSessionName: () => undefined,
    },
  }
  const pi = {
    registerCommand: (name: string, spec: { handler: CommandHandler }) => commands.set(name, spec),
    on: (event: string, handler: EventHandler) => events.set(event, handler),
  }
  await piSkillToggle(pi as never)
  return {
    shutdown: async () => {
      const handler = events.get('session_shutdown')
      const command = commands.get('toggle-skills')
      if (!handler || !command) throw new Error('extension registration failed')
      await handler({}, context)
      await handler({}, context)
      await command.handler('', context)
    },
    notifications,
  }
}

describe('piSkillToggle', () => {
  test('disposes once and ignores commands after shutdown', async () => {
    //given
    const harness = await createHarness()

    //when
    await harness.shutdown()

    //then
    assert.deepEqual(harness.notifications, [])
  })
})
