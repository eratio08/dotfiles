import assert from 'node:assert/strict'
import test from 'node:test'
import type { Theme } from '@earendil-works/pi-coding-agent'
import { KeybindingsManager, TUI_KEYBINDINGS } from '@earendil-works/pi-tui'
import { TodoViewer } from '../index.ts'
import type { Todo } from '../src/extension.ts'

const theme = {
  fg: (_color: string, text: string) => text,
  strikethrough: (text: string) => text,
} as Theme

test('should use and show the configured cancel key given a custom binding', () => {
  //given
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, { 'tui.select.cancel': 'ctrl+x' })
  let closed = false
  const viewer = new TodoViewer([], theme, keybindings, () => {
    closed = true
  })
  const lines = viewer.render(80)

  //when
  viewer.handleInput('\x18')

  //then
  assert.equal(closed, true)
  assert.match(lines.join('\n'), /Press ctrl\+x to close/)
})

test('should order blocked tasks after pending dependencies given completed prerequisites', () => {
  const serveId = '018f0000-0000-7000-8000-000000000001'
  const transcodeId = '018f0000-0001-7000-8000-000000000002'
  const setupId = '018f0000-0002-7000-8000-000000000003'
  const ffmpegId = '018f0000-0003-7000-8000-000000000004'
  const todos: Todo[] = [
    {
      id: serveId,
      content: 'Serve Collie WAV transcription through a loopback Hono endpoint',
      status: 'completed',
      dependsOn: [],
    },
    {
      id: transcodeId,
      content: 'Transcode Collie browser recordings for the HEX Desktop endpoint',
      status: 'completed',
      dependsOn: [serveId],
    },
    {
      id: setupId,
      content: 'Run and verify the Collie-to-HEX Desktop setup',
      status: 'blocked',
      dependsOn: [transcodeId, ffmpegId],
    },
    {
      id: ffmpegId,
      content: 'Provide a real FFmpeg executable for media validation',
      status: 'pending',
      dependsOn: [],
    },
  ]
  const viewer = new TodoViewer(todos, theme, new KeybindingsManager(TUI_KEYBINDINGS, {}), () => {})

  const lines = viewer.render(80)
  const ffmpegIndex = lines.findIndex((line) => line.includes('Provide a real FFmpeg executable for media validation'))
  const setupIndex = lines.findIndex((line) => line.includes('Run and verify the Collie-to-HEX Desktop setup'))

  assert.equal(setupIndex, ffmpegIndex + 1)
  assert.match(lines[setupIndex] ?? '', /^ {4}↳ \[!\] Run and verify the Collie-to-HEX Desktop setup/)
  assert.doesNotMatch(lines.join('\n'), /Blocked by:/)
})
