import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Effect } from 'effect'
import { ApplyPatchError, applyPatch, PatchMutationQueue, parsePatch } from '../src/patch.ts'

const unlockedMutationQueue = PatchMutationQueue.of({
  withLock: <A, E, R>(_path: string, action: Effect.Effect<A, E, R>): Effect.Effect<A, E | ApplyPatchError, R> =>
    action,
})

async function fixture(files: Record<string, string>, run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'pi-apply-patch-'))
  try {
    await Promise.all(Object.entries(files).map(([path, content]) => writeFile(join(directory, path), content)))
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('should add, update, move, and delete files given a patch with each operation', async () => {
  //given
  await fixture({ 'app.ts': 'const value = 1;\n', 'old.ts': 'old\n', 'remove.ts': 'remove\n' }, async (directory) => {
    const patchText = `*** Begin Patch
*** Add File: new.ts
+export const added = true;
*** Update File: app.ts
@@
-const value = 1;
+const value = 2;
*** Update File: old.ts
*** Move to: renamed.ts
@@
-old
+renamed
*** Delete File: remove.ts
*** End Patch`

    //when
    const execution = Effect.runPromise(
      Effect.gen(function* () {
        const operations = yield* parsePatch(patchText)
        return yield* applyPatch(directory, operations).pipe(
          Effect.provideService(PatchMutationQueue, unlockedMutationQueue),
        )
      }),
    )

    //then
    const files = await execution
    assert.deepEqual(
      files.map((file) => file.type),
      ['add', 'update', 'move', 'delete'],
    )
    assert.deepEqual(
      files.map(({ additions, deletions }) => [additions, deletions]),
      [
        [1, 0],
        [1, 1],
        [1, 1],
        [0, 1],
      ],
    )
    assert.equal(await readFile(join(directory, 'new.ts'), 'utf8'), 'export const added = true;\n')
    assert.equal(await readFile(join(directory, 'app.ts'), 'utf8'), 'const value = 2;\n')
    assert.equal(await readFile(join(directory, 'renamed.ts'), 'utf8'), 'renamed\n')
    await assert.rejects(readFile(join(directory, 'old.ts')))
    await assert.rejects(readFile(join(directory, 'remove.ts')))
  })
})

test('should preserve BOM and CRLF given an update to a CRLF file with a BOM', async () => {
  //given
  await fixture({ 'windows.txt': '\uFEFFfirst\r\nsecond\r\n' }, async (directory) => {
    const patchText = `*** Begin Patch
*** Update File: windows.txt
@@
 first
-second
+changed
*** End Patch`

    //when
    const execution = Effect.runPromise(
      Effect.gen(function* () {
        const operations = yield* parsePatch(patchText)
        return yield* applyPatch(directory, operations).pipe(
          Effect.provideService(PatchMutationQueue, unlockedMutationQueue),
        )
      }),
    )

    //then
    await execution
    assert.equal(await readFile(join(directory, 'windows.txt'), 'utf8'), '\uFEFFfirst\r\nchanged\r\n')
  })
})

test('should reject mismatched hunks given a patch that does not match the file', async () => {
  //given
  await fixture({ 'app.ts': 'const value = 1;\n' }, async (directory) => {
    const patchText = `*** Begin Patch
*** Update File: app.ts
@@
-const value = 3;
+const value = 4;
*** End Patch`

    //when
    const execution = Effect.runPromise(
      Effect.gen(function* () {
        const operations = yield* parsePatch(patchText)
        return yield* applyPatch(directory, operations).pipe(
          Effect.provideService(PatchMutationQueue, unlockedMutationQueue),
        )
      }),
    )

    //then
    await assert.rejects(execution, /hunk does not match/)
    assert.equal(await readFile(join(directory, 'app.ts'), 'utf8'), 'const value = 1;\n')
  })
})

test('should reject an empty patch given a patch with no operations', async () => {
  //given
  const patchText = '*** Begin Patch\n*** End Patch'

  //when
  const execution = Effect.runPromise(parsePatch(patchText))

  //then
  await assert.rejects(execution, /empty patch/)
})

test('should reject an escaping path given a patch path outside the project', async () => {
  //given
  await fixture({}, async (directory) => {
    const patchText = `*** Begin Patch
*** Add File: ../escape.txt
+x
*** End Patch`

    //when
    const execution = Effect.runPromise(
      Effect.gen(function* () {
        const operations = yield* parsePatch(patchText)
        return yield* applyPatch(directory, operations).pipe(
          Effect.provideService(PatchMutationQueue, unlockedMutationQueue),
        )
      }),
    )

    //then
    await assert.rejects(execution, /path escapes project/)
  })
})

test('should reject duplicate paths given a patch that targets one path twice', async () => {
  //given
  await fixture({ 'app.ts': 'one\n' }, async (directory) => {
    const patchText = `*** Begin Patch
*** Update File: app.ts
@@
-one
+two
*** Delete File: app.ts
*** End Patch`

    //when
    const execution = Effect.runPromise(
      Effect.gen(function* () {
        const operations = yield* parsePatch(patchText)
        return yield* applyPatch(directory, operations).pipe(
          Effect.provideService(PatchMutationQueue, unlockedMutationQueue),
        )
      }),
    )

    //then
    await assert.rejects(execution, /only one operation/)
    assert.equal(await readFile(join(directory, 'app.ts'), 'utf8'), 'one\n')
  })
})

test('should clean staged files given a commit that fails', async () => {
  //given
  await fixture({ blocker: 'not a directory\n' }, async (directory) => {
    const patchText = `*** Begin Patch
*** Add File: first.txt
+first
*** Add File: blocker/second.txt
+second
*** End Patch`

    //when
    const execution = Effect.runPromise(
      Effect.gen(function* () {
        const operations = yield* parsePatch(patchText)
        return yield* applyPatch(directory, operations).pipe(
          Effect.provideService(PatchMutationQueue, unlockedMutationQueue),
        )
      }),
    )

    //then
    await assert.rejects(
      execution,
      (error: unknown) => error instanceof ApplyPatchError && error.operation === 'filesystem',
    )
    assert.equal(await readFile(join(directory, 'blocker'), 'utf8'), 'not a directory\n')
    assert.deepEqual(await readdir(directory), ['blocker'])
  })
})

test('should classify a missing project root as a filesystem failure given a missing directory', async () => {
  //given
  const directory = await mkdtemp(join(tmpdir(), 'pi-apply-patch-'))
  await rm(directory, { recursive: true, force: true })
  const patchText = `*** Begin Patch
*** Add File: created.txt
+created
*** End Patch`

  try {
    //when
    const execution = Effect.runPromise(
      Effect.gen(function* () {
        const operations = yield* parsePatch(patchText)
        return yield* applyPatch(join(directory, 'missing'), operations).pipe(
          Effect.provideService(PatchMutationQueue, unlockedMutationQueue),
        )
      }),
    )

    //then
    await assert.rejects(
      execution,
      (error: unknown) => error instanceof ApplyPatchError && error.operation === 'filesystem',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
