import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import type { PiTheme } from '@eratio08/pi-effect'

function fit(text: string, width: number): string {
  const truncated = truncateToWidth(text, Math.max(0, width))
  const padding = Math.max(0, width - visibleWidth(truncated))
  return `${truncated}${' '.repeat(padding)}`
}

function frameLine(theme: PiTheme, content: string, innerWidth: number): string {
  return `${theme.fg('borderAccent', '│')}${fit(content, innerWidth)}${theme.fg('borderAccent', '│')}`
}

function divider(theme: PiTheme, innerWidth: number): string {
  return theme.fg('borderMuted', `├${'─'.repeat(innerWidth)}┤`)
}

function topBorder(theme: PiTheme, innerWidth: number): string {
  return theme.fg('borderAccent', `┌${'─'.repeat(innerWidth)}┐`)
}

function bottomBorder(theme: PiTheme, innerWidth: number): string {
  return theme.fg('borderAccent', `└${'─'.repeat(innerWidth)}┘`)
}

function combineColumns(left: string[], right: string[], leftWidth: number, rightWidth: number, sep: string): string[] {
  const rows = Math.max(left.length, right.length)
  const lines: string[] = []
  for (let i = 0; i < rows; i += 1) {
    lines.push(`${fit(left[i] ?? '', leftWidth)}${sep}${fit(right[i] ?? '', rightWidth)}`)
  }
  return lines
}

export { bottomBorder, combineColumns, divider, fit, frameLine, topBorder }
