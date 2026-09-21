import type { OutputLimits, SerializedOutput } from './model.ts'

const TRUNCATION_NOTICE = '... output truncated ...'

function truncateOutput(output: string, limits: OutputLimits): SerializedOutput {
  if (limits.maxBytes < 1 || limits.maxLines < 1) {
    return { output: TRUNCATION_NOTICE.slice(0, Math.max(0, limits.maxBytes)), truncated: true }
  }

  const encoder = new TextEncoder()
  const withinLimits =
    encoder.encode(output).byteLength <= limits.maxBytes && output.split('\n').length <= limits.maxLines
  if (withinLimits) return { output, truncated: false }

  if (limits.maxLines === 1) return { output: takePrefix(TRUNCATION_NOTICE, limits.maxBytes, 1), truncated: true }

  const noticeBytes = encoder.encode(TRUNCATION_NOTICE).byteLength
  const lineBudget = Math.max(0, limits.maxLines - 1)
  const byteBudget = Math.max(0, limits.maxBytes - noticeBytes - 1)
  const prefix = takePrefix(output, byteBudget, lineBudget)
  const separator = prefix.length > 0 ? '\n' : ''
  const combined = `${prefix}${separator}${TRUNCATION_NOTICE}`
  return { output: takePrefix(combined, limits.maxBytes, limits.maxLines), truncated: true }
}

function takePrefix(value: string, maxBytes: number, maxLines: number): string {
  if (maxBytes <= 0 || maxLines <= 0) return ''
  const encoder = new TextEncoder()
  let bytes = 0
  let lines = 1
  let result = ''
  for (const character of value) {
    if (character === '\n' && lines >= maxLines) break
    const characterBytes = encoder.encode(character).byteLength
    if (bytes + characterBytes > maxBytes) break
    result += character
    bytes += characterBytes
    if (character === '\n') lines += 1
  }
  return result
}

export { truncateOutput }
