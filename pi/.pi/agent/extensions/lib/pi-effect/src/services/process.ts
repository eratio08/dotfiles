import type { PiHostOperations, PiProcessService } from '../services.ts'

/**
 * Creates process execution operations backed by the Pi host.
 * @param host Low-level Pi operations that run processes.
 * @returns The Pi process service.
 */
const createPiProcessService = (host: PiHostOperations): PiProcessService => ({ exec: host.exec })

export { createPiProcessService }
