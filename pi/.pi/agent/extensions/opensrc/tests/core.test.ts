import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { planClean, planFetch } from '../src/core/command-plan.ts'
import type { FileEntry, RawAstMatch, Source } from '../src/core/model.ts'
import { diffSources } from '../src/core/source-index.ts'
import { isContainedPath, normalizeAstMatches } from '../src/core/source-query.ts'
import { sourceMatchesSpec } from '../src/core/source-spec.ts'
import { normalizeSources, parseSourceIndex } from '../src/effects/source-index.ts'
import {
  buildTree,
  buildTreeInterruptible,
  grepFiles,
  grepFilesInterruptible,
  normalizeAstMatchesInterruptible,
  resolveContainedPath,
} from '../src/effects/source-query.ts'
import { parseSourceSpec } from '../src/effects/source-spec.ts'

const packageSource: Source = {
  type: 'npm',
  name: 'zod',
  version: '3.0.0',
  path: 'packages/npm/zod/3.0.0',
  fetchedAt: '2026-01-01T00:00:00Z',
}

function file(path: string, type: FileEntry['type'] = 'file'): FileEntry {
  return { path, type, size: 1 }
}

describe('opensrc core', () => {
  test('should parse the empty cache response given empty cache output', () => {
    //given
    const input = 'No sources cached yet.\n'

    //when
    const result = Effect.runSync(parseSourceIndex(input))

    //then
    expect(result).toEqual({ packages: [], repos: [] })
  })

  test('should normalize package and repository records and calculate source diffs given source records', () => {
    //given
    const index = {
      updatedAt: '2026-01-01T00:00:00Z',
      packages: [{ name: 'zod', version: '3.0.0', registry: 'npm', path: 'packages/zod', fetchedAt: '2026-01-01' }],
      repos: [{ name: 'github.com/a/b', version: 'main', path: 'repos/a/b', fetchedAt: '2026-01-02' }],
    }
    const before = Effect.runSync(normalizeSources(Effect.runSync(parseSourceIndex(JSON.stringify(index)))))
    const changed = [
      before.find((source) => source.type === 'repo') as Source,
      { ...packageSource, version: '4.0.0', path: 'packages/npm/zod/4.0.0' },
    ]

    //when
    const result = diffSources(before, changed)

    //then
    expect(result.added).toHaveLength(1)
    expect(result.removed).toHaveLength(1)
    expect(result.unchanged).toHaveLength(1)
  })

  test('should reject a source path that escapes the cache root given an outside path', () => {
    //given
    const input = JSON.stringify({
      packages: [{ name: 'zod', version: '3.0.0', path: '../zod', fetchedAt: '2026-01-01' }],
    })

    //when
    const result = (): readonly Source[] => Effect.runSync(normalizeSources(Effect.runSync(parseSourceIndex(input))))

    //then
    expect(result).toThrow('unsafe path')
  })

  test('should parse package and repository forms given supported source specs', () => {
    //given
    const inputs = [
      'zod',
      'npm:@scope/name@1.0.0',
      'pypi:requests==2.0.0',
      'crates:serde@1.0.0',
      'owner/repo@main',
      'gitlab:team/repo',
    ]

    //when
    const result = inputs.map((input) => parseSourceSpec(input))

    //then
    expect(result).toEqual([
      { type: 'npm', name: 'zod' },
      { type: 'npm', name: '@scope/name', version: '1.0.0' },
      { type: 'pypi', name: 'requests', version: '2.0.0' },
      { type: 'crates', name: 'serde', version: '1.0.0' },
      { type: 'repo', name: 'github.com/owner/repo', ref: 'main', repository: 'https://github.com/owner/repo' },
      { type: 'repo', name: 'gitlab.com/team/repo', repository: 'https://gitlab.com/team/repo' },
    ])
  })

  test('should match a source by name and version given a requested version', () => {
    //given
    const source = { ...packageSource }
    const spec = parseSourceSpec('npm:zod@3.0.0')

    //when
    const result = sourceMatchesSpec(source, spec)

    //then
    expect(result).toBe(true)
  })

  test('should plan deterministic clean commands given registry filters', () => {
    //given
    const options = { packages: true, repos: true, npm: true, pypi: true, crates: true }

    //when
    const result = planClean(options)

    //then
    expect(result).toEqual([
      { operation: 'clean', args: ['clean', '--packages', '--repos', '--npm'] },
      { operation: 'clean', args: ['clean', '--packages', '--repos', '--pypi'] },
      { operation: 'clean', args: ['clean', '--packages', '--repos', '--crates'] },
    ])
  })

  test('should plan fetch arguments with the working directory and quiet flag given fetch options', () => {
    //given
    const specs = ['zod']

    //when
    const result = planFetch(specs, '/tmp/project')

    //then
    expect(result.args).toEqual(['fetch', 'zod', '--cwd', '/tmp/project', '--quiet'])
  })

  test('should build a sorted tree with a depth limit and pattern given tree options', () => {
    //given
    const entries = [file('src/z.ts'), file('src/a.ts'), file('README.md'), file('src', 'directory')]

    //when
    const result = Effect.runSync(buildTree('zod', entries, { depth: 2, pattern: '**/*.ts' }))

    //then
    expect(result).toEqual({
      name: 'zod',
      type: 'directory',
      children: [
        {
          name: 'src',
          type: 'directory',
          children: [
            { name: 'a.ts', type: 'file' },
            { name: 'z.ts', type: 'file' },
          ],
        },
      ],
    })
  })

  test('should limit case-insensitive grep results and report line metadata given a query and result limit', () => {
    //given
    const sources = [{ source: 'zod', files: [{ path: 'src/a.ts', content: '  Parse  \nnone\nparse again' }] }]

    //when
    const result = Effect.runSync(grepFiles(sources, 'parse', { maxResults: 1 }))

    //then
    expect(result).toEqual([{ source: 'zod', file: 'src/a.ts', line: 1, column: 3, text: 'Parse' }])
  })

  test('should stop CPU-heavy queries given a cancellation signal', async () => {
    //given
    const controller = new AbortController()
    const entries = Array.from({ length: 1024 }, (_, index) => file(`src/${index}.ts`))
    const sources = [
      {
        source: 'zod',
        files: [{ path: 'src/index.ts', content: Array.from({ length: 10000 }, () => 'parse()').join('\n') }],
      },
    ]
    const tree = buildTreeInterruptible('zod', entries, {}, controller.signal)
    const grep = grepFilesInterruptible(sources, 'parse', {}, controller.signal)
    const normalized = normalizeAstMatchesInterruptible(
      'zod',
      Array.from({ length: 1024 }, () => ({
        source: 'zod',
        file: 'src/index.ts',
        text: 'parse()',
        start: { line: 0, column: 0, offset: 0 },
        end: { line: 0, column: 7, offset: 7 },
      })),
      controller.signal,
    )
    setTimeout(() => controller.abort(), 0)

    //when
    const results = await Promise.allSettled([
      Effect.runPromise(tree),
      Effect.runPromise(grep),
      Effect.runPromise(normalized),
    ])

    //then
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    expect(results.map((result) => (result.status === 'rejected' ? result.reason.message : ''))).toEqual([
      'Operation aborted',
      'Operation aborted',
      'Operation aborted',
    ])
  })

  test('should normalize AST positions and metavariables given AST match results', () => {
    //given
    const matches: RawAstMatch[] = [
      {
        source: 'zod',
        file: 'src/a.ts',
        text: 'parse(value)',
        start: { line: 0, column: 2, offset: 2 },
        end: { line: 0, column: 15, offset: 15 },
        metavars: { VALUE: 'value' },
      },
    ]

    //when
    const result = normalizeAstMatches('zod', matches)

    //then
    expect(result[0]).toEqual({
      source: 'zod',
      file: 'src/a.ts',
      text: 'parse(value)',
      start: { line: 1, column: 3, offset: 2 },
      end: { line: 1, column: 16, offset: 15 },
      line: 1,
      column: 3,
      metavars: { VALUE: 'value' },
    })
  })

  test('should enforce source-root containment given a source path', () => {
    //given
    const root = '/tmp/cache/source'

    //when
    const result = Effect.runSync(resolveContainedPath(root, 'src/index.ts'))

    //then
    expect(result).toBe('/tmp/cache/source/src/index.ts')
    expect(isContainedPath(root, result)).toBe(true)
    expect(() => Effect.runSync(resolveContainedPath(root, '../../secret'))).toThrow()
  })
})
