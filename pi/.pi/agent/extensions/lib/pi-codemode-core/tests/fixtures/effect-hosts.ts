import { Effect } from 'effect'
import type { ProgramDefinition, ProgramFailure, ProgramHost } from '../../src/index.ts'
import { createProgramFailure, isProgramFailure } from '../../src/index.ts'

interface CodeModeFixture {
  readonly definition: ProgramDefinition
  readonly host: ProgramHost<never, ProgramFailure>
  readonly source: string
  readonly signals: AbortSignal[]
}

interface OpenSrcFixture {
  readonly definition: ProgramDefinition
  readonly host: ProgramHost<never, ProgramFailure>
  readonly source: string
  readonly sources: Map<string, string>
  readonly maxConcurrentMutations: () => number
}

interface TodoFixture {
  readonly definition: ProgramDefinition
  readonly host: ProgramHost<never, ProgramFailure>
  readonly source: string
  readonly transaction: TodoTransaction
}

interface TodoTransaction {
  readonly items: string[]
  readonly committed: () => boolean
  readonly rolledBack: () => boolean
  readonly add: (text: string) => number
  readonly commit: () => void
  readonly rollback: () => void
}

function createCodeModeFixture(): CodeModeFixture {
  const files = new Map([['notes.txt', 'initial']])
  const signals: AbortSignal[] = []
  const invoke = (
    method: string,
    args: readonly unknown[],
    signal: AbortSignal,
  ): Effect.Effect<unknown, ProgramFailure> => {
    signals.push(signal)
    return runFixtureAction(signal, method, () => {
      if (method === 'read') {
        requireFixtureString(method, args[0])
        return files.get(String(args[0])) ?? ''
      }
      if (method === 'bash') {
        requireFixtureString(method, args[0])
        return `executed:${String(args[0])}`
      }
      if (method === 'edit') {
        const path = requireFixtureString(method, args[0])
        const oldText = requireFixtureString(method, args[1])
        const newText = requireFixtureString(method, args[2])
        if (files.get(path) !== oldText) throw createFixtureFailure(method, 'The edit text does not match.')
        files.set(path, newText)
        return undefined
      }
      if (method === 'write') {
        const path = requireFixtureString(method, args[0])
        files.set(path, requireFixtureString(method, args[1]))
        return undefined
      }
      throw createFixtureFailure(method, 'The code-mode fixture method is not available.')
    })
  }
  return {
    definition: {
      apiName: 'CodeModeApi',
      programName: 'CodeModeProgram',
      declarations:
        'type CodeModeApi = { read(path: string): Promise<string>; bash(command: string): Promise<string>; edit(path: string, oldText: string, newText: string): Promise<void>; write(path: string, content: string): Promise<void> }',
      methods: [
        { name: 'read', kind: 'async' },
        { name: 'bash', kind: 'async' },
        { name: 'edit', kind: 'async' },
        { name: 'write', kind: 'async' },
      ],
      examples: [],
    },
    host: { invoke },
    source: [
      'export default async (api: CodeModeApi) => { await api.write("notes.txt", "updated"); await api.edit("notes.txt", "updated", "final"); return `',
      '$',
      '{await api.read("notes.txt")}:',
      '$',
      '{await api.bash("status")}` }',
    ].join(''),
    signals,
  }
}

function createOpenSrcFixture(): OpenSrcFixture {
  const sources = new Map([
    ['README.md', 'source readme'],
    ['old.ts', 'old source'],
  ])
  let activeMutations = 0
  let maximumMutations = 0
  const invoke = (
    method: string,
    args: readonly unknown[],
    signal: AbortSignal,
  ): Effect.Effect<unknown, ProgramFailure> =>
    runFixtureAction(signal, method, () => {
      if (method === 'read') {
        const name = requireFixtureString(method, args[0])
        return sources.get(name) ?? ''
      }
      if (method === 'remove') {
        const name = requireFixtureString(method, args[0])
        activeMutations += 1
        maximumMutations = Math.max(maximumMutations, activeMutations)
        try {
          sources.delete(name)
          return undefined
        } finally {
          activeMutations -= 1
        }
      }
      throw createFixtureFailure(method, 'The OpenSrc fixture method is not available.')
    })
  return {
    definition: {
      apiName: 'OpenSrcApi',
      programName: 'OpenSrcProgram',
      declarations:
        'type OpenSrcApi = { list(): string[]; read(name: string): Promise<string>; remove(name: string): Promise<void> }',
      methods: [
        { name: 'list', kind: 'sync' },
        { name: 'read', kind: 'async' },
        { name: 'remove', kind: 'async' },
      ],
      examples: [],
    },
    host: {
      invoke,
      invokeSync: (method) => {
        if (method !== 'list') throw createFixtureFailure(method, 'The OpenSrc fixture sync method is not available.')
        return [...sources.keys()]
      },
    },
    source: [
      'export default async (api: OpenSrcApi) => { const before = api.list(); await api.remove("old.ts"); return `',
      '$',
      '{before.length}:',
      '$',
      '{(await api.read("README.md")).length}:',
      '$',
      '{api.list().length}` }',
    ].join(''),
    sources,
    maxConcurrentMutations: () => maximumMutations,
  }
}

function createTodoFixture(): TodoFixture {
  const items: string[] = []
  let isCommitted = false
  let isRolledBack = false
  const transaction: TodoTransaction = {
    items,
    committed: () => isCommitted,
    rolledBack: () => isRolledBack,
    add: (text) => {
      items.push(text)
      return items.length
    },
    commit: () => {
      isCommitted = true
    },
    rollback: () => {
      isRolledBack = true
      items.length = 0
    },
  }
  return {
    definition: {
      apiName: 'TodoApi',
      programName: 'TodoProgram',
      declarations: 'type TodoApi = { count(): number; add(text: string): Promise<number> }',
      methods: [
        { name: 'count', kind: 'sync' },
        { name: 'add', kind: 'async' },
      ],
      examples: [],
    },
    host: {
      invoke: (method, args, signal) =>
        runFixtureAction(signal, method, () => {
          if (method !== 'add') throw createFixtureFailure(method, 'The todo fixture async method is not available.')
          return transaction.add(requireFixtureString(method, args[0]))
        }),
      invokeSync: (method) => {
        if (method !== 'count') throw createFixtureFailure(method, 'The todo fixture sync method is not available.')
        return items.length
      },
    },
    source: 'export default async (api: TodoApi) => api.count() + await api.add("task")',
    transaction,
  }
}

function runFixtureAction<T>(signal: AbortSignal, method: string, action: () => T): Effect.Effect<T, ProgramFailure> {
  return Effect.callback((resume) => {
    const abort = (): void =>
      resume(
        Effect.fail(
          createProgramFailure({
            _tag: 'cancellation',
            operation: method,
            message: 'The fixture host call was cancelled.',
          }),
        ),
      )
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    const close = (): void => signal.removeEventListener('abort', abort)
    try {
      const value = action()
      close()
      resume(Effect.succeed(value))
    } catch (cause) {
      close()
      resume(Effect.fail(isProgramFailure(cause) ? cause : createFixtureFailure(method, String(cause))))
    }
    return Effect.sync(close)
  })
}

function requireFixtureString(method: string, value: unknown): string {
  if (typeof value !== 'string') throw createFixtureFailure(method, 'The fixture argument must be a string.')
  return value
}

function createFixtureFailure(operation: string, message: string): ProgramFailure {
  return createProgramFailure({ _tag: 'validation', operation, message })
}

export {
  type CodeModeFixture,
  createCodeModeFixture,
  createOpenSrcFixture,
  createTodoFixture,
  type OpenSrcFixture,
  type TodoFixture,
  type TodoTransaction,
}
