import assert from 'node:assert/strict'
import test from 'node:test'
import {
  type AgentToolResult,
  type ExecResult,
  type ExtensionAPI,
  initTheme,
  type Theme,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Data, Effect, Layer, ManagedRuntime } from 'effect'
import tuicrExtension from '../index.ts'
import {
  buildTuicrArgs,
  buildTuicrBlockingCommand,
  buildTuicrCommand,
  type CommentData,
  compareSessions,
  decodeHerdrPaneId,
  normalizeComments,
  type ReviewScope,
  type SessionComparison,
  type SessionSelection,
  type SessionSummary,
  selectSessionSlug,
  TUICR_COMPLETION_MARKER,
  Tuicr,
  TuicrConfig,
  TuicrLayer,
  type TuicrLayerOptions,
  TuicrPi,
} from '../src/extension.ts'

type ExecCall = {
  readonly command: string
  readonly args: readonly string[]
  readonly signal: AbortSignal
}

type PiFixture = {
  readonly pi: ExtensionAPI
  readonly calls: ExecCall[]
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
    location: 'src/extension.ts:10',
    path: 'src/extension.ts',
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
  const pi = Object.assign({} as ExtensionAPI, {
    exec: async (command: string, args: readonly string[], options: { signal: AbortSignal }): Promise<ExecResult> => {
      calls.push({ command, args, signal: options.signal })
      if (command === 'tuicr' && args[0] === '--help') {
        return execResult('  --stdout  Output to stdout')
      }
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
      if (command === 'herdr' && args[0] === 'pane' && args[1] === 'wait-output') {
        return execResult(JSON.stringify({ result: { matched_line: `${args[4]}:0` } }))
      }
      if (command === 'herdr' && args[0] === 'pane') return execResult()
      throw new Error(`unexpected process: ${command} ${args.join(' ')}`)
    },
  })
  return { pi, calls }
}

function makeRuntime(pi: ExtensionAPI, options: TuicrLayerOptions = {}): ManagedRuntime.ManagedRuntime<Tuicr, never> {
  return ManagedRuntime.make(
    TuicrLayer.pipe(Layer.provide(Layer.succeed(TuicrPi, pi)), Layer.provide(Layer.succeed(TuicrConfig, options))),
  )
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

type SessionComparisonResult = { comparison: SessionComparison; selection: SessionSelection }

function compareAndSelect(
  before: readonly SessionSummary[],
  after: readonly SessionSummary[],
): SessionComparisonResult {
  return { comparison: compareSessions(before, after), selection: selectSessionSlug(before, after) }
}

type ReviewInvocation = { args: readonly string[]; command: string; blockingCommand: string }

function buildReviewInvocation(scope: { readonly type: 'revisions'; readonly revset: string }): ReviewInvocation {
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

type CommentRenderStates = { collapsed: readonly string[]; expanded: readonly string[] }

function renderCommentStates(
  tool: ToolDefinition,
  result: AgentToolResult<unknown>,
  theme: Theme,
): CommentRenderStates {
  const renderResult = tool.renderResult
  assert.ok(renderResult)
  const context = { isError: false } as Parameters<typeof renderResult>[3]
  return {
    collapsed: renderResult(result, { expanded: false, isPartial: false }, theme, context).render(120),
    expanded: renderResult(result, { expanded: true, isPartial: false }, theme, context).render(120),
  }
}

test('should build explicit and shell-safe review arguments given review options', () => {
  //given
  const scope = { type: 'revisions' as const, revset: "HEAD~1..HEAD; printf 'bad'" }

  //when
  const result = buildReviewInvocation(scope)

  //then
  assert.deepEqual(result.args, ['tui', '--revisions', scope.revset])
  assert.equal(result.command, "'tuicr' 'tui' '--revisions' 'HEAD~1..HEAD; printf '\\''bad'\\'''")
  assert.match(result.blockingCommand, /bash -c/)
  assert.match(result.blockingCommand, /%s%s:%s/)
  assert.equal(result.blockingCommand.includes(TUICR_COMPLETION_MARKER), false)
})

test('should reject invalid review scopes at the command boundary', () => {
  for (const scope of [null, { type: 'revisions', revset: '  ' }]) {
    assert.throws(() => buildTuicrArgs(scope as ReviewScope))
  }
})

test('should compare sessions and reject ambiguous discovery given multiple sessions', () => {
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
  assert.equal(selectSessionSlug([], [])._tag, 'none')
})

test('should select an updated existing session given session metadata', () => {
  //given
  const before = [session('existing', false)]
  const after = [{ ...session('existing', false), comment_count: 1, updated_at: '2026-01-01T00:01:00Z' }]

  //when
  const result = selectSessionSlug(before, after)

  //then
  assert.deepEqual(result, Data.taggedEnum<SessionSelection>().found({ session: after[0] }))
})

test('should normalize comments to user-authored records given raw comment data', () => {
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

test('should reject malformed Herdr pane responses given invalid response data', () => {
  //given
  const response = { result: { pane: {} } }

  //when
  const paneId = decodeHerdrPaneId(response)

  //then
  assert.equal(paneId, null)
})

test('should open the owned pane, retrieve user comments, and close only that pane given a review lifecycle', async () => {
  //given
  await withHerdrEnvironment('1', async () => {
    const fixture = makePi()
    const runtime = makeRuntime(fixture.pi, { discoveryAttempts: 2, discoveryDelayMs: 0 })
    const controller = new AbortController()

    //when
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const service = yield* Tuicr
        return yield* service.open('/repo', { type: 'working-tree' })
      }),
      { signal: controller.signal },
    )

    //then
    assert.equal(result.pane.paneId, 'window:pane')
    assert.equal(result.session?.slug, 'new-session')
    assert.deepEqual(
      result.comments.map((item) => item.id),
      ['user-comment'],
    )
    const calls = fixture.calls.map(({ command, args }) => [command, ...args])
    assert.deepEqual(calls[0], ['tuicr', '--help'])
    assert.deepEqual(calls[1], ['tuicr', 'review', 'list', '--repo', '/repo'])
    assert.deepEqual(calls[2], [
      'herdr',
      'pane',
      'split',
      '--current',
      '--direction',
      'right',
      '--cwd',
      '/repo',
      '--focus',
    ])
    assert.deepEqual(calls[3], ['herdr', 'pane', 'zoom', '--on', '--pane', 'window:pane'])
    assert.deepEqual(calls[4]?.slice(0, 4), ['herdr', 'pane', 'run', 'window:pane'])
    assert.match(calls[4]?.[4] ?? '', new RegExp(`^bash -c .*${TUICR_COMPLETION_MARKER}_`))
    assert.match(calls[4]?.[4] ?? '', /--stdout/)
    assert.deepEqual(calls[5]?.slice(0, 5), ['herdr', 'pane', 'wait-output', 'window:pane', '--match'])
    const completionMarker = calls[5]?.[5] ?? ''
    assert.match(completionMarker, new RegExp(`^${TUICR_COMPLETION_MARKER}_[0-9a-f-]+$`))
    assert.deepEqual(calls[5]?.slice(6), ['--source', 'recent-unwrapped'])
    assert.deepEqual(calls[6], ['tuicr', 'review', 'list', '--repo', '/repo'])
    assert.deepEqual(calls[7], ['tuicr', 'review', 'comments', '--repo', '/repo', '--session', 'new-session'])
    assert.deepEqual(calls[8], ['herdr', 'pane', 'zoom', '--off', '--pane', 'window:pane'])
    assert.deepEqual(calls[9], ['herdr', 'pane', 'close', 'window:pane'])
    assert.ok(fixture.calls.every((call) => call.signal instanceof AbortSignal))
    assert.equal(
      fixture.calls.some((call) => call.args.includes('add')),
      false,
    )
    await runtime.dispose()
  })
})

test('should return no comments given that tuicr creates no persisted session', async () => {
  //given
  await withHerdrEnvironment('1', async () => {
    const calls: Array<readonly string[]> = []
    const pi = Object.assign({} as ExtensionAPI, {
      exec: async (command: string, args: readonly string[]): Promise<ExecResult> => {
        calls.push([command, ...args])
        if (command === 'tuicr') return execResult('[]')
        if (args[1] === 'split') return execResult(JSON.stringify({ result: { pane: { pane_id: 'owned:pane' } } }))
        if (args[1] === 'wait-output') return execResult(JSON.stringify({ result: { matched_line: `${args[4]}:0` } }))
        return execResult()
      },
    })
    const runtime = makeRuntime(pi)

    //when
    const result = await runtime.runPromise(
      Effect.gen(function* () {
        const service = yield* Tuicr
        return yield* service.open('/repo', { type: 'working-tree' })
      }),
    )

    //then
    assert.equal(result.session, undefined)
    assert.deepEqual(result.comments, [])
    assert.equal(calls.filter((call) => call[0] === 'tuicr' && call[1] === 'review' && call[2] === 'list').length, 2)
    assert.deepEqual(calls.at(-2), ['herdr', 'pane', 'zoom', '--off', '--pane', 'owned:pane'])
    assert.deepEqual(calls.at(-1), ['herdr', 'pane', 'close', 'owned:pane'])
    await runtime.dispose()
  })
})

test('should report the tuicr exit status and close the owned pane given process exit', async () => {
  //given
  await withHerdrEnvironment('1', async () => {
    const calls: Array<readonly string[]> = []
    const pi = Object.assign({} as ExtensionAPI, {
      exec: async (command: string, args: readonly string[]): Promise<ExecResult> => {
        calls.push([command, ...args])
        if (command === 'tuicr') return execResult('[]')
        if (args[1] === 'split') return execResult(JSON.stringify({ result: { pane: { pane_id: 'owned:pane' } } }))
        if (args[1] === 'wait-output') return execResult(JSON.stringify({ result: { matched_line: `${args[4]}:7` } }))
        return execResult()
      },
    })
    const runtime = makeRuntime(pi, { discoveryAttempts: 1, discoveryDelayMs: 0 })

    //when
    const rejection = runtime.runPromise(
      Effect.gen(function* () {
        const service = yield* Tuicr
        return yield* service.open('/repo', { type: 'working-tree' })
      }),
    )

    //then
    await assert.rejects(rejection, /tuicr exited with status 7/)
    assert.deepEqual(calls.at(-1), ['herdr', 'pane', 'close', 'owned:pane'])
    await runtime.dispose()
  })
})

test('should refuse Herdr operations given a missing required environment', async () => {
  //given
  await withHerdrEnvironment(undefined, async () => {
    const fixture = makePi()
    const runtime = makeRuntime(fixture.pi, { discoveryAttempts: 1, discoveryDelayMs: 0 })

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

test('should close the pane given a launch failure after ownership starts', async () => {
  //given
  await withHerdrEnvironment('1', async () => {
    const calls: Array<readonly string[]> = []
    let split = false
    const pi = Object.assign({} as ExtensionAPI, {
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
    })
    const runtime = makeRuntime(pi, { discoveryAttempts: 1, discoveryDelayMs: 0 })

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

test('should pass cancellation to the process effect given an aborted operation', async () => {
  //given
  await withHerdrEnvironment('1', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const calls: Array<readonly string[]> = []
    const pi = Object.assign({} as ExtensionAPI, {
      exec: async (command: string, args: readonly string[], options: { signal: AbortSignal }): Promise<ExecResult> => {
        calls.push([command, ...args])
        if (command === 'tuicr') return execResult('[]')
        if (args[1] === 'split') return execResult(JSON.stringify({ result: { pane: { pane_id: 'owned:pane' } } }))
        if (args[1] !== 'wait-output') return execResult()
        receivedSignal = options.signal
        await new Promise<never>((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
        throw new Error('unreachable')
      },
    })
    const runtime = makeRuntime(pi, { discoveryAttempts: 1, discoveryDelayMs: 0 })
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
    assert.deepEqual(calls.at(-1), ['herdr', 'pane', 'close', 'owned:pane'])
    await runtime.dispose()
  })
})

test('should render collapsed and expanded comment results given both display states', () => {
  //given
  const registrations: Array<Parameters<ExtensionAPI['registerTool']>[0]> = []
  const pi = Object.assign({} as ExtensionAPI, {
    registerTool(options: Parameters<ExtensionAPI['registerTool']>[0]): void {
      registrations.push(options)
    },
    on(): void {},
  })
  tuicrExtension(pi)
  initTheme()
  const tool = registrations[0]
  assert.ok(tool)
  const theme = {
    fg: (_color: string, text: string): string => text,
    bold: (text: string): string => text,
  } as Theme
  const result: AgentToolResult<unknown> = {
    content: [{ type: 'text', text: 'src/extension.ts:10: fix this' }],
    details: {
      paneId: 'window:pane',
      sessionSlug: 'session',
      scope: { type: 'working-tree' },
      comments: [comment('one')],
    },
  }

  //when
  const states = renderCommentStates(tool, result, theme)

  //then
  assert.equal(tool.name, 'tuicr')
  assert.match(states.collapsed.join('\n'), /1 comment/)
  assert.match(states.expanded.join('\n'), /fix this/)
})
