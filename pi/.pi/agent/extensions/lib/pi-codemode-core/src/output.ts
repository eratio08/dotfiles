interface CodeModeOutputLimits {
  readonly maxBytes: number
  readonly maxLines: number
}

interface CodeModeSerializedOutput {
  readonly output: string
  readonly truncated: boolean
}

const CODE_MODE_TRUNCATION_NOTICE = '... output truncated ...'

function serializeOutput(value: unknown, limits: CodeModeOutputLimits): CodeModeSerializedOutput {
  const output = formatCodeModeValue(value)
  return truncateCodeModeOutput(output, limits)
}

function formatCodeModeValue(value: unknown): string {
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

function truncateCodeModeOutput(output: string, limits: CodeModeOutputLimits): CodeModeSerializedOutput {
  const maxBytes = normalizeLimit(limits.maxBytes)
  const maxLines = normalizeLimit(limits.maxLines)
  if (maxBytes < 1 || maxLines < 1) return { output: '', truncated: output.length > 0 }
  if (fitsCodeModeOutput(output, maxBytes, maxLines)) return { output, truncated: false }

  if (maxLines === 1) return { output: takeCodeModePrefix(CODE_MODE_TRUNCATION_NOTICE, maxBytes, 1), truncated: true }

  const noticeBytes = byteLength(CODE_MODE_TRUNCATION_NOTICE)
  const lineBudget = maxLines - 1
  const byteBudget = Math.max(0, maxBytes - noticeBytes - 1)
  const prefix = takeCodeModePrefix(output, byteBudget, lineBudget)
  const separator = prefix.length > 0 ? '\n' : ''
  const combined = `${prefix}${separator}${CODE_MODE_TRUNCATION_NOTICE}`
  return { output: takeCodeModePrefix(combined, maxBytes, maxLines), truncated: true }
}

function fitsCodeModeOutput(output: string, maxBytes: number, maxLines: number): boolean {
  return byteLength(output) <= maxBytes && countCodeModeLines(output) <= maxLines
}

function takeCodeModePrefix(value: string, maxBytes: number, maxLines: number): string {
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

function countCodeModeLines(value: string): number {
  return value.split('\n').length
}

function normalizeLimit(value: number): number {
  if (!Number.isFinite(value)) return value === Infinity ? Number.MAX_SAFE_INTEGER : 0
  return Math.max(0, Math.floor(value))
}

export {
  CODE_MODE_TRUNCATION_NOTICE as TRUNCATION_NOTICE,
  type CodeModeOutputLimits as OutputLimits,
  type CodeModeSerializedOutput as SerializedOutput,
  formatCodeModeValue as formatValue,
  serializeOutput,
  truncateCodeModeOutput as truncateOutput,
}
