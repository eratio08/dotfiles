import { constants } from 'node:fs'
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExecResult, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { Value } from 'typebox/value'

type TargetScripts = { lint?: unknown; typecheck?: unknown }

type CheckStatus = 'passed' | 'findings' | 'failed' | 'plugin-load-error' | 'unavailable' | 'cancelled'

type CheckOutcome = {
  check: string
  status: CheckStatus
  command: string[]
  exitCode: number | null
  output: string
  fullOutputPath?: string
}

type VerifyResult = {
  content: [{ type: 'text'; text: string }]
  details: { status: string; message: string; checks: CheckOutcome[] }
}

type VerificationTarget = {
  root: string
  directories: string[]
  biomeBinary: string
  biomeVersion: string
}

async function makeCheckOutcome(
  check: string,
  command: string[],
  status: CheckStatus,
  result?: ExecResult,
): Promise<CheckOutcome> {
  const fullOutput = result ? `stdout:\n${result.stdout}\nstderr:\n${result.stderr}` : ''
  const outcome: CheckOutcome = {
    check,
    status,
    command,
    exitCode: result?.code ?? null,
    output: fullOutput.slice(0, 12000),
  }
  if (fullOutput.length > 12000) {
    const directory = await mkdtemp(join(tmpdir(), 'biome-anti-slop-output-'))
    const path = join(directory, 'output.txt')
    await writeFile(path, fullOutput, { mode: 0o600, flag: 'wx' })
    outcome.fullOutputPath = path
  }
  return outcome
}

async function runCheck(
  pi: ExtensionAPI,
  command: string[],
  cwd: string,
  signal?: AbortSignal,
): Promise<ExecResult | null> {
  if (signal?.aborted) return { stdout: '', stderr: '', code: 1, killed: true }
  try {
    return await pi.exec(command[0] ?? '', command.slice(1), { cwd, signal, timeout: 120000 })
  } catch {
    return null
  }
}

async function verifyBiomeLint(
  target: VerificationTarget,
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<CheckOutcome> {
  const command = [
    target.biomeBinary,
    'lint',
    '.',
    '--reporter=json',
    '--max-diagnostics=none',
    '--no-errors-on-unmatched',
  ]
  if (target.biomeVersion !== '2.6.4' || !target.biomeBinary) {
    return {
      check: 'Biome lint',
      status: 'unavailable',
      command,
      exitCode: null,
      output: 'Biome 2.6.4 is unavailable.',
    }
  }
  const result = await runCheck(pi, command, target.root, signal)
  let status: CheckStatus = 'failed'
  if (!result) status = 'unavailable'
  else if (result.killed) status = 'cancelled'
  else if (result.stderr.includes('Error(s) during loading of plugins')) status = 'plugin-load-error'
  else {
    try {
      const report = JSON.parse(result.stdout) as {
        summary?: { errors?: number; warnings?: number; diagnosticsNotPrinted?: number }
        diagnostics?: { category?: string; severity?: string; message?: string }[]
      }
      const pluginFailed = report.diagnostics?.some(
        (item) =>
          item.category === 'plugin' && item.severity === 'info' && /^Rule .+ errored:/.test(item.message ?? ''),
      )
      if (pluginFailed) status = 'failed'
      else if (Value.Check(Type.Number(), report.summary?.errors) && report.summary.diagnosticsNotPrinted === 0) {
        status =
          report.summary.errors > 0 || (report.summary.warnings ?? 0) > 0
            ? 'findings'
            : result.code === 0
              ? 'passed'
              : 'failed'
      }
    } catch (error) {
      result.stderr += `\nUnable to read the Biome report: ${String(error)}`
    }
  }
  return makeCheckOutcome('Biome lint', command, status, result ?? undefined)
}

async function verifyTargetScripts(
  target: VerificationTarget,
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<CheckOutcome[]> {
  const checks: CheckOutcome[] = []
  let scripts: TargetScripts = {}
  let manifestError = ''
  try {
    const manifest = JSON.parse(await readFile(join(target.root, 'package.json'), 'utf8')) as {
      scripts?: TargetScripts
    }
    scripts = manifest.scripts ?? {}
  } catch (error) {
    manifestError = ` ${String(error)}`
  }
  if (scripts.lint !== 'biome lint' && scripts.lint !== 'biome lint .') {
    checks.push({
      check: 'target lint script',
      status: 'unavailable',
      command: [],
      exitCode: null,
      output: `The target lint script is missing or is not a supported read-only Biome command.${manifestError}`,
    })
  }

  let tsc = ''
  if (scripts.typecheck === 'tsc --noEmit') {
    for (const directory of target.directories) {
      const candidate = join(directory, 'node_modules/.bin/tsc')
      try {
        await access(candidate, constants.X_OK)
        tsc = candidate
        break
      } catch {}
    }
  }
  const command = [tsc || 'tsc', '--noEmit']
  if (!tsc) {
    checks.push({
      check: 'target typecheck',
      status: 'unavailable',
      command,
      exitCode: null,
      output: `The target typecheck script is missing, unsupported, or has no local TypeScript executable.${manifestError}`,
    })
  } else {
    const result = await runCheck(pi, command, target.root, signal)
    checks.push(
      await makeCheckOutcome(
        'target typecheck',
        command,
        !result ? 'unavailable' : result.killed ? 'cancelled' : result.code === 0 ? 'passed' : 'failed',
        result ?? undefined,
      ),
    )
  }
  return checks
}

async function verifyBiomeAntiSlop(
  target: VerificationTarget,
  pi: ExtensionAPI,
  signal?: AbortSignal,
): Promise<VerifyResult> {
  const checks = [await verifyBiomeLint(target, pi, signal), ...(await verifyTargetScripts(target, pi, signal))]
  const status = checks.every((check) => check.status === 'passed') ? 'passed' : 'incomplete'
  const message = 'Verification reports findings, errors, unavailable checks, and cancellation separately.'
  const details = { status, message, checks }
  return { content: [{ type: 'text', text: JSON.stringify(details) }], details }
}

export { type VerifyResult, verifyBiomeAntiSlop }
