import type { AssistantMessage } from '@earendil-works/pi-ai/compat'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'

type SessionMessage = Extract<SessionEntry, { type: 'message' }>['message']

type CompactionMessage = {
  role: 'compactionSummary'
  summary: string
  tokensBefore: number
  timestamp: number
}

type HandoffMessage = SessionMessage | CompactionMessage

type HandoffRunResult =
  | { readonly status: 'completed'; readonly branchPointId: string }
  | { readonly status: 'cancelled'; readonly stage: 'generation' | 'navigation' }
  | { readonly status: 'skipped'; readonly reason: 'no-model' | 'no-conversation' }

type HandoffRestoreResult =
  | { readonly status: 'none' }
  | { readonly status: 'restored' }
  | { readonly status: 'warning'; readonly message: string }

function runResultMessage(result: HandoffRunResult): { message: string; type: 'info' | 'error' } | undefined {
  if (result.status === 'cancelled') {
    return {
      message: result.stage === 'navigation' ? 'Branch cancelled' : 'Cancelled',
      type: 'info',
    }
  }
  if (result.status === 'skipped') {
    const messages = {
      'no-model': 'No model selected',
      'no-conversation': 'No conversation to hand off',
    } as const
    return { message: messages[result.reason], type: 'error' }
  }
  return undefined
}

function restoreResultMessage(result: HandoffRestoreResult): string | undefined {
  return result.status === 'warning' ? result.message : undefined
}

function entryToMessage(entry: SessionEntry): HandoffMessage | undefined {
  if (entry.type === 'message') {
    return entry.message
  }
  if (entry.type === 'compaction') {
    return {
      role: 'compactionSummary',
      summary: entry.summary,
      tokensBefore: entry.tokensBefore,
      timestamp: new Date(entry.timestamp).getTime(),
    }
  }
  return undefined
}

function getHandoffMessages(branch: readonly SessionEntry[]): HandoffMessage[] {
  let compactionIndex = -1
  for (let i = branch.length - 1; i >= 0; i--) {
    if (branch[i].type === 'compaction') {
      compactionIndex = i
      break
    }
  }
  if (compactionIndex < 0) {
    return branch.map(entryToMessage).filter((message): message is HandoffMessage => message !== undefined)
  }

  const compaction = branch[compactionIndex]
  const firstKeptIndex =
    compaction.type === 'compaction' ? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId) : -1
  const compactedBranch = [
    compaction,
    ...(firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, compactionIndex) : []),
    ...branch.slice(compactionIndex + 1),
  ]
  return compactedBranch.map(entryToMessage).filter((message): message is HandoffMessage => message !== undefined)
}

function getBranchPointId(branch: readonly SessionEntry[]): string | undefined {
  return branch[0]?.id
}

function getPromptText(response: AssistantMessage): string {
  if (response.stopReason === 'error') {
    throw new Error(response.errorMessage ?? 'Handoff generation failed')
  }

  return response.content
    .filter((content) => content.type === 'text')
    .map((content) => content.text)
    .join('\n')
    .trim()
}

export {
  getBranchPointId,
  getHandoffMessages,
  getPromptText,
  type HandoffMessage,
  type HandoffRestoreResult,
  type HandoffRunResult,
  restoreResultMessage,
  runResultMessage,
  type SessionMessage,
}
