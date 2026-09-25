import { Effect, Semaphore } from 'effect'
import { PiHostError, piCauseMessage } from '../errors.ts'
import type { PiHostOperations, PiToolsService } from '../services.ts'

/**
 * Creates tool operations backed by the host and serializes active-tool replacements.
 * @param host Low-level Pi operations for reading and replacing tools.
 * @returns The Pi tools service.
 */
const createPiToolsService = (host: PiHostOperations): PiToolsService => {
  const semaphore = Semaphore.makeUnsafe(1)
  return {
    active: host.getActiveTools,
    all: host.getAllTools,
    replaceActive: (toolNames: readonly string[]) =>
      semaphore
        .withPermit(host.setActiveTools(toolNames))
        .pipe(
          Effect.mapError((cause) =>
            cause instanceof PiHostError
              ? cause
              : new PiHostError({ operation: 'setActiveTools', message: piCauseMessage(cause), cause }),
          ),
        ),
  }
}

export { createPiToolsService }
