import * as BunTest from 'bun:test'
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs/promises'
import * as Os from 'node:os'
import * as Path from 'node:path'
import * as StreamConsumers from 'node:stream/consumers'
import type * as Pi from '@earendil-works/pi-coding-agent'
import type * as Tui from '@earendil-works/pi-tui'
import piOmmExtension from '../index.ts'

type OmmAddTasksTool = {
  readonly name: string
  readonly execute: (toolCallId: string, params: { summaries: string[] }, signal?: AbortSignal) => Promise<unknown>
}

type OmmListTaskTool = {
  readonly name: string
  readonly execute: (toolCallId: string, params: { limit?: number }, signal?: AbortSignal) => Promise<unknown>
  readonly renderResult: (
    result: { content: Array<{ type: string; text?: string }>; details?: unknown },
    options: { expanded: boolean; isPartial: boolean },
    theme: { fg: (role: string, text: string) => string },
    context: {
      isError: boolean
      lastComponent?: Tui.Text
      keyHint: (keybinding: string, description: string) => string
    },
  ) => Tui.Text
}

function registerOmmTaskTool(exec: Pi.ExtensionAPI['exec'], name: string): unknown {
  const registeredTools = new Map<string, unknown>()
  const pi = {
    exec,
    registerTool(tool: { name: string }): void {
      registeredTools.set(tool.name, tool)
    },
  } as unknown as Pi.ExtensionAPI

  piOmmExtension(pi)

  const tool = registeredTools.get(name)
  if (tool === undefined) {
    throw new Error(`OMM tool was not registered: ${name}`)
  }

  return tool
}

async function expectInvalidOmmSummary(summary: string, message: string): Promise<void> {
  const calls: string[] = []
  const exec: Pi.ExtensionAPI['exec'] = async (command: Parameters<Pi.ExtensionAPI['exec']>[0]) => {
    calls.push(command)
    return { stdout: '', stderr: '', code: 0, killed: false }
  }
  const tool = registerOmmTaskTool(exec, 'omm_add_tasks') as OmmAddTasksTool

  await BunTest.expect(tool.execute('test-call', { summaries: [summary] })).rejects.toThrow(message)
  BunTest.expect(calls).toEqual([])
}

async function withFakeOmmExecutable<T>(
  action: (capturePath: string, argsPath: string) => Promise<T>,
  options: { exitCode?: number; stderr?: string; script?: string } = {},
): Promise<T> {
  const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'pi-omm-fake-'))
  const executablePath = Path.join(directory, 'omm')
  const capturePath = Path.join(directory, 'captured-input.txt')
  const argsPath = Path.join(directory, 'captured-args.txt')
  const originalPath = process.env.PATH
  const originalCapture = process.env.PI_OMM_TEST_CAPTURE
  const originalArgs = process.env.PI_OMM_TEST_ARGS
  const originalExitCode = process.env.PI_OMM_TEST_EXIT_CODE
  const originalStderr = process.env.PI_OMM_TEST_STDERR
  const script =
    options.script ??
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$@" > "$PI_OMM_TEST_ARGS"',
      'cat > "$PI_OMM_TEST_CAPTURE"',
      'if [ -n "$PI_OMM_TEST_STDERR" ]; then',
      '  printf \'%s\\n\' "$PI_OMM_TEST_STDERR" >&2',
      'fi',
      'exit "$PI_OMM_TEST_EXIT_CODE"',
      '',
    ].join('\n')

  await Fs.writeFile(executablePath, script, { mode: 0o755 })
  process.env.PATH = `${directory}${Path.delimiter}${originalPath ?? ''}`
  process.env.PI_OMM_TEST_CAPTURE = capturePath
  process.env.PI_OMM_TEST_ARGS = argsPath
  process.env.PI_OMM_TEST_EXIT_CODE = String(options.exitCode ?? 0)
  process.env.PI_OMM_TEST_STDERR = options.stderr ?? ''

  try {
    return await action(capturePath, argsPath)
  } finally {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    if (originalCapture === undefined) delete process.env.PI_OMM_TEST_CAPTURE
    else process.env.PI_OMM_TEST_CAPTURE = originalCapture
    if (originalArgs === undefined) delete process.env.PI_OMM_TEST_ARGS
    else process.env.PI_OMM_TEST_ARGS = originalArgs
    if (originalExitCode === undefined) delete process.env.PI_OMM_TEST_EXIT_CODE
    else process.env.PI_OMM_TEST_EXIT_CODE = originalExitCode
    if (originalStderr === undefined) delete process.env.PI_OMM_TEST_STDERR
    else process.env.PI_OMM_TEST_STDERR = originalStderr
    await Fs.rm(directory, { recursive: true, force: true })
  }
}

async function runOmmWithHome(args: string[], home: string): Promise<Pi.ExecResult> {
  const child = ChildProcess.spawn('omm', args, {
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: Path.join(home, '.config'),
      XDG_DATA_HOME: Path.join(home, '.local', 'share'),
    },
    stdio: 'pipe',
  })
  const exitCode = new Promise<number | null>((resolve, reject) => {
    child.once('error', (error: Error) => reject(error))
    child.once('close', (code: number | null) => resolve(code))
  })
  const [stdout, stderr, code] = await Promise.all([
    StreamConsumers.text(child.stdout),
    StreamConsumers.text(child.stderr),
    exitCode,
  ])

  return { stdout, stderr, code: code ?? -1, killed: false }
}

BunTest.test('should add one trimmed task given a valid summary', async () => {
  //given
  const calls: Array<{ command: string; args: string[]; signal?: AbortSignal }> = []
  const exec: Pi.ExtensionAPI['exec'] = async (
    command: Parameters<Pi.ExtensionAPI['exec']>[0],
    args: Parameters<Pi.ExtensionAPI['exec']>[1],
    options: Parameters<Pi.ExtensionAPI['exec']>[2],
  ) => {
    calls.push({ command, args: [...args], signal: options?.signal })
    return { stdout: '', stderr: '', code: 0, killed: false }
  }
  const tool = registerOmmTaskTool(exec, 'omm_add_tasks') as OmmAddTasksTool

  //when
  const result = await tool.execute('test-call', { summaries: ['  work: finish report  '] })

  //then
  BunTest.expect(calls).toEqual([{ command: 'omm', args: ['work: finish report'], signal: undefined }])
  BunTest.expect(result).toMatchObject({
    content: [{ type: 'text', text: 'Added task: work: finish report' }],
    details: { summaries: ['work: finish report'] },
  })
})

BunTest.test('should reject an empty summary given whitespace-only input', async () => {
  //given
  const summary = '  \t '

  //when
  const result = expectInvalidOmmSummary(summary, 'OMM task summary is invalid: summary is empty')

  //then
  await result
})

BunTest.test('should reject an oversized summary given more than 300 UTF-8 bytes', async () => {
  //given
  const summary = 'é'.repeat(151)

  //when
  const result = expectInvalidOmmSummary(summary, 'OMM task summary is invalid: summary exceeds 300 bytes')

  //then
  await result
})

BunTest.test('should reject an empty prefix given a colon at the start', async () => {
  //given
  const summary = ': task'

  //when
  const result = expectInvalidOmmSummary(summary, 'OMM task summary is invalid: prefix is empty')

  //then
  await result
})

BunTest.test('should reject empty task text given a prefix without a body', async () => {
  //given
  const summary = 'work:   '

  //when
  const result = expectInvalidOmmSummary(summary, 'OMM task summary is invalid: task text is empty')

  //then
  await result
})

BunTest.test('should reject a line break given a multiline summary', async () => {
  //given
  const summary = 'work: first line\nsecond line'

  //when
  const result = expectInvalidOmmSummary(summary, 'OMM task summary is invalid: line breaks are not supported')

  //then
  await result
})

BunTest.test('should report the OMM error given a failed single-task command', async () => {
  //given
  const exec: Pi.ExtensionAPI['exec'] = async () => ({
    stdout: '',
    stderr: 'task capacity reached',
    code: 1,
    killed: false,
  })
  const tool = registerOmmTaskTool(exec, 'omm_add_tasks') as OmmAddTasksTool

  //when
  const result = tool.execute('test-call', { summaries: ['work: add task'] })

  //then
  await BunTest.expect(result).rejects.toThrow('OMM command failed: task capacity reached')
})

BunTest.test('should report a missing executable given an OMM lookup failure', async () => {
  //given
  const exec: Pi.ExtensionAPI['exec'] = async () => {
    throw new Error('spawn omm ENOENT')
  }
  const tool = registerOmmTaskTool(exec, 'omm_add_tasks') as OmmAddTasksTool

  //when
  const result = tool.execute('test-call', { summaries: ['work: add task'] })

  //then
  await BunTest.expect(result).rejects.toThrow('OMM command failed: spawn omm ENOENT')
})

BunTest.test('should stop single-task creation given an aborted process', async () => {
  //given
  const controller = new AbortController()
  let receivedSignal: AbortSignal | undefined
  const exec: Pi.ExtensionAPI['exec'] = async (
    _command: Parameters<Pi.ExtensionAPI['exec']>[0],
    _args: Parameters<Pi.ExtensionAPI['exec']>[1],
    options: Parameters<Pi.ExtensionAPI['exec']>[2],
  ) => {
    receivedSignal = options?.signal
    controller.abort()
    return { stdout: '', stderr: '', code: 1, killed: true }
  }
  const tool = registerOmmTaskTool(exec, 'omm_add_tasks') as OmmAddTasksTool

  //when
  const result = tool.execute('test-call', { summaries: ['work: add task'] }, controller.signal)

  //then
  await BunTest.expect(result).rejects.toThrow('OMM command was cancelled')
  BunTest.expect(receivedSignal).toBe(controller.signal)
})

BunTest.test('should add one task to an isolated database given a real OMM CLI', async () => {
  //given
  const home = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'pi-omm-test-'))
  const exec: Pi.ExtensionAPI['exec'] = async (
    _command: Parameters<Pi.ExtensionAPI['exec']>[0],
    args: Parameters<Pi.ExtensionAPI['exec']>[1],
  ) => runOmmWithHome(args, home)
  const tool = registerOmmTaskTool(exec, 'omm_add_tasks') as OmmAddTasksTool

  try {
    //when
    const result = await tool.execute('test-call', { summaries: ['work: isolated task'] })

    //then
    const tasks = await runOmmWithHome(['tasks'], home)
    BunTest.expect(result).toMatchObject({ details: { summaries: ['work: isolated task'] } })
    BunTest.expect(tasks).toMatchObject({ code: 0, stdout: 'work: isolated task\n' })
  } finally {
    await Fs.rm(home, { recursive: true, force: true })
  }
})

BunTest.test('should list active summaries in task order given the default limit', async () => {
  //given
  const calls: Array<{ command: string; args: string[] }> = []
  const exec: Pi.ExtensionAPI['exec'] = async (
    command: Parameters<Pi.ExtensionAPI['exec']>[0],
    args: Parameters<Pi.ExtensionAPI['exec']>[1],
  ) => {
    calls.push({ command, args: [...args] })
    return { stdout: 'top task\nnext task\n', stderr: '', code: 0, killed: false }
  }
  const tool = registerOmmTaskTool(exec, 'omm_list_tasks') as OmmListTaskTool

  //when
  const result = await tool.execute('test-call', {})

  //then
  BunTest.expect(calls).toEqual([{ command: 'omm', args: ['tasks', '--num', '20'] }])
  BunTest.expect(result).toMatchObject({
    content: [{ type: 'text', text: 'top task\nnext task' }],
    details: { summaries: ['top task', 'next task'], truncated: false },
  })
})

BunTest.test('should apply an explicit limit given the maximum supported value', async () => {
  //given
  const calls: string[][] = []
  const exec: Pi.ExtensionAPI['exec'] = async (
    _command: Parameters<Pi.ExtensionAPI['exec']>[0],
    args: Parameters<Pi.ExtensionAPI['exec']>[1],
  ) => {
    calls.push([...args])
    return { stdout: 'top task\n', stderr: '', code: 0, killed: false }
  }
  const tool = registerOmmTaskTool(exec, 'omm_list_tasks') as OmmListTaskTool

  //when
  await tool.execute('test-call', { limit: 255 })

  //then
  BunTest.expect(calls).toEqual([['tasks', '--num', '255']])
})

BunTest.test('should return an empty result given no active tasks', async () => {
  //given
  const exec: Pi.ExtensionAPI['exec'] = async () => ({
    stdout: '',
    stderr: '',
    code: 0,
    killed: false,
  })
  const tool = registerOmmTaskTool(exec, 'omm_list_tasks') as OmmListTaskTool

  //when
  const result = await tool.execute('test-call', {})

  //then
  BunTest.expect(result).toMatchObject({ content: [], details: { summaries: [], truncated: false } })
})

BunTest.test('should save and render a long task list given truncated output', async () => {
  //given
  const summaries = Array.from({ length: 255 }, (_, index) => `${index + 1}: ${'x'.repeat(280)}`)
  const exec: Pi.ExtensionAPI['exec'] = async () => ({
    stdout: `${summaries.join('\n')}\n`,
    stderr: '',
    code: 0,
    killed: false,
  })
  const tool = registerOmmTaskTool(exec, 'omm_list_tasks') as OmmListTaskTool

  //when
  const result = await tool.execute('test-call', { limit: 255 })

  //then
  const output = result as {
    content: Array<{ type: string; text?: string }>
    details: { summaries: string[]; truncated: boolean; savedOutputPath?: string }
  }
  BunTest.expect(output.details.truncated).toBe(true)
  BunTest.expect(output.content[0]?.text).toContain('Full output saved to:')
  BunTest.expect(output.details.summaries).toHaveLength(255)
  const savedOutputPath = output.details.savedOutputPath
  if (savedOutputPath === undefined) {
    throw new Error('Truncated OMM task output did not include a file path')
  }

  try {
    BunTest.expect(await Fs.readFile(savedOutputPath, 'utf8')).toBe(summaries.join('\n'))
    const theme = { fg: (_role: string, text: string): string => text }
    const context = {
      isError: false,
      keyHint: (_keybinding: string, description: string): string => description,
    }
    const compact = tool
      .renderResult(output, { expanded: false, isPartial: false }, theme, context)
      .render(80)
      .join('\n')
    const expanded = tool
      .renderResult(output, { expanded: true, isPartial: false }, theme, context)
      .render(80)
      .join('\n')
    BunTest.expect(compact).toContain('255 active task summaries')
    BunTest.expect(expanded.includes('1:')).toBe(true)
    BunTest.expect(expanded.includes('255:')).toBe(true)
  } finally {
    await Fs.rm(Path.dirname(savedOutputPath), { recursive: true, force: true })
  }
})

BunTest.test('should list active tasks from an isolated database given a real OMM CLI', async () => {
  //given
  const home = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'pi-omm-list-test-'))
  const exec: Pi.ExtensionAPI['exec'] = async (
    _command: Parameters<Pi.ExtensionAPI['exec']>[0],
    args: Parameters<Pi.ExtensionAPI['exec']>[1],
  ) => runOmmWithHome(args, home)
  const tool = registerOmmTaskTool(exec, 'omm_list_tasks') as OmmListTaskTool

  try {
    await runOmmWithHome(['work: first task'], home)
    await runOmmWithHome(['work: second task'], home)

    //when
    const result = await tool.execute('test-call', {})

    //then
    BunTest.expect(result).toMatchObject({
      content: [{ type: 'text', text: 'work: second task\nwork: first task' }],
      details: { summaries: ['work: second task', 'work: first task'], truncated: false },
    })
  } finally {
    await Fs.rm(home, { recursive: true, force: true })
  }
})

BunTest.test('should import summaries in order and keep duplicates given a valid batch', async () => {
  //given
  const summaries = ['work: first', 'work: second', 'work: first']

  //when
  await withFakeOmmExecutable(async (capturePath, argsPath) => {
    const tool = registerOmmTaskTool(async () => {
      throw new Error('OMM import must use standard input')
    }, 'omm_add_tasks') as OmmAddTasksTool
    const result = await tool.execute('test-call', { summaries })

    //then
    BunTest.expect(await Fs.readFile(argsPath, 'utf8')).toBe('import\n')
    BunTest.expect(await Fs.readFile(capturePath, 'utf8')).toBe(`${summaries.join('\n')}\n`)
    BunTest.expect(result).toMatchObject({
      content: [{ type: 'text', text: 'Added 3 OMM tasks.' }],
      details: { summaries },
    })
  })
})

BunTest.test('should reject a whole batch before import given one invalid summary', async () => {
  //given
  const summaries = ['work: valid', 'work: first line\nsecond line']

  //when
  const result = withFakeOmmExecutable(async (capturePath, argsPath) => {
    const tool = registerOmmTaskTool(
      async () => ({
        stdout: '',
        stderr: '',
        code: 0,
        killed: false,
      }),
      'omm_add_tasks',
    ) as OmmAddTasksTool
    await BunTest.expect(tool.execute('test-call', { summaries })).rejects.toThrow(
      'OMM task summary is invalid: line breaks are not supported',
    )
    await BunTest.expect(Fs.access(argsPath)).rejects.toThrow()
    await BunTest.expect(Fs.access(capturePath)).rejects.toThrow()
  })

  //then
  await result
})

BunTest.test('should reject an empty batch before import given no summaries', async () => {
  //given
  const summaries: string[] = []

  //when
  const result = withFakeOmmExecutable(async (capturePath, argsPath) => {
    const tool = registerOmmTaskTool(
      async () => ({
        stdout: '',
        stderr: '',
        code: 0,
        killed: false,
      }),
      'omm_add_tasks',
    ) as OmmAddTasksTool
    await BunTest.expect(tool.execute('test-call', { summaries })).rejects.toThrow(
      'OMM task batch is invalid: batch is empty',
    )
    await BunTest.expect(Fs.access(argsPath)).rejects.toThrow()
    await BunTest.expect(Fs.access(capturePath)).rejects.toThrow()
  })

  //then
  await result
})

BunTest.test('should reject batches over 1,000 summaries before import given an oversized batch', async () => {
  //given
  const summaries = Array.from({ length: 1001 }, (_, index) => `task ${index}`)

  //when
  const result = withFakeOmmExecutable(async (capturePath, argsPath) => {
    const tool = registerOmmTaskTool(
      async () => ({
        stdout: '',
        stderr: '',
        code: 0,
        killed: false,
      }),
      'omm_add_tasks',
    ) as OmmAddTasksTool
    await BunTest.expect(tool.execute('test-call', { summaries })).rejects.toThrow(
      'OMM task batch is invalid: batch exceeds 1000 summaries',
    )
    await BunTest.expect(Fs.access(argsPath)).rejects.toThrow()
    await BunTest.expect(Fs.access(capturePath)).rejects.toThrow()
  })

  //then
  await result
})

BunTest.test('should import 1,000 summaries given the maximum batch size', async () => {
  //given
  const summaries = Array.from({ length: 1000 }, (_, index) => `task ${index}`)

  //when
  await withFakeOmmExecutable(async (capturePath) => {
    const tool = registerOmmTaskTool(async () => {
      throw new Error('OMM import must use standard input')
    }, 'omm_add_tasks') as OmmAddTasksTool
    const result = await tool.execute('test-call', { summaries })

    //then
    const imported = (await Fs.readFile(capturePath, 'utf8')).trimEnd().split('\n')
    BunTest.expect(imported).toEqual(summaries)
    BunTest.expect(result).toMatchObject({
      content: [{ type: 'text', text: 'Added 1000 OMM tasks.' }],
      details: { summaries },
    })
  })
})

BunTest.test('should report OMM capacity errors given a rejected batch', async () => {
  //given
  const summaries = ['work: first', 'work: second']

  //when
  const result = withFakeOmmExecutable(
    async (capturePath, argsPath) => {
      const tool = registerOmmTaskTool(
        async () => ({
          stdout: '',
          stderr: '',
          code: 0,
          killed: false,
        }),
        'omm_add_tasks',
      ) as OmmAddTasksTool
      await BunTest.expect(tool.execute('test-call', { summaries })).rejects.toThrow(
        'OMM command failed: active-task capacity reached',
      )
      BunTest.expect(await Fs.readFile(argsPath, 'utf8')).toBe('import\n')
      BunTest.expect(await Fs.readFile(capturePath, 'utf8')).toBe(`${summaries.join('\n')}\n`)
    },
    { exitCode: 1, stderr: 'active-task capacity reached' },
  )

  //then
  await result
})

BunTest.test('should report a missing batch executable given an OMM lookup failure', async () => {
  //given
  const summaries = ['work: first', 'work: second']

  //when
  const result = withFakeOmmExecutable(async (capturePath) => {
    await Fs.rm(Path.join(Path.dirname(capturePath), 'omm'))
    process.env.PATH = Path.dirname(capturePath)
    const tool = registerOmmTaskTool(
      async () => ({
        stdout: '',
        stderr: '',
        code: 0,
        killed: false,
      }),
      'omm_add_tasks',
    ) as OmmAddTasksTool
    await BunTest.expect(tool.execute('test-call', { summaries })).rejects.toThrow(/OMM command failed:.*omm/)
  })

  //then
  await result
})

BunTest.test('should cancel a running batch process given an aborted signal', async () => {
  //given
  const script = ['#!/bin/sh', 'cat > /dev/null', 'printf started > "$PI_OMM_TEST_CAPTURE"', 'exec sleep 5', ''].join(
    '\n',
  )
  const summaries = ['work: first', 'work: second']

  //when
  const result = withFakeOmmExecutable(
    async (capturePath) => {
      const controller = new AbortController()
      const tool = registerOmmTaskTool(
        async () => ({
          stdout: '',
          stderr: '',
          code: 0,
          killed: false,
        }),
        'omm_add_tasks',
      ) as OmmAddTasksTool
      const operation = tool.execute('test-call', { summaries }, controller.signal)
      let started = false

      for (let attempt = 0; attempt < 50 && !started; attempt++) {
        try {
          await Fs.access(capturePath)
          started = true
        } catch {
          await new Promise<void>((resolve) => setTimeout(resolve, 10))
        }
      }

      controller.abort()
      await BunTest.expect(operation).rejects.toThrow('OMM command was cancelled')
      BunTest.expect(started).toBe(true)
    },
    { script },
  )

  //then
  await result
})

BunTest.test('should import a batch into an isolated database given a real OMM CLI', async () => {
  //given
  const home = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'pi-omm-import-test-'))
  const originalHome = process.env.HOME
  const originalConfigHome = process.env.XDG_CONFIG_HOME
  const originalDataHome = process.env.XDG_DATA_HOME
  process.env.HOME = home
  process.env.XDG_CONFIG_HOME = Path.join(home, '.config')
  process.env.XDG_DATA_HOME = Path.join(home, '.local', 'share')
  const summaries = ['work: first', 'work: second', 'work: first']
  const tool = registerOmmTaskTool(async () => {
    throw new Error('OMM import must use standard input')
  }, 'omm_add_tasks') as OmmAddTasksTool

  try {
    //when
    const result = await tool.execute('test-call', { summaries })

    //then
    const tasks = await runOmmWithHome(['tasks', '--num', '20'], home)
    BunTest.expect(result).toMatchObject({ details: { summaries } })
    BunTest.expect(tasks).toMatchObject({
      code: 0,
      stdout: 'work: first\nwork: second\nwork: first\n',
    })
  } finally {
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = originalConfigHome
    if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = originalDataHome
    await Fs.rm(home, { recursive: true, force: true })
  }
})
