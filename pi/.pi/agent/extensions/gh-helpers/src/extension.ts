import { PiContext, PiOperationsError, PiProcess, PiUi } from '@eratio/pi-effect'
import { Effect } from 'effect'

const runGitProcess = Effect.fn('runGitProcess')(function* (
  command: 'git' | 'gh',
  args: readonly string[],
  allowMissing = false,
) {
  const process = yield* PiProcess
  const context = yield* PiContext
  const result = yield* process.exec(command, args, { cwd: context.cwd, signal: context.signal, timeout: 120_000 })

  if (result.killed || (result.code !== 0 && !(allowMissing && result.code === 1))) {
    const details = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join('\n')

    return yield* new PiOperationsError({
      operation: command,
      message: details || `${command} failed or is not installed. Check the command and its authentication.`,
    })
  }

  return result
})

const openCurrentPullRequest = Effect.fn('openCurrentPullRequest')(function* () {
  const ui = yield* PiUi

  yield* runGitProcess('gh', ['pr', 'view', '--web']).pipe(
    Effect.catchTag('PiOperationsError', (error) =>
      ui.notify(`Cannot open the pull request: ${error.message}`, 'error'),
    ),
  )
})

const currentPushDestination = Effect.fn('currentPushDestination')(function* (branch: string) {
  const remoteResult = yield* runGitProcess('git', ['config', '--get', `branch.${branch}.remote`], true)
  const mergeResult = yield* runGitProcess('git', ['config', '--get', `branch.${branch}.merge`], true)
  const remote = remoteResult.stdout.trim()
  const merge = mergeResult.stdout.trim()
  const remotes = (yield* runGitProcess('git', ['remote'])).stdout.trim().split('\n').filter(Boolean)

  if (remote || merge) {
    if (!remote || !merge || !remotes.includes(remote) || merge !== `refs/heads/${branch}`) {
      return yield* new PiOperationsError({
        operation: 'git',
        message:
          'The branch upstream is incomplete or does not match the current branch. Configure a matching upstream before pushing.',
      })
    }

    return { remote, setUpstream: false }
  }

  if (remotes.length !== 1 || remotes[0] === undefined) {
    return yield* new PiOperationsError({
      operation: 'git',
      message: 'The branch has no upstream and the push remote is ambiguous. Configure an upstream before pushing.',
    })
  }

  return { remote: remotes[0], setUpstream: true }
})

const createPullRequest = Effect.fn('createPullRequest')(function* (draft: boolean) {
  const ui = yield* PiUi
  const branch = (yield* runGitProcess('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], true)).stdout.trim()

  if (!branch) {
    return yield* new PiOperationsError({ operation: 'git', message: 'The current branch is not available.' })
  }

  const destination = yield* currentPushDestination(branch)
  yield* runGitProcess('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'])
  const status = yield* runGitProcess('git', ['status', '--porcelain', '--untracked-files=normal'])

  if (status.stdout.trim()) {
    yield* ui.notify('Uncommitted changes will not be included in the pull request.', 'warning')
  }

  const pushArgs = ['push', '--no-follow-tags']

  if (destination.setUpstream) pushArgs.push('--set-upstream')
  pushArgs.push('--', destination.remote, `refs/heads/${branch}:refs/heads/${branch}`)
  yield* runGitProcess('git', pushArgs)

  const currentBranch = (yield* runGitProcess(
    'git',
    ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    true,
  )).stdout.trim()

  if (currentBranch !== branch) {
    return yield* new PiOperationsError({
      operation: 'git',
      message: `The branch ${branch} was pushed, but the current branch changed. No pull request was created.`,
    })
  }

  const createArgs = ['pr', 'create', '--fill']

  if (draft) createArgs.push('--draft')

  const result = yield* runGitProcess('gh', createArgs).pipe(
    Effect.mapError(
      (error) =>
        new PiOperationsError({
          operation: 'gh',
          message: `The branch was pushed, but PR creation failed. Check /ghv before retrying. ${error.message}`,
        }),
    ),
  )

  const url = result.stdout.trim()

  if (!/^https:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\/pull\/\d+$/.test(url)) {
    return yield* new PiOperationsError({
      operation: 'gh',
      message: `The branch was pushed and PR creation returned an unexpected result. Check /ghv before retrying. ${url}`,
    })
  }

  yield* ui.notify(`Created pull request: ${url}`, 'info')
  yield* runGitProcess('gh', ['pr', 'view', url, '--web']).pipe(
    Effect.catchTag('PiOperationsError', (error) =>
      ui.notify(`The pull request was created, but the browser did not open: ${url}\n${error.message}`, 'error'),
    ),
  )
})

const handleCreatePullRequest = Effect.fn('handleCreatePullRequest')(function* (draft: boolean) {
  const ui = yield* PiUi
  yield* createPullRequest(draft).pipe(
    Effect.catchTag('PiOperationsError', (error) =>
      ui.notify(`Cannot create the pull request: ${error.message}`, 'error'),
    ),
  )
})

export { handleCreatePullRequest, openCurrentPullRequest }
