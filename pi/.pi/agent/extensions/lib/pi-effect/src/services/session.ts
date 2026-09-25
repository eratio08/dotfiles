import { Effect } from 'effect'
import { PiHostError, piCauseMessage } from '../errors.ts'
import type { PiHostOperations, PiSessionContextValue, PiSessionService } from '../services.ts'

/**
 * Creates session operations from host mutations and the current session snapshot.
 * @param host Low-level Pi operations used to change session state.
 * @param current Session snapshot used by read operations.
 * @returns The Pi session service.
 */
function createPiSessionService(host: PiHostOperations, current: PiSessionContextValue): PiSessionService {
  return {
    appendEntry: host.appendEntry,
    setName: host.setSessionName,
    getName: host.getSessionName,
    setLabel: host.setLabel,
    entry: current.entry,
    branch: current.branch,
    entries: () =>
      Effect.try({
        try: () => current.entries,
        catch: (cause: unknown) => new PiHostError({ operation: 'entries', message: piCauseMessage(cause), cause }),
      }),
    tree: () =>
      Effect.try({
        try: () => current.tree,
        catch: (cause: unknown) => new PiHostError({ operation: 'tree', message: piCauseMessage(cause), cause }),
      }),
    contextEntries: current.contextEntries,
  }
}

export { createPiSessionService }
