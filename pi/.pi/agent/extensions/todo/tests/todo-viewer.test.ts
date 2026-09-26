import assert from 'node:assert/strict'
import test from 'node:test'
import { KeybindingsManager, TUI_KEYBINDINGS } from '@earendil-works/pi-tui'
import type { PiTheme } from '@eratio/pi-effect-codemode'
import { TodoViewer } from '../index.ts'

const theme = {
  fg: (_color: string, text: string) => text,
} as PiTheme

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
