import { expect, test } from 'bun:test'
import { Effect } from 'effect'
import { createPiToolsService } from '../src/services/active-tools.ts'
import type { PiHostOperations } from '../src/services.ts'

test('should release a semaphore permit given an interrupted waiting tool operation', async () => {
  //given
  const calls: string[][] = []
  let firstStartedResolve: (() => void) | undefined
  let releaseFirst: (() => void) | undefined
  const firstStarted = new Promise<void>((resolve) => {
    firstStartedResolve = resolve
  })
  const firstRelease = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })
  const host: PiHostOperations = {
    exec: () => Effect.succeed({ stdout: '', stderr: '', code: 0, killed: false }),
    sendMessage: () => Effect.succeed(undefined),
    sendUserMessage: () => Effect.succeed(undefined),
    appendEntry: () => Effect.succeed(undefined),
    setSessionName: () => Effect.succeed(undefined),
    getSessionName: () => Effect.succeed(undefined),
    setLabel: () => Effect.succeed(undefined),
    getActiveTools: () => Effect.succeed([]),
    getAllTools: () => Effect.succeed([]),
    setActiveTools: (toolNames) =>
      Effect.suspend(() => {
        calls.push([...toolNames])
        if (toolNames[0] === 'first') {
          return Effect.promise(() => {
            firstStartedResolve?.()
            return firstRelease
          })
        }
        return Effect.succeed(undefined)
      }),
    getFlag: () => Effect.succeed(undefined),
    setModel: () => Effect.succeed(true),
    getThinkingLevel: () => Effect.succeed('medium'),
    setThinkingLevel: () => Effect.succeed(undefined),
    registerProvider: () => Effect.succeed(undefined),
    unregisterProvider: () => Effect.succeed(undefined),
    events: {
      emit: () => Effect.succeed(undefined),
      on: () => Effect.succeed(Effect.succeed(undefined)),
      onScoped: () => Effect.succeed(undefined),
    },
  }
  const tools = createPiToolsService(host)
  const exercise = async (): Promise<{
    readonly beforeRelease: readonly string[][]
    readonly afterRelease: readonly string[][]
  }> => {
    const first = Effect.runPromise(tools.replaceActive(['first']))
    await firstStarted
    const controller = new AbortController()
    const second = Effect.runPromise(tools.replaceActive(['second']), { signal: controller.signal })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    controller.abort()
    let interrupted = false
    try {
      await second
    } catch {
      interrupted = true
    }
    if (!interrupted) throw new Error('The waiting tool operation was not interrupted.')
    const beforeRelease = calls.map((call) => [...call])
    if (!releaseFirst) throw new Error('The first tool operation did not start.')
    releaseFirst()
    await first
    await Effect.runPromise(tools.replaceActive(['third']))
    return { beforeRelease, afterRelease: calls }
  }

  //when
  const callsAfterCancellation = await exercise()

  //then
  expect(callsAfterCancellation.beforeRelease).toEqual([['first']])
  expect(callsAfterCancellation.afterRelease).toEqual([['first'], ['third']])
})
