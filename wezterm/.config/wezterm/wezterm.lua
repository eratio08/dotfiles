local wezterm = require('wezterm')
local act = wezterm.action
local config = {}

if wezterm.config_builder then
  config = wezterm.config_builder()
end

config.font = wezterm.font_with_fallback({ 'JetBrainsMono Nerd Font', 'JetBrains Mono' })
config.font_size = 15.0

-- Rose Pine theme
local theme = require('lua/rose-pine')
config.color_schemes = {
  ['dark'] = theme.moon.colors(),
  ['light'] = theme.dawn.colors(),
}
config.color_scheme = 'dark'
config.window_background_opacity = 0.95

-- register custom event to toggle schemes
wezterm.on('toggle-color-theme', function(window, _)
  local overrides = window:get_config_overrides() or {}
  if overrides.color_scheme == 'light' then
    overrides.color_scheme = 'dark'
  else
    overrides.color_scheme = 'light'
  end
  window:set_config_overrides(overrides)
end)

-- tab_bar
config.show_tab_index_in_tab_bar = true
config.hide_tab_bar_if_only_one_tab = false
config.switch_to_last_active_tab_when_closing_tab = true
config.tab_bar_at_bottom = true
config.use_fancy_tab_bar = false

-- key_bindings, tmux inspired
config.leader = { key = 'b', mods = 'CTRL', timeout_milliseconds = 1000 }
config.keys = {
  -- switch themes
  {
    key = 't',
    mods = 'LEADER',
    action = act.EmitEvent('toggle-color-theme'),
  },
  -- C-o  Rotate the panes in the current window forwards.Rotate the panes in the current window forwards.
  {
    -- Break the current pane out of the window.
    key = '!',
    mods = 'LEADER',
    action = wezterm.action_callback(
      function(_, pane) pane:move_to_new_window() end
    ),
  },
  {
    -- Split the current pane into two, top and bottom.
    key = '"',
    mods = 'LEADER',
    action = act.SplitHorizontal({ domain = 'CurrentPaneDomain' }),
  },
  -- #  List all paste buffers.
  -- $  Rename the current session.
  {
    -- Split the current pane into two, left and right.
    key = '%',
    mods = 'LEADER',
    action = act.SplitVertical({ domain = 'CurrentPaneDomain' }),
  },
  {
    -- Kill the current window.
    key = '&',
    mods = 'LEADER',
    action = act.CloseCurrentTab { confirm = true },
  },
  -- '  Prompt for a window index to select.
  -- (  Switch the attached client to the previous session.
  -- )  Switch the attached client to the next session.
  {
    -- Rename the current window.
    key = ',',
    mods = 'LEADER',
    action = act.PromptInputLine({
      description = 'Enter new name for tab',
      action = wezterm.action_callback(
        function(window, _, line)
          if line then
            window:active_tab():set_title(line)
          end
        end),
    }),
  },
  -- -  Delete the most recently copied buffer of text.
  -- .  Prompt for an index to move the current window.
  -- :  Enter the tmux command prompt.
  {
    -- Move to the previously active pane.
    key = ';',
    mods = 'LEADER',
    action = act.ActivatePaneDirection('Prev'),
  },
  -- =  Choose which buffer to paste interactively from a list.
  -- ?  List all key bindings.
  -- D  Choose a client to detach.
  -- L  Switch the attached client back to the last session.
  {
    -- Enter copy mode to copy text or view the history.
    key = '[',
    mods = 'LEADER',
    action = act.ActivateCopyMode,
  },
  -- ]  Paste the most recently copied buffer of text.
  {
    -- Create a new window.
    key = 'c',
    mods = 'LEADER',
    action = act.SpawnTab('DefaultDomain'),
  },
  {
    -- Detach the current client.
    key = 'd',
    mods = 'LEADER',
    action = act.DetachDomain('CurrentPaneDomain'),
  },
  -- f  Prompt to search for text in open windows.
  -- i  Display some information about the current window.
  -- l  Move to the previously selected window.
  -- m  Mark the current pane (see select-pane -m).
  -- M  Clear the marked pane.
  {
    -- Change to the next window.
    key = 'n',
    mods = 'LEADER',
    action = act.ActivateTabRelative(1),
  },
  {
    -- Select the next pane in the current window.
    key = 'o',
    mods = 'LEADER',
    action = act.ActivatePaneDirection('Next'),
  },
  {
    -- Change to the previous window.
    key = 'n',
    mods = 'LEADER',
    action = act.ActivateTabRelative(-1),
  },
  -- q  Briefly display pane indexes.
  -- r  Force redraw of the attached client.
  -- s  Select a new session for the attached client interactively.
  -- t  Show the time.
  -- w  Choose the current window interactively.
  {
    -- Kill the current pane.
    key = 'x',
    mods = 'LEADER',
    action = act.CloseCurrentPane({ confirm = true }),
  },
  -- z  Toggle zoom state of the current pane.
  -- {  Swap the current pane with the previous pane.
  -- }  Swap the current pane with the next pane.
  -- ~  Show previous messages from tmux, if any.

  -- Pane Navigation and Control
  {
    key = 'h',
    mods = 'LEADER',
    action = act.ActivatePaneDirection('Left'),
  },
  {
    key = 'l',
    mods = 'LEADER',
    action = act.ActivatePaneDirection('Right'),
  },
  {
    key = 'k',
    mods = 'LEADER',
    action = act.ActivatePaneDirection('Up'),
  },
  {
    key = 'j',
    mods = 'LEADER',
    action = act.ActivatePaneDirection('Down'),
  },
  {
    key = 'h',
    mods = 'LEADER',
    action = act.ActivatePaneDirection('Left'),
  },
  -- Alternative Navigation
  {
    key = 'l',
    mods = 'SUPER',
    action = act.ActivatePaneDirection('Right'),
  },
  {
    key = 'k',
    mods = 'SUPER',
    action = act.ActivatePaneDirection('Up'),
  },
  {
    key = 'j',
    mods = 'SUPER',
    action = act.ActivatePaneDirection('Down'),
  },
  {
    key = 'h',
    mods = 'SUPER',
    action = act.ActivatePaneDirection('Left'),
  },

  -- Adjust Pane Size
  {
    key = 'LeftArrow',
    mods = 'SUPER',
    action = act.AdjustPaneSize({ 'Left', 5 })
  },
  {
    key = 'RightArrow',
    mods = 'SUPER',
    action = act.AdjustPaneSize({ 'Right', 5 })
  },
  {
    key = 'UpArrow',
    mods = 'SUPER',
    action = act.AdjustPaneSize({ 'Up', 5 })
  },
  {
    key = 'DownArrow',
    mods = 'SUPER',
    action = act.AdjustPaneSize({ 'Down', 5 })
  },

  -- Rebind OPT-Left, OPT-Right as ALT-b, ALT-f respectively to match Terminal.app behavior
  {
    key = 'LeftArrow',
    mods = 'OPT',
    action = act.SendKey { key = 'b', mods = 'ALT' },
  },
  {
    key = 'RightArrow',
    mods = 'OPT',
    action = act.SendKey { key = 'f', mods = 'ALT' },
  },
}

-- Select windows 0 to 9.
for i = 1, 8 do
  table.insert(config.keys, {
    key = tostring(i),
    mods = 'LEADER',
    action = act.ActivateTab(i - 1),
  })
end

config.audible_bell = 'Disabled'
config.window_padding = {
  left = 0,
  right = 0,
  top = 0,
  bottom = 0,
}
config.window_decorations = 'RESIZE'

local function basename(s)
  return string.gsub(s.path, '(.*[/\\])(.*)', '%2') or ''
end

wezterm.on(
  'format-tab-title',
  function(tab)
    local pane = tab.active_pane
    local title = tab.tab_index + 1 .. ':' .. basename(pane.current_working_dir)
    return {
      { Text = ' ' .. title .. ' ' },
    }
  end
)

-- Sessions
-- config.unix_domains = { { name = 'unix', local_echo_threshold_ms = 10 } }
-- config.default_gui_startup_args = { 'connect', 'unix' }


return config
