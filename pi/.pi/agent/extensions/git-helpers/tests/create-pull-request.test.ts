import { afterEach, expect, test } from 'bun:test'
import type { ExecOptions, ExecResult } from '@earendil-works/pi-coding-agent'
import { createFakeExtensionContext, installFakePlugin } from '@eratio/pi-effect/testing'
import gitHelpersExtension from '../index.ts'

type ProcessCall = { command: string; args: string[]; cwd: string | undefined }
type TestOptions = {
  remote?: string
  merge?: string
  remotes?: string
  status?: string
  failure?: string
  branchAfterPush?: string
}

const installed: Awaited<ReturnType<typeof installFakePlugin>>[] = []

afterEach(async (): Promise<void> => {
  for (const fake of installed.splice(0)) {
    await fake.invokeEvent('session_shutdown', { type: 'session_shutdown', reason: 'quit' })
  }
})

async function setupPullRequestTest(options: TestOptions = {}): Promise<{
  fake: Awaited<ReturnType<typeof installFakePlugin>>
  context: ReturnType<typeof createFakeExtensionContext>
  calls: ProcessCall[]
  notifications: string[]
}> {
  const fake = await installFakePlugin(gitHelpersExtension)
  installed.push(fake)
  const context = createFakeExtensionContext('/repo')
  const calls: ProcessCall[] = []
  const notifications: string[] = []
  context.ui.notify = (message: string): void => {
    notifications.push(message)
  }

  fake.api.exec = async (command: string, args: string[], execOptions?: ExecOptions): Promise<ExecResult> => {
    calls.push({ command, args: [...args], cwd: execOptions?.cwd })
    const key = [command, ...args].join(' ')
    if (options.failure && key.startsWith(options.failure)) {
      return { stdout: '', stderr: 'simulated failure', code: 1, killed: false }
    }

    let stdout = ''
    let code = 0
    if (key === 'git symbolic-ref --quiet --short HEAD') {
      stdout = calls.some(({ args }) => args[0] === 'push') ? (options.branchAfterPush ?? 'feature\n') : 'feature\n'
    }
    if (key === 'git config --get branch.feature.remote') {
      stdout = options.remote ?? ''
      code = stdout ? 0 : 1
    }
    if (key === 'git config --get branch.feature.merge') {
      stdout = options.merge ?? ''
      code = stdout ? 0 : 1
    }
    if (key === 'git remote') stdout = options.remotes ?? 'origin\n'
    if (key.startsWith('git status')) stdout = options.status ?? ''
    if (key.startsWith('gh pr create')) stdout = 'https://github.com/owner/repo/pull/42\n'
    return { stdout, stderr: '', code, killed: false }
  }

  return { fake, context, calls, notifications }
}

test('should push and open the new PR given an untracked branch and one remote', async () => {
  const { fake, context, calls, notifications } = await setupPullRequestTest({ status: ' M file\n' })

  await fake.invokeCommand('ghpr', '', context)

  expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
    ['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'],
    ['git', 'config', '--get', 'branch.feature.remote'],
    ['git', 'config', '--get', 'branch.feature.merge'],
    ['git', 'remote'],
    ['gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    ['git', 'status', '--porcelain', '--untracked-files=normal'],
    ['git', 'push', '--no-follow-tags', '--set-upstream', '--', 'origin', 'refs/heads/feature:refs/heads/feature'],
    ['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'],
    ['gh', 'pr', 'create', '--fill'],
    ['gh', 'pr', 'view', 'https://github.com/owner/repo/pull/42', '--web'],
  ])
  expect(calls.every(({ cwd }) => cwd === '/repo')).toBe(true)
  expect(notifications.join('\n')).toContain('Uncommitted changes will not be included')
  expect(notifications.join('\n')).toContain('Created pull request: https://github.com/owner/repo/pull/42')
})

test('should create and open a draft PR given /ghprd', async () => {
  const { fake, context, calls } = await setupPullRequestTest()

  await fake.invokeCommand('ghprd', '', context)

  expect(calls.find(({ args }) => args[0] === 'pr' && args[1] === 'create')?.args).toEqual([
    'pr',
    'create',
    '--fill',
    '--draft',
  ])
  expect(calls.find(({ args }) => args[0] === 'pr' && args[1] === 'view')?.args).toEqual([
    'pr',
    'view',
    'https://github.com/owner/repo/pull/42',
    '--web',
  ])
})

test('should stop without pushing given GitHub is unavailable', async () => {
  const { fake, context, calls, notifications } = await setupPullRequestTest({ failure: 'gh repo view' })

  await fake.invokeCommand('ghpr', '', context)

  expect(calls.some(({ args }) => args[0] === 'push')).toBe(false)
  expect(notifications.join('\n')).toContain('simulated failure')
})

test('should push to the configured upstream given multiple remotes', async () => {
  const { fake, context, calls } = await setupPullRequestTest({
    remote: 'fork',
    merge: 'refs/heads/feature',
    remotes: 'fork\nupstream\n',
  })

  await fake.invokeCommand('ghpr', '', context)

  expect(calls.find(({ args }) => args[0] === 'push')?.args).toEqual([
    'push',
    '--no-follow-tags',
    '--',
    'fork',
    'refs/heads/feature:refs/heads/feature',
  ])
})

test('should stop without pushing given a detached HEAD', async () => {
  const { fake, context, calls, notifications } = await setupPullRequestTest({ failure: 'git symbolic-ref' })

  await fake.invokeCommand('ghpr', '', context)

  expect(calls.some(({ args }) => args[0] === 'push')).toBe(false)
  expect(notifications.join('\n')).toContain('The current branch is not available')
})

test('should stop without pushing given an ambiguous remote', async () => {
  const { fake, context, calls, notifications } = await setupPullRequestTest({ remotes: 'origin\nupstream\n' })

  await fake.invokeCommand('ghpr', '', context)

  expect(calls.some(({ args }) => args[0] === 'push')).toBe(false)
  expect(notifications.join('\n')).toContain('push remote is ambiguous')
})

test('should stop without pushing given an upstream tracking another branch', async () => {
  const { fake, context, calls, notifications } = await setupPullRequestTest({
    remote: 'origin',
    merge: 'refs/heads/main',
  })

  await fake.invokeCommand('ghpr', '', context)

  expect(calls.some(({ args }) => args[0] === 'push')).toBe(false)
  expect(notifications.join('\n')).toContain('does not match the current branch')
})

test('should stop before creating a PR given a failed push', async () => {
  const { fake, context, calls, notifications } = await setupPullRequestTest({ failure: 'git push' })

  await fake.invokeCommand('ghpr', '', context)

  expect(calls.some(({ args }) => args[0] === 'pr')).toBe(false)
  expect(notifications.join('\n')).toContain('simulated failure')
})

test('should not create a PR given the current branch changes after the push', async () => {
  const { fake, context, calls, notifications } = await setupPullRequestTest({ branchAfterPush: 'other\n' })

  await fake.invokeCommand('ghpr', '', context)

  expect(calls.some(({ args }) => args[0] === 'pr' && args[1] === 'create')).toBe(false)
  expect(notifications.join('\n')).toContain('the current branch changed')
})

test('should report the push given PR creation fails', async () => {
  const { fake, context, calls, notifications } = await setupPullRequestTest({ failure: 'gh pr create' })

  await fake.invokeCommand('ghpr', '', context)

  expect(calls.some(({ args }) => args[0] === 'push')).toBe(true)
  expect(calls.some(({ args }) => args[1] === 'view' && args[0] === 'pr')).toBe(false)
  expect(notifications.join('\n')).toContain('The branch was pushed, but PR creation failed')
})

test('should report the created PR URL given the browser fails', async () => {
  const { fake, context, notifications } = await setupPullRequestTest({ failure: 'gh pr view' })

  await fake.invokeCommand('ghpr', '', context)

  expect(notifications.join('\n')).toContain('The pull request was created, but the browser did not open:')
  expect(notifications.join('\n')).toContain('https://github.com/owner/repo/pull/42')
})
