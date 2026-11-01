import { expect, test } from 'bun:test'
import type { ExecOptions, ExecResult } from '@earendil-works/pi-coding-agent'
import { createFakeExtensionContext, installFakePlugin } from '@eratio/pi-effect/testing'
import ghHelpersExtension from '../index.ts'

test('should open the current pull request given a branch with a PR', async () => {
  const fake = await installFakePlugin(ghHelpersExtension)
  const context = createFakeExtensionContext('/repo')
  const calls: unknown[] = []
  fake.api.exec = async (command: string, args: string[], options?: ExecOptions): Promise<ExecResult> => {
    calls.push({ command, args, cwd: options?.cwd })

    return { stdout: '', stderr: '', code: 0, killed: false }
  }

  await fake.invokeCommand('ghv', '', context)

  expect(calls).toEqual([{ command: 'gh', args: ['pr', 'view', '--web'], cwd: '/repo' }])
  await fake.invokeEvent('session_shutdown', { type: 'session_shutdown', reason: 'quit' })
})

test('should report the failure given the pull request cannot be opened', async () => {
  const fake = await installFakePlugin(ghHelpersExtension)
  const context = createFakeExtensionContext('/repo')
  const notifications: string[] = []
  context.ui.notify = (message: string): void => {
    notifications.push(message)
  }

  fake.api.exec = async (): Promise<ExecResult> => ({
    stdout: '',
    stderr: 'no pull request found',
    code: 1,
    killed: false,
  })

  await fake.invokeCommand('ghv', '', context)

  expect(notifications).toEqual(['Cannot open the pull request: no pull request found'])
  await fake.invokeEvent('session_shutdown', { type: 'session_shutdown', reason: 'quit' })
})
