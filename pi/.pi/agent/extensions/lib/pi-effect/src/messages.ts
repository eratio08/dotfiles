import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import { Context, type Effect } from 'effect'
import type { PiOperationsError } from './errors.ts'
import type { PiOperationsService } from './pi.ts'

/** Text or multimodal content accepted by Pi message operations. */
type PiContent = string | readonly (TextContent | ImageContent)[]

/** Custom message sent to the Pi session. */
type PiCustomMessage<TDetails = unknown> = {
  /** Custom message type used to select a renderer. */
  readonly customType: string
  /** Message content. */
  readonly content: PiContent
  /** Whether Pi displays the message in the conversation. */
  readonly display?: boolean
  /** Structured data stored with the message. */
  readonly details?: TDetails
}

/** Options for sending a custom message. */
type PiSendMessageOptions = {
  /** Whether sending the message starts an assistant turn. */
  readonly triggerTurn?: boolean
  /** How Pi delivers the message relative to the current turn. */
  readonly deliverAs?: 'steer' | 'followUp' | 'nextTurn'
}

/** Options for sending a user message to Pi. */
type PiSendUserMessageOptions = {
  /** How Pi delivers the message relative to the current turn. */
  readonly deliverAs?: 'steer' | 'followUp'
}

/** Effect operations for sending custom and user messages to Pi. */
type PiMessagesService = {
  /** Sends a custom message to the current session. */
  readonly sendMessage: <TDetails>(
    message: PiCustomMessage<TDetails>,
    options?: PiSendMessageOptions,
  ) => Effect.Effect<void, PiOperationsError>
  /** Sends a user message to the current session. */
  readonly sendUserMessage: (content: PiContent, options?: PiSendUserMessageOptions) => Effect.Effect<void, PiOperationsError>
}

/**
 * Creates the Pi messages service from PiOperations.
 * @param operations Low-level Pi operations that send messages.
 * @returns The Pi messages service.
 */
const createPiMessagesService = (operations: PiOperationsService): PiMessagesService => ({
  sendMessage: operations.sendMessage,
  sendUserMessage: operations.sendUserMessage,
})

/** Service tag for sending messages to Pi. */
class PiMessages extends Context.Service<PiMessages, PiMessagesService>()('pi-effect/PiMessages') {}

export {
  createPiMessagesService,
  type PiContent,
  type PiCustomMessage,
  PiMessages,
  type PiMessagesService,
  type PiSendMessageOptions,
  type PiSendUserMessageOptions,
}
