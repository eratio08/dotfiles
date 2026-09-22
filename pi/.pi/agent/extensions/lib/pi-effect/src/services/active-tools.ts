import { Effect, Semaphore } from 'effect'
import { PiHostError, piCauseMessage } from '../errors.ts'
import type { PiHostValue, PiToolsService } from '../services.ts'

const services = new WeakMap<object, PiToolsService>()

function createPiToolsService(host: PiHostValue): PiToolsService {
  const existing = services.get(host)
  if (existing) return existing
  const semaphore = Semaphore.makeUnsafe(1)
  const service: PiToolsService = {
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
  services.set(host, service)
  return service
}

export { createPiToolsService }
