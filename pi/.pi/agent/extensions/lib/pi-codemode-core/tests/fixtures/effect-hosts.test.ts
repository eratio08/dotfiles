import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import type { ProgramFailure as CodeModeFailure } from '../../src/index.ts'
import { ProgramHost as CodeModeEffectHost, createProgramRunner as createCodeModeCore } from '../../src/index.ts'
import { createCodeModeFixture, createOpenSrcFixture, createTodoFixture } from './effect-hosts.ts'

const options = {
  cwd: '/tmp',
  filenamePrefix: 'fixture',
  timeoutMs: 1000,
}

describe('Effect host fixtures', () => {
  test('runs the code-mode fixture', async () => {
    //given
    const fixture = createCodeModeFixture()
    const core = createCodeModeCore<never, CodeModeFailure>()

    //when
    const result = await Effect.runPromise(
      Effect.provideService(
        core.evaluate(fixture.definition, fixture.source, options),
        CodeModeEffectHost<never, CodeModeFailure>(),
        fixture.host,
      ),
    )

    //then
    expect(result).toBe('final:executed:status')
    expect(fixture.signals.every((signal) => signal instanceof AbortSignal)).toBe(true)
  })

  test('runs the OpenSrc fixture', async () => {
    //given
    const fixture = createOpenSrcFixture()
    const core = createCodeModeCore<never, CodeModeFailure>()

    //when
    const result = await Effect.runPromise(
      Effect.provideService(
        core.evaluate(fixture.definition, fixture.source, options),
        CodeModeEffectHost<never, CodeModeFailure>(),
        fixture.host,
      ),
    )

    //then
    expect(result).toBe('2:13:1')
    expect(fixture.maxConcurrentMutations()).toBe(1)
  })

  test('runs the todo fixture', async () => {
    //given
    const fixture = createTodoFixture()
    const core = createCodeModeCore<never, CodeModeFailure>()

    //when
    const result = await Effect.runPromise(
      Effect.provideService(
        core.evaluate(fixture.definition, fixture.source, options),
        CodeModeEffectHost<never, CodeModeFailure>(),
        fixture.host,
      ),
    )

    //then
    expect(result).toBe(1)
    expect(fixture.transaction.items).toEqual(['task'])
    expect(fixture.transaction.committed()).toBe(false)
    fixture.transaction.rollback()
    expect(fixture.transaction.rolledBack()).toBe(true)
  })
})
