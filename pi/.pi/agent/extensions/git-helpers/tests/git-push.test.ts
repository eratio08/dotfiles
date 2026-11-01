import { expect, test } from 'bun:test'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecResult } from '@earendil-works/pi-coding-agent'
import { createFakeExtensionContext, installFakePlugin } from '@eratio/pi-effect/testing'
import gitHelpersExtension from '../index.ts'

test('should push only the current branch given a local bare remote', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'git-helpers-'))
  const repository = join(directory, 'repo')
  const remote = join(directory, 'remote.git')
  const git = (args: string[], cwd = directory): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

  git(['init', '--bare', remote])
  git(['init', '-b', 'feature', repository])
  git(['config', 'user.name', 'Test'], repository)
  git(['config', 'user.email', 'test@example.com'], repository)
  git(['-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Initial'], repository)
  git(['remote', 'add', 'origin', remote], repository)
  const fake = await installFakePlugin(gitHelpersExtension)
  const context = createFakeExtensionContext(repository)
  fake.api.exec = async (command: string, args: string[]): Promise<ExecResult> => {
    if (command === 'git') {
      const result = spawnSync('git', args, { cwd: repository, encoding: 'utf8' })
      return { stdout: result.stdout ?? '', stderr: result.stderr ?? '', code: result.status ?? 1, killed: false }
    }

    const stdout = args[0] === 'pr' && args[1] === 'create' ? 'https://github.com/owner/repo/pull/42\n' : ''
    return { stdout, stderr: '', code: 0, killed: false }
  }

  try {
    await fake.invokeCommand('ghpr', '', context)

    expect(git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], repository).trim()).toBe(
      'origin/feature',
    )
    expect(git(['rev-parse', 'refs/heads/feature'], remote).trim()).toBe(git(['rev-parse', 'HEAD'], repository).trim())
  } finally {
    await fake.invokeEvent('session_shutdown', { type: 'session_shutdown', reason: 'quit' })
    await rm(directory, { recursive: true, force: true })
  }
})
