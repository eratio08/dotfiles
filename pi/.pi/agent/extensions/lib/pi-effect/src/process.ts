import type { ExecOptions, ExecResult } from '@earendil-works/pi-coding-agent'
import { Context, type Effect } from 'effect'
import type { PiHostError } from './errors.ts'
import type { PiHostOperations } from './pi.ts'

/** Effect operation for running a process through Pi. */
type PiProcessService = {
  /** Runs a process and returns its output and exit status. */
  readonly exec: (
    command: string,
    args: readonly string[],
    options?: ExecOptions,
  ) => Effect.Effect<ExecResult, PiHostError>
}

/**
 * Creates process execution operations backed by the Pi host.
 * @param host Low-level Pi operations that run processes.
 * @returns The Pi process service.
 */
const createPiProcessService = (host: PiHostOperations): PiProcessService => ({ exec: host.exec })

/** Service tag for running processes through Pi. */
class PiProcess extends Context.Service<PiProcess, PiProcessService>()('pi-effect/PiProcess') {}

export { createPiProcessService, PiProcess, type PiProcessService }
