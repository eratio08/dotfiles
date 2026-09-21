import { spawn } from 'node:child_process'
import type { ExecOptions, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Context, Effect, Layer } from 'effect'
import type { OpensrcFailure, PiExecutionRequest, PiExecutionResult } from '../core/model.ts'
import { createOpensrcFailure } from '../core/model.ts'

interface PiHostService {
  readonly exec: (request: PiExecutionRequest) => Effect.Effect<PiExecutionResult, OpensrcFailure>
}

class OpensrcPi extends Context.Service<OpensrcPi, ExtensionAPI>()('opensrc/Pi') {}

class PiHost extends Context.Service<PiHost, PiHostService>()('opensrc/PiHost') {}

function executeRequest(
  pi: ExtensionAPI,
  request: PiExecutionRequest,
): Effect.Effect<PiExecutionResult, OpensrcFailure> {
  return Effect.tryPromise({
    try: (signal) => executePiRequest(pi, request, signal),
    catch: (cause) => mapPiFailure(request.command, cause),
  })
}

const PiHostLive: Layer.Layer<PiHost, never, OpensrcPi> = Layer.effect(
  PiHost,
  Effect.gen(function* () {
    const pi = yield* OpensrcPi
    return PiHost.of({ exec: (request) => executeRequest(pi, request) })
  }),
)

function executePiRequest(
  pi: ExtensionAPI,
  request: PiExecutionRequest,
  signal: AbortSignal,
): Promise<PiExecutionResult> {
  if (Object.keys(request.environment).length === 0) {
    const options: ExecOptions = { cwd: request.cwd, signal }
    return pi.exec(request.command, [...request.args], options)
  }
  return executeCommandWithEnvironment(request, signal)
}

function executeCommandWithEnvironment(request: PiExecutionRequest, signal: AbortSignal): Promise<PiExecutionResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let killed = false
    let settled = false
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: createChildEnvironment(request.environment),
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const complete = (result: PiExecutionResult): void => {
      if (settled) return
      settled = true
      if (killTimer !== undefined) clearTimeout(killTimer)
      signal.removeEventListener('abort', killProcess)
      resolve(result)
    }

    const killProcess = (): void => {
      if (settled || killed) return
      killed = true
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, 5_000)
    }

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.once('error', (cause) => {
      const message = cause instanceof Error ? cause.message : String(cause)
      complete({ stdout, stderr: stderr || message, code: 1, killed })
    })
    child.once('close', (code) => {
      complete({ stdout, stderr, code: code ?? 0, killed })
    })
    if (signal.aborted) killProcess()
    else signal.addEventListener('abort', killProcess, { once: true })
  })
}

function createChildEnvironment(environment: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  const childEnvironment = { ...process.env }
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete childEnvironment[name]
    else childEnvironment[name] = value
  }
  return childEnvironment
}

function mapPiFailure(command: string, cause: unknown): OpensrcFailure {
  return createOpensrcFailure({
    _tag: 'cli',
    operation: `exec ${command}`,
    message: cause instanceof Error ? cause.message : 'Process execution failed',
    cause,
  })
}

export { OpensrcPi, PiHost, PiHostLive, type PiHostService }
