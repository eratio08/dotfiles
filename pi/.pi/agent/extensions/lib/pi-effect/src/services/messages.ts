import type { PiHostValue, PiMessagesService } from '../services.ts'

const createPiMessagesService = (host: PiHostValue): PiMessagesService => ({
  sendMessage: host.sendMessage,
  sendUserMessage: host.sendUserMessage,
})

export { createPiMessagesService }
