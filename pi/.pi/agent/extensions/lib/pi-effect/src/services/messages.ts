import type { PiHostValue, PiMessagesService } from '../services.ts'

function createPiMessagesService(host: PiHostValue): PiMessagesService {
  return {
    sendMessage: host.sendMessage,
    sendUserMessage: host.sendUserMessage,
  }
}

export { createPiMessagesService }
