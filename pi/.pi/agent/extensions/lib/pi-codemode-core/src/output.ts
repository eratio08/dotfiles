/**
 * Sets the maximum UTF-8 byte and line counts for formatted output.
 */
interface OutputLimits {
  readonly maxBytes: number
  readonly maxLines: number
}

/**
 * Contains formatted output text and whether the output was truncated.
 */
interface SerializedOutput {
  readonly output: string
  readonly truncated: boolean
}

const TRUNCATION_NOTICE = '... output truncated ...'

/**
 * Formats a value and truncates it to the configured byte and line limits.
 */
function serializeOutput(value: unknown, limits: OutputLimits): SerializedOutput {
  const output = formatValue(value)
  return truncateOutput(output, limits)
}

/**
 * Formats values for display, with string, JSON, and fallback handling.
 */
function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  try {
    const formatted = JSON.stringify(value, null, 2)
    return formatted === undefined ? String(value) : formatted
  } catch {
    return String(value)
  }
}

/**
 * Applies byte and line limits and adds a notice when the output is truncated.
 */
function truncateOutput(output: string, limits: OutputLimits): SerializedOutput {
  const maxBytes = normalizeLimit(limits.maxBytes)
  const maxLines = normalizeLimit(limits.maxLines)
  if (maxBytes < 1 || maxLines < 1) return { output: '', truncated: output.length > 0 }
  if (fitsOutput(output, maxBytes, maxLines)) return { output, truncated: false }

  if (maxLines === 1) return { output: takePrefix(TRUNCATION_NOTICE, maxBytes, 1), truncated: true }

  const noticeBytes = byteLength(TRUNCATION_NOTICE)
  const lineBudget = maxLines - 1
  const byteBudget = Math.max(0, maxBytes - noticeBytes - 1)
  const prefix = takePrefix(output, byteBudget, lineBudget)
  const separator = prefix.length > 0 ? '\n' : ''
  const combined = `${prefix}${separator}${TRUNCATION_NOTICE}`
  return { output: takePrefix(combined, maxBytes, maxLines), truncated: true }
}

function fitsOutput(output: string, maxBytes: number, maxLines: number): boolean {
  return byteLength(output) <= maxBytes && countLines(output) <= maxLines
}

function takePrefix(value: string, maxBytes: number, maxLines: number): string {
  if (maxBytes <= 0 || maxLines <= 0) return ''
  let bytes = 0
  let lines = 1
  let result = ''
  for (const character of value) {
    if (character === '\n' && lines >= maxLines) break
    const characterBytes = byteLength(character)
    if (bytes + characterBytes > maxBytes) break
    result += character
    bytes += characterBytes
    if (character === '\n') lines += 1
  }
  return result
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function countLines(value: string): number {
  return value.split('\n').length
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value)) return value === Infinity ? Number.MAX_SAFE_INTEGER : 0
  return Math.max(0, Math.floor(value))
}

export { formatValue, type OutputLimits, type SerializedOutput, serializeOutput, TRUNCATION_NOTICE, truncateOutput }
