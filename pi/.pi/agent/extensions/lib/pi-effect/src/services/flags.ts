import type { PiFlagsService, PiHostValue } from '../services.ts'

function createPiFlagsService(host: PiHostValue): PiFlagsService {
  return { get: host.getFlag }
}

export { createPiFlagsService }
