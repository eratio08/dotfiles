import { describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { resolveOpensrcConfig } from '../src/effects/opensrc-cli.ts'
import { parseSourceSpec } from '../src/effects/source-spec.ts'

const execFileAsync = promisify(execFile)
const opensrcBin = resolveOpensrcConfig().bin

describe('opensrc CLI isolation', () => {
  test('reports the verified CLI version from the local installation', async () => {
    //given
    const home = await mkdtemp(join(tmpdir(), 'opensrc-cli-version-'))

    //when
    const result = await execFileAsync(opensrcBin, ['--version'], {
      env: { ...process.env, OPENSRC_HOME: home, OPENSRC_DIR: join(home, 'ignored') },
    })

    //then
    expect(result.stdout.trim()).toBe('opensrc 0.7.3')
    await rm(home, { recursive: true, force: true })
  })

  test('resolves repository specs without network access', () => {
    //given
    const input = 'https://github.com/owner/repo/tree/main/src'

    //when
    const result = parseSourceSpec(input)

    //then
    expect(result).toEqual({
      type: 'repo',
      name: 'github.com/owner/repo',
      ref: 'main/src',
      repository: 'https://github.com/owner/repo',
    })
  })

  test('uses an empty isolated OPENSRC_HOME without touching OPENSRC_DIR', async () => {
    //given
    const home = await mkdtemp(join(tmpdir(), 'opensrc-cli-list-'))
    const ignored = await mkdtemp(join(tmpdir(), 'opensrc-cli-ignored-'))

    //when
    const result = await execFileAsync(opensrcBin, ['list', '--json'], {
      env: { ...process.env, OPENSRC_HOME: home, OPENSRC_DIR: ignored },
    })

    //then
    expect(result.stdout).toContain('No sources cached yet.')
    expect(await readdir(ignored)).toEqual([])
    await rm(home, { recursive: true, force: true })
    await rm(ignored, { recursive: true, force: true })
  })
})
