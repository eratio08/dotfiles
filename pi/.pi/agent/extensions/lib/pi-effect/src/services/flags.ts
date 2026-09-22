import type { PiFlagsService, PiHostValue } from '../services.ts'

const createPiFlagsService = (host: PiHostValue): PiFlagsService => ({ get: host.getFlag })

export { createPiFlagsService }
