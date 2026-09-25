import type { PiFlagsService, PiHostOperations } from '../services.ts'

/**
 * Creates flag-read operations backed by the Pi host.
 * @param host Low-level Pi operations that read flags.
 * @returns The Pi flags service.
 */
const createPiFlagsService = (host: PiHostOperations): PiFlagsService => ({ get: host.getFlag })

export { createPiFlagsService }
