import { Effect } from 'effect'
import { PiHostError } from '../errors.ts'
import type { PiHostValue, PiSessionContextValue, PiSessionService } from '../services.ts'

function createPiSessionService(host: PiHostValue, current: PiSessionContextValue): PiSessionService {
  return {
    appendEntry: host.appendEntry,
    setName: host.setSessionName,
    getName: host.getSessionName,
    setLabel: host.setLabel,
    entry: (id) =>
      Effect.try({
        try: () => current.entry(id),
        catch: (cause) => new PiHostError({ operation: 'entry', message: String(cause), cause }),
      }),
    branch: (fromId) =>
      Effect.try({
        try: () => current.branch(fromId),
        catch: (cause) => new PiHostError({ operation: 'branch', message: String(cause), cause }),
      }),
    entries: () =>
      Effect.try({
        try: () => current.entries,
        catch: (cause) => new PiHostError({ operation: 'entries', message: String(cause), cause }),
      }),
    tree: () =>
      Effect.try({
        try: () => current.tree,
        catch: (cause) => new PiHostError({ operation: 'tree', message: String(cause), cause }),
      }),
    contextEntries: () =>
      Effect.try({
        try: () => current.contextEntries(),
        catch: (cause) => new PiHostError({ operation: 'contextEntries', message: String(cause), cause }),
      }),
  }
}

export { createPiSessionService }
