import { Effect } from 'effect'
import { PiHostError, piCauseMessage } from '../errors.ts'
import type { PiHostValue, PiSessionContextValue, PiSessionService } from '../services.ts'

function createPiSessionService(host: PiHostValue, current: PiSessionContextValue): PiSessionService {
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
        catch: (cause) => new PiHostError({ operation: 'entries', message: piCauseMessage(cause), cause }),
      }),
    tree: () =>
      Effect.try({
        try: () => current.tree,
        catch: (cause) => new PiHostError({ operation: 'tree', message: piCauseMessage(cause), cause }),
      }),
    contextEntries: current.contextEntries,
  }
}

export { createPiSessionService }
