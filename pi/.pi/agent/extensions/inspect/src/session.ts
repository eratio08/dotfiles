import {
  buildSessionProjection,
  parseSessionEntries,
  type SessionEntry,
  type SessionHeader,
  type SessionManager,
  type SessionProjection,
} from '@earendil-works/pi-coding-agent'

type CurrentSessionManager = Pick<
  SessionManager,
  'getHeader' | 'getSessionId' | 'getCwd' | 'getEntries' | 'getBranch' | 'getLeafId' | 'buildSessionProjection'
>

type ParsedSession = {
  header: SessionHeader | null
  sessionId: string
  cwd: string
  source: 'current' | 'saved'
  filePath?: string
  entries: SessionEntry[]
  branch: SessionEntry[]
  leafId: string | null
  projection: SessionProjection
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validateEntries(entries: SessionEntry[]): Map<string, SessionEntry> {
  const byId = new Map<string, SessionEntry>()

  for (const entry of entries) {
    const record = entry as unknown as Record<string, unknown>
    if (typeof record.id !== 'string' || record.id.length === 0) {
      throw new Error('Session entry is missing a valid ID.')
    }
    if (record.parentId !== null && typeof record.parentId !== 'string') {
      throw new Error(`Session entry ${record.id} has an invalid parent ID.`)
    }
    if (byId.has(record.id)) {
      throw new Error(`Session file contains duplicate entry ID ${record.id}.`)
    }
    byId.set(record.id, entry)
  }

  return byId
}

function getSelectedBranch(
  _entries: SessionEntry[],
  leafId: string | null,
  byId: Map<string, SessionEntry>,
): SessionEntry[] {
  if (leafId === null) return []

  const branch: SessionEntry[] = []
  const visited = new Set<string>()
  let current = byId.get(leafId)

  if (!current) throw new Error(`Session leaf ${leafId} was not found.`)

  while (current) {
    if (visited.has(current.id)) {
      throw new Error(`Session branch contains a parent cycle at entry ${current.id}.`)
    }
    visited.add(current.id)
    branch.push(current)

    if (current.parentId === null) break

    const parent = byId.get(current.parentId)
    if (!parent) {
      throw new Error(`Session entry ${current.id} refers to missing parent ${current.parentId}.`)
    }
    current = parent
  }

  return branch.reverse()
}

function selectCurrentSession(sessionManager: CurrentSessionManager): ParsedSession {
  return {
    header: sessionManager.getHeader(),
    sessionId: sessionManager.getSessionId(),
    cwd: sessionManager.getCwd(),
    source: 'current',
    entries: sessionManager.getEntries(),
    branch: sessionManager.getBranch(),
    leafId: sessionManager.getLeafId(),
    projection: sessionManager.buildSessionProjection(),
  }
}

function parseSavedSession(content: string, requestedLeafId?: string, filePath?: string): ParsedSession {
  if (!content.trim()) throw new Error('Session file is empty.')

  const records: unknown[] = []
  const lines = content.split(/\r?\n/)

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue

    let record: unknown
    try {
      record = JSON.parse(line) as unknown
    } catch {
      throw new Error(`Session file contains malformed JSON on line ${index + 1}.`)
    }

    if (!isRecord(record)) {
      throw new Error(`Session file line ${index + 1} is not a JSON object.`)
    }
    records.push(record)
  }

  const firstRecord = records[0]
  if (!isRecord(firstRecord) || firstRecord.type !== 'session') {
    throw new Error('Session file does not start with a Pi session header.')
  }
  if (typeof firstRecord.id !== 'string' || firstRecord.id.length === 0) {
    throw new Error('Session header is missing a valid session ID.')
  }
  if (records.slice(1).some((record) => isRecord(record) && record.type === 'session')) {
    throw new Error('Session file contains more than one session header.')
  }

  const fileEntries = parseSessionEntries(content)
  if (fileEntries.length !== records.length) {
    throw new Error('Pi could not parse every session file entry.')
  }

  const headerEntry = fileEntries[0]
  if (headerEntry?.type !== 'session') {
    throw new Error('Session file does not contain a valid Pi session header.')
  }

  const entries = fileEntries.filter((entry): entry is SessionEntry => entry.type !== 'session')
  const byId = validateEntries(entries)
  const leafId = requestedLeafId ?? entries.at(-1)?.id ?? null

  if (leafId !== null && !byId.has(leafId)) {
    throw new Error(`Session leaf ${leafId} was not found.`)
  }

  const branch = getSelectedBranch(entries, leafId, byId)
  let projection: SessionProjection

  try {
    projection = buildSessionProjection(entries, leafId)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Pi could not build the session projection: ${message}`)
  }

  const header = headerEntry as SessionHeader

  return {
    header,
    sessionId: header.id,
    cwd: typeof header.cwd === 'string' ? header.cwd : '',
    source: 'saved',
    filePath,
    entries,
    branch,
    leafId,
    projection,
  }
}

export { type ParsedSession, parseSavedSession, selectCurrentSession }
