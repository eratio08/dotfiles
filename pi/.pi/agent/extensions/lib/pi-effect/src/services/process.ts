import type { PiHostValue, PiProcessService } from '../services.ts'

function createPiProcessService(host: PiHostValue): PiProcessService {
  return { exec: host.exec }
}

export { createPiProcessService }
