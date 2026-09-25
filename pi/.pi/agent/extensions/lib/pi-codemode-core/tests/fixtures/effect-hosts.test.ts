import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import type { ProgramFailure } from '../../src/index.ts'
import { createProgramRunner, ProgramHost } from '../../src/index.ts'
import { createCodeModeFixture, createOpenSrcFixture, createTodoFixture } from './effect-hosts.ts'

const options = {
  cwd: '/tmp',
  filenamePrefix: 'fixture',
  timeoutMs: 1000,
}

describe('Effect host fixtures', () => {
  test('should run the code-mode fixture given its Effect host', async () => {
    //given
    const fixture = createCodeModeFixture()
    const core = createProgramRunner<never, ProgramFailure>()

    //when
    const result = await Effect.runPromise(
      Effect.provideService(
        core.evaluate(fixture.definition, fixture.source, options),
        ProgramHost<never, ProgramFailure>(),
        fixture.host,
      ),
    )

    //then
    expect(result).toBe('final:executed:status')
    expect(fixture.signals.every((signal) => signal instanceof AbortSignal)).toBe(true)
  })

  test('should run the OpenSrc fixture given its host', async () => {
    //given
    const fixture = createOpenSrcFixture()
    const core = createProgramRunner<never, ProgramFailure>()

    //when
    const result = await Effect.runPromise(
      Effect.provideService(
        core.evaluate(fixture.definition, fixture.source, options),
        ProgramHost<never, ProgramFailure>(),
        fixture.host,
      ),
    )

    //then
    expect(result).toBe('2:13:1')
    expect(fixture.maxConcurrentMutations()).toBe(1)
  })

  test('should run the todo fixture given its host', async () => {
    //given
    const fixture = createTodoFixture()
    const core = createProgramRunner<never, ProgramFailure>()

    //when
    const result = await Effect.runPromise(
      Effect.provideService(
        core.evaluate(fixture.definition, fixture.source, options),
        ProgramHost<never, ProgramFailure>(),
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
