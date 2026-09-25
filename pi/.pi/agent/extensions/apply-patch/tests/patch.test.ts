import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { applyPatch, parsePatch } from '../src/patch.ts'

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
  await fixture({ 'app.ts': 'const value = 1;\n', 'old.ts': 'old\n', 'remove.ts': 'remove\n' }, async (directory) => {
    const files = await applyPatch(
      directory,
      parsePatch(`*** Begin Patch
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
*** End Patch`),
    )

    assert.deepEqual(
      files.map((file) => file.type),
      ['add', 'update', 'move', 'delete'],
    )
    assert.equal(await readFile(join(directory, 'new.ts'), 'utf8'), 'export const added = true;\n')
    assert.equal(await readFile(join(directory, 'app.ts'), 'utf8'), 'const value = 2;\n')
    assert.equal(await readFile(join(directory, 'renamed.ts'), 'utf8'), 'renamed\n')
    await assert.rejects(readFile(join(directory, 'old.ts')))
    await assert.rejects(readFile(join(directory, 'remove.ts')))
  })
})

test('should preserve BOM and CRLF given an update to a CRLF file with a BOM', async () => {
  await fixture({ 'windows.txt': '\uFEFFfirst\r\nsecond\r\n' }, async (directory) => {
    await applyPatch(
      directory,
      parsePatch(`*** Begin Patch
*** Update File: windows.txt
@@
 first
-second
+changed
*** End Patch`),
    )
    assert.equal(await readFile(join(directory, 'windows.txt'), 'utf8'), '\uFEFFfirst\r\nchanged\r\n')
  })
})

test('should reject mismatched hunks given a patch that does not match the file', async () => {
  await fixture({ 'app.ts': 'const value = 1;\n' }, async (directory) => {
    await assert.rejects(
      applyPatch(
        directory,
        parsePatch(`*** Begin Patch
*** Update File: app.ts
@@
-const value = 3;
+const value = 4;
*** End Patch`),
      ),
      /hunk does not match/,
    )
    assert.equal(await readFile(join(directory, 'app.ts'), 'utf8'), 'const value = 1;\n')
  })
})

test('should reject invalid and escaping paths given a patch with unsafe paths', async () => {
  assert.throws(() => parsePatch('*** Begin Patch\n*** End Patch'), /empty patch/)
  await fixture({}, async (directory) => {
    await assert.rejects(
      applyPatch(
        directory,
        parsePatch(`*** Begin Patch
*** Add File: ../escape.txt
+x
*** End Patch`),
      ),
      /path escapes project/,
    )
  })
})

test('should reject duplicate paths before mutation given a patch with repeated paths', async () => {
  await fixture({ 'app.ts': 'one\n' }, async (directory) => {
    await assert.rejects(
      applyPatch(
        directory,
        parsePatch(`*** Begin Patch
*** Update File: app.ts
@@
-one
+two
*** Delete File: app.ts
*** End Patch`),
      ),
      /only one operation/,
    )
    assert.equal(await readFile(join(directory, 'app.ts'), 'utf8'), 'one\n')
  })
})
