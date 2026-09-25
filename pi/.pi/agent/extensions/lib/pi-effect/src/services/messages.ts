import type { PiHostOperations, PiMessagesService } from '../services.ts'

/**
 * Creates message operations backed by the Pi host.
 * @param host Low-level Pi operations that send messages.
 * @returns The Pi messages service.
 */
const createPiMessagesService = (host: PiHostOperations): PiMessagesService => ({
  sendMessage: host.sendMessage,
  sendUserMessage: host.sendUserMessage,
})

export { createPiMessagesService }
