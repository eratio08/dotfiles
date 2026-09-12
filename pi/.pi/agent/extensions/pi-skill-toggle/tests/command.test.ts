import { describe, test } from 'bun:test'
import { strict as assert } from 'node:assert'
import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { SkillTogglePlanner } from '../src/apply/planner.ts'
import { SkillChangeWriter } from '../src/apply/writer.ts'
import { runToggleSkillsCommand } from '../src/command.ts'
import { SkillInventory } from '../src/inventory/loader.ts'
import { FileSystemError } from '../src/ports/fs.ts'
import type { ApplyResult, SkillChange, SkillRecord, SkillToggleUiResult } from '../src/types.ts'

const skill: SkillRecord = {
  id: 'skill',
  name: 'skill',
  description: '',
  filePath: '/skill/SKILL.md',
  baseDir: '/skill',
  source: { kind: 'user', root: '/skills' },
  editable: true,
  mode: 'agent-invocable',
  diagnostics: [],
}

const change: SkillChange = {
  skill,
  filePath: skill.filePath,
  from: 'agent-invocable',
  to: 'manual-only',
  patch: { oldText: 'old', newText: 'new' },
}

const appliedResult: ApplyResult = { applied: [change], skipped: [], errors: [] }

type Scenario = {
  mode?: 'tui' | 'rpc'
  hasUI?: boolean
  skills?: SkillRecord[]
  uiResult?: SkillToggleUiResult
  changes?: SkillChange[]
  applyResult?: ApplyResult
  inventoryError?: boolean
  plannerError?: boolean
}

type State = {
  notifications: string[]
  customCalls: number
  reloads: number
  inventoryCalls: number
  planned: number
  written: number
}

async function runScenario(scenario: Scenario): Promise<State> {
  const state: State = { notifications: [], customCalls: 0, reloads: 0, inventoryCalls: 0, planned: 0, written: 0 }
  const ctx = {
    mode: scenario.mode ?? 'tui',
    hasUI: scenario.hasUI ?? true,
    cwd: '/cwd',
    signal: undefined,
    ui: {
      notify: (message: string) => state.notifications.push(message),
      custom: async () => {
        state.customCalls += 1
        return scenario.uiResult ?? { action: 'cancel' as const, drafts: [{ skill, desiredMode: skill.mode }] }
      },
    },
    reload: async () => {
      state.reloads += 1
    },
  }
  const inventoryLayer = Layer.succeed(
    SkillInventory,
    SkillInventory.of({
      load: () => {
        state.inventoryCalls += 1
        return scenario.inventoryError
          ? Effect.fail(
              new FileSystemError({
                operation: 'readFile',
                path: skill.filePath,
                message: 'offline',
                cause: undefined,
              }),
            )
          : Effect.succeed(scenario.skills ?? [skill])
      },
    }),
  )
  const plannerLayer = Layer.succeed(
    SkillTogglePlanner,
    SkillTogglePlanner.of({
      plan: () => {
        state.planned += 1
        return scenario.plannerError
          ? Effect.fail(
              new FileSystemError({
                operation: 'readFile',
                path: skill.filePath,
                message: 'plan failed',
                cause: undefined,
              }),
            )
          : Effect.succeed(scenario.changes ?? [])
      },
    }),
  )
  const writerLayer = Layer.succeed(
    SkillChangeWriter,
    SkillChangeWriter.of({
      apply: () => {
        state.written += 1
        return Effect.succeed(scenario.applyResult ?? { applied: [], skipped: [], errors: [] })
      },
    }),
  )
  const runtime = ManagedRuntime.make(Layer.mergeAll(inventoryLayer, plannerLayer, writerLayer))
  try {
    await runToggleSkillsCommand(ctx as unknown as ExtensionCommandContext, runtime)
  } finally {
    await runtime.dispose()
  }
  return state
}

describe('runToggleSkillsCommand', () => {
  test('notifies and does not scan outside TUI mode', async () => {
    //given
    const scenario: Scenario = { mode: 'rpc' }

    //when
    const state = await runScenario(scenario)

    //then
    assert.deepEqual(state.notifications, ['/toggle-skills requires interactive mode'])
    assert.equal(state.inventoryCalls, 0)
    assert.equal(state.customCalls, 0)
  })

  test('notifies when no skills are found', async () => {
    //given
    const scenario: Scenario = { skills: [] }

    //when
    const state = await runScenario(scenario)

    //then
    assert.deepEqual(state.notifications, [
      'Pi Skill Toggle: no skills found in global, user, or project skill directories',
    ])
    assert.equal(state.customCalls, 0)
  })

  test('stops after a cancelled dialog', async () => {
    //given
    const scenario: Scenario = { uiResult: { action: 'cancel', drafts: [{ skill, desiredMode: skill.mode }] } }

    //when
    const state = await runScenario(scenario)

    //then
    assert.equal(state.customCalls, 1)
    assert.equal(state.planned, 0)
    assert.equal(state.written, 0)
    assert.equal(state.reloads, 0)
    assert.deepEqual(state.notifications, [])
  })

  test('notifies when the planner finds no changes', async () => {
    //given
    const scenario: Scenario = {
      uiResult: { action: 'apply', drafts: [{ skill, desiredMode: 'manual-only' }] },
      changes: [],
    }

    //when
    const state = await runScenario(scenario)

    //then
    assert.deepEqual(state.notifications, ['Pi Skill Toggle: no changes to apply'])
    assert.equal(state.planned, 1)
    assert.equal(state.written, 0)
  })

  test('reports an applied change and reloads', async () => {
    //given
    const scenario: Scenario = {
      uiResult: { action: 'apply', drafts: [{ skill, desiredMode: 'manual-only' }] },
      changes: [change],
      applyResult: appliedResult,
    }

    //when
    const state = await runScenario(scenario)

    //then
    assert.deepEqual(state.notifications, [
      'Pi Skill Toggle applied 1 change.\n- skill: agent-invocable → manual-only\nReloaded skills, prompts, extensions, and themes.',
    ])
    assert.equal(state.written, 1)
    assert.equal(state.reloads, 1)
  })

  test('notifies when inventory fails', async () => {
    //given
    const scenario: Scenario = { inventoryError: true }

    //when
    const state = await runScenario(scenario)

    //then
    assert.deepEqual(state.notifications, ['Pi Skill Toggle failed to scan skills: offline'])
  })
})
