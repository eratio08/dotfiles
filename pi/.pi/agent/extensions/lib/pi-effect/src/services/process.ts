import type { PiHostValue, PiProcessService } from '../services.ts'

const createPiProcessService = (host: PiHostValue): PiProcessService => ({ exec: host.exec })

export { createPiProcessService }
