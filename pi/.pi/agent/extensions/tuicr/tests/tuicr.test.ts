import assert from 'node:assert/strict'
import test from 'node:test'
import { type ExecResult, type ExtensionAPI, initTheme } from '@earendil-works/pi-coding-agent'
import { Effect, ManagedRuntime } from 'effect'
import tuicrExtension from '../index.ts'
import {
  buildTuicrArgs,
  buildTuicrBlockingCommand,
  buildTuicrCommand,
  type CommentData,
  compareSessions,
  decodeHerdrPaneId,
  normalizeComments,
  type SessionSummary,
  selectSessionSlug,
  TUICR_COMPLETION_MARKER,
} from '../src/core.ts'
import { Tuicr, TuicrLayer } from '../src/effects.ts'

type ExecCall = {
  readonly command: string
  readonly args: readonly string[]
  readonly signal: AbortSignal
}

type PiFixture = {
  readonly pi: ExtensionAPI
  readonly calls: ExecCall[]
}

type ToolResultLike = {
  readonly content: readonly { readonly type: string; readonly text?: string }[]
  readonly details?: unknown
}

type ToolRegistration = {
  readonly name: string
  readonly renderResult: (
    result: ToolResultLike,
    options: { readonly expanded: boolean; readonly isPartial?: boolean },
    theme: { fg: (color: string, text: string) => string; bold: (text: string) => string },
    context: { readonly isError: boolean },
  ) => { render: (width: number) => readonly string[] }
}

function execResult(stdout = '', code = 0, stderr = ''): ExecResult {
  return { code, killed: false, stderr, stdout }
}

function session(slug: string, active: boolean): SessionSummary {
  return {
    slug,
    kind: 'local',
    path: '/repo',
    updated_at: '2026-01-01T00:00:00Z',
    comment_count: 0,
    reviewed_count: 0,
    file_count: 1,
    anchor: 'HEAD',
    active,
  }
}

function comment(id: string, author?: string): CommentData {
  return {
    id,
    location: 'src/core.ts:10',
    path: 'src/core.ts',
    start_line: 10,
    end_line: 10,
    side: 'new',
    comment_type: 'note',
    lifecycle_state: 'local_draft',
    created_at: '2026-01-01T00:00:00Z',
    content: `comment ${id}`,
    author,
  }
}

function makePi(): PiFixture {
  const calls: ExecCall[] = []
  let sessionListCalls = 0
  const comments = [comment('user-comment'), comment('agent-comment', 'agent')]
  const pi = {
    exec: async (command: string, args: readonly string[], options: { signal: AbortSignal }): Promise<ExecResult> => {
      calls.push({ command, args, signal: options.signal })
      if (command === 'tuicr' && args[0] === 'review' && args[1] === 'list') {
        sessionListCalls += 1
        return execResult(JSON.stringify(sessionListCalls === 1 ? [] : [session('new-session', true)]))
      }
      if (command === 'tuicr' && args[0] === 'review' && args[1] === 'comments') {
        return execResult(JSON.stringify(comments))
      }
      if (command === 'herdr' && args[0] === 'pane' && args[1] === 'split') {
        return execResult(JSON.stringify({ result: { pane: { pane_id: 'window:pane' } } }))
      }
      if (command === 'herdr' && args[0] === 'pane') return execResult()
      throw new Error(`unexpected process: ${command} ${args.join(' ')}`)
    },
  } as unknown as ExtensionAPI
  return { pi, calls }
}

async function withHerdrEnvironment<T>(value: string | undefined, action: () => Promise<T>): Promise<T> {
  const previous = process.env.HERDR_ENV
  if (value === undefined) delete process.env.HERDR_ENV
  else process.env.HERDR_ENV = value
  try {
    return await action()
  } finally {
    if (previous === undefined) delete process.env.HERDR_ENV
    else process.env.HERDR_ENV = previous
  }
}

function compareAndSelect(before: readonly SessionSummary[], after: readonly SessionSummary[]) {
  return { comparison: compareSessions(before, after), selection: selectSessionSlug(before, after) }
}

function buildReviewInvocation(scope: { readonly type: 'revisions'; readonly revset: string }) {
  return {
    args: buildTuicrArgs(scope),
    command: buildTuicrCommand(scope),
    blockingCommand: buildTuicrBlockingCommand(scope),
  }
}

async function abortAfterTick(controller: AbortController): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  controller.abort()
}

type RenderTheme = { fg: (color: string, text: string) => string; bold: (text: string) => string }

function renderCommentStates(
  tool: ToolRegistration,
  result: ToolResultLike,
  theme: RenderTheme,
): { collapsed: readonly string[]; expanded: readonly string[] } {
  return {
    collapsed: tool.renderResult(result, { expanded: false }, theme, { isError: false }).render(120),
    expanded: tool.renderResult(result, { expanded: true }, theme, { isError: false }).render(120),
  }
}

test('builds explicit and shell-safe review arguments', () => {
  //given
  const scope = { type: 'revisions' as const, revset: "HEAD~1..HEAD; printf 'bad'" }

  //when
  const result = buildReviewInvocation(scope)

  //then
  assert.deepEqual(result.args, ['tui', '--revisions', scope.revset])
  assert.equal(result.command, "'tuicr' 'tui' '--revisions' 'HEAD~1..HEAD; printf '\\''bad'\\'''")
  assert.equal(result.blockingCommand.includes(TUICR_COMPLETION_MARKER), false)
})

test('compares sessions and rejects ambiguous discovery', () => {
  //given
  const before = [session('old', false)]
  const after = [session('old', false), session('one', true), session('two', true)]

  //when
  const result = compareAndSelect(before, after)

  //then
  assert.deepEqual(
    result.comparison.added.map((item) => item.slug),
    ['one', 'two'],
  )
  assert.equal(result.selection._tag, 'ambiguous')
})

test('normalizes comments to user-authored records', () => {
  //given
  const comments = [comment('implicit-user'), comment('agent', 'agent')]

  //when
  const normalized = normalizeComments(comments)

  //then
  assert.deepEqual(
    normalized.map((item) => item.id),
    ['implicit-user'],
  )
})

test('rejects malformed Herdr pane responses', () => {
  //given
  const response = { result: { pane: {} } }

  //when
  const paneId = decodeHerdrPaneId(response)

  //then
  assert.equal(paneId, null)
})

test('opens the owned pane, retrieves user comments, and closes only that pane', async () => {
  //given
  await withHerdrEnvironment('1', async () => {
    const fixture = makePi()
    const runtime = ManagedRuntime.make(TuicrLayer(fixture.pi, { discoveryAttempts: 2, discoveryDelayMs: 0 }))
    const controller = new AbortController()

    //when
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const service = yield* Tuicr
        const opened = yield* service.open('/repo', { type: 'working-tree' })
        yield* service.close()
        return opened
      }),
      { signal: controller.signal },
    )

    //then
    assert.equal(result.pane.paneId, 'window:pane')
    assert.equal(result.session.slug, 'new-session')
    assert.deepEqual(
      result.comments.map((item) => item.id),
      ['user-comment'],
    )
    assert.deepEqual(
      fixture.calls.map(({ command, args }) => [command, ...args]),
      [
        ['tuicr', 'review', 'list', '--repo', '/repo'],
        ['herdr', 'pane', 'split', '--current', '--direction', 'right', '--cwd', '/repo', '--no-focus'],
        [
          'herdr',
          'pane',
          'run',
          'window:pane',
          "'tuicr' 'tui' '--working-tree'; 'printf' '%s%s\\n' '__PI_TUICR_' 'COMPLETED__'",
        ],
        ['tuicr', 'review', 'list', '--repo', '/repo'],
        [
          'herdr',
          'pane',
          'wait-output',
          'window:pane',
          '--match',
          '__PI_TUICR_COMPLETED__',
          '--source',
          'recent-unwrapped',
        ],
        ['tuicr', 'review', 'comments', '--repo', '/repo', '--session', 'new-session'],
        ['herdr', 'pane', 'close', 'window:pane'],
      ],
    )
    assert.ok(fixture.calls.every((call) => call.signal instanceof AbortSignal))
    assert.equal(
      fixture.calls.some((call) => call.args.includes('add')),
      false,
    )
    await runtime.dispose()
  })
})

test('refuses Herdr operations without the required environment', async () => {
  //given
  await withHerdrEnvironment(undefined, async () => {
    const fixture = makePi()
    const runtime = ManagedRuntime.make(TuicrLayer(fixture.pi, { discoveryAttempts: 1, discoveryDelayMs: 0 }))

    //when
    const rejection = runtime.runPromise(
      Effect.gen(function* () {
        const service = yield* Tuicr
        return yield* service.open('/repo', { type: 'working-tree' })
      }),
    )

    //then
    await assert.rejects(rejection, /HERDR_ENV=1/)
    assert.equal(fixture.calls.length, 0)
    await runtime.dispose()
  })
})

test('closes a pane when launch fails after ownership starts', async () => {
  //given
  await withHerdrEnvironment('1', async () => {
    const calls: Array<readonly string[]> = []
    let split = false
    const pi = {
      exec: async (command: string, args: readonly string[]): Promise<ExecResult> => {
        calls.push([command, ...args])
        if (command === 'tuicr') return execResult('[]')
        if (args[1] === 'split') {
          split = true
          return execResult(JSON.stringify({ result: { pane: { pane_id: 'owned:pane' } } }))
        }
        if (split && args[1] === 'run') return execResult('', 1, 'launch failed')
        return execResult()
      },
    } as unknown as ExtensionAPI
    const runtime = ManagedRuntime.make(TuicrLayer(pi, { discoveryAttempts: 1, discoveryDelayMs: 0 }))

    //when
    const rejection = runtime.runPromise(
      Effect.gen(function* () {
        const service = yield* Tuicr
        return yield* service.open('/repo', { type: 'working-tree' })
      }),
    )

    //then
    await assert.rejects(rejection, /process exited with code 1/)
    assert.deepEqual(calls.slice(-1)[0], ['herdr', 'pane', 'close', 'owned:pane'])
    await runtime.dispose()
  })
})

test('passes cancellation to the process effect', async () => {
  //given
  await withHerdrEnvironment('1', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const pi = {
      exec: async (
        _command: string,
        _args: readonly string[],
        options: { signal: AbortSignal },
      ): Promise<ExecResult> => {
        receivedSignal = options.signal
        await new Promise<never>((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
        throw new Error('unreachable')
      },
    } as unknown as ExtensionAPI
    const runtime = ManagedRuntime.make(TuicrLayer(pi, { discoveryAttempts: 1, discoveryDelayMs: 0 }))
    const pending = runtime.runPromise(
      Effect.gen(function* () {
        const service = yield* Tuicr
        return yield* service.open('/repo', { type: 'working-tree' })
      }),
      { signal: controller.signal },
    )

    //when
    await abortAfterTick(controller)

    //then
    await assert.rejects(pending)
    assert.equal(receivedSignal?.aborted, true)
    await runtime.dispose()
  })
})

test('renders collapsed and expanded comment results', () => {
  //given
  let registration: unknown
  const pi = {
    registerTool(options: unknown): void {
      registration = options
    },
    on(): void {},
  } as unknown as ExtensionAPI
  tuicrExtension(pi)
  initTheme()
  const tool = registration as ToolRegistration
  const theme = {
    fg: (_color: string, text: string): string => text,
    bold: (text: string): string => text,
  }
  const result: ToolResultLike = {
    content: [{ type: 'text', text: 'src/core.ts:10: fix this' }],
    details: { action: 'comments', comments: [comment('one')] },
  }

  //when
  const states = renderCommentStates(tool, result, theme)

  //then
  assert.equal(tool.name, 'tuicr')
  assert.match(states.collapsed.join('\n'), /1 user comment/)
  assert.match(states.expanded.join('\n'), /fix this/)
})
