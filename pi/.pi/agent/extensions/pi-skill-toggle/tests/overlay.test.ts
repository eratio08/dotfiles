import { test } from 'bun:test'
import { strict as assert } from 'node:assert'
import { KeybindingsManager, TUI_KEYBINDINGS } from '@earendil-works/pi-tui'
import { SkillToggleOverlay } from '../src/ui/overlay.ts'

test("should cancel through Pi's remapped binding given a custom key", () => {
  //given
  const keybindings = new KeybindingsManager(TUI_KEYBINDINGS, { 'tui.select.cancel': 'ctrl+x' })
  let action: string | undefined
  const overlay = new SkillToggleOverlay({} as never, {} as never, [], keybindings, (result) => {
    action = result.action
  })

  //when
  overlay.handleInput('\x18')

  //then
  assert.equal(action, 'cancel')
})
