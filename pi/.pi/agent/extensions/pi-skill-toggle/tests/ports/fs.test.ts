import { describe, test } from 'bun:test'
import { strict as assert } from 'node:assert'
import { chmod, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Cause, Effect, Exit } from 'effect'
import { FileSystem, FileSystemError, FileSystemLive } from '../../src/ports/fs.ts'

function runLive<A, E>(effect: Effect.Effect<A, E, FileSystem>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(FileSystemLive)))
}

describe('FileSystemLive', () => {
  test('reads, writes atomically, preserves modes, and lists files', async () => {
    //given
    const root = await mkdtemp(join(tmpdir(), 'pi-skill-toggle-fs-test-'))
    const file = join(root, 'skill.md')
    await writeFile(file, 'before')
    await chmod(file, 0o640)

    try {
      //when
      const observed = await runLive(
        Effect.gen(function* () {
          const fs = yield* FileSystem
          const before = yield* fs.readFile(file)
          const missing = yield* fs.access(join(root, 'missing.md'))
          yield* fs.writeFileAtomic(file, 'after')
          const after = yield* fs.readFile(file)
          const stats = yield* fs.stat(file)
          const entries = yield* fs.readdir(root)
          const canonical = yield* fs.realpath(file)
          return { before, missing, after, mode: stats.mode, entries, canonical }
        }),
      )

      //then
      assert.equal(observed.before, 'before')
      assert.equal(observed.missing, false)
      assert.equal(observed.after, 'after')
      assert.equal(observed.mode & 0o777, 0o640)
      assert.deepEqual(
        observed.entries.map((entry) => entry.name),
        ['skill.md'],
      )
      assert.equal(observed.canonical.endsWith('/skill.md'), true)
      assert.equal(await readFile(file, 'utf8'), 'after')
      assert.deepEqual(await readdir(root), ['skill.md'])
      assert.equal((await stat(file)).mode & 0o777, 0o640)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('returns a typed failure for missing reads', async () => {
    //given
    const root = await mkdtemp(join(tmpdir(), 'pi-skill-toggle-fs-error-test-'))
    const missing = join(root, 'missing.md')

    try {
      //when
      const exit = await runLive(
        Effect.exit(
          Effect.gen(function* () {
            const fs = yield* FileSystem
            return yield* fs.readFile(missing)
          }),
        ),
      )

      //then
      assert.equal(Exit.isFailure(exit), true)
      if (Exit.isFailure(exit)) {
        const failure = exit.cause.reasons.find(Cause.isFailReason)
        assert.ok(failure)
        if (failure) assert.ok(failure.error instanceof FileSystemError)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
