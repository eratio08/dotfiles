import { Effect, Semaphore } from 'effect'
import { PiHostError, piCauseMessage } from '../errors.ts'
import type { PiHostValue, PiToolsService } from '../services.ts'

const createPiToolsService = (host: PiHostValue): PiToolsService => {
  const semaphore = Semaphore.makeUnsafe(1)
  return {
    active: host.getActiveTools,
    all: host.getAllTools,
    replaceActive: (toolNames) =>
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
