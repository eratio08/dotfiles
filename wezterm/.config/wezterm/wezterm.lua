local wezterm = require 'wezterm'

local config = {}

if wezterm.config_builder then
  config = wezterm.config_builder()
end

-- config.color_scheme = 'rose-pine'
config.font = wezterm.font('JetBrainsMono Nerd Font')
config.font_size = 12.0

-- Rose Pine theme
config.colors = require('lua/rose-pine').colors()

-- tab_bar
config.show_tab_index_in_tab_bar = true
config.hide_tab_bar_if_only_one_tab = false
config.switch_to_last_active_tab_when_closing_tab = true
config.tab_bar_at_bottom = true
config.use_fancy_tab_bar = false

-- key_bindings
config.leader = { key = 'b', mods = 'CTRL', timeout_milliseconds = 1000 }
config.keys = {
  -- tmux bindings, thx chatgpt, needs tweaking
  {
    key = '|',
    mods = 'LEADER|SHIFT',
    action = wezterm.action.SplitHorizontal { domain = 'CurrentPaneDomain' },
  },
  -- Session Management
  {
    key = "b",
    mods = "LEADER",
    action = wezterm.action { SplitHorizontal = { domain = "CurrentPaneDomain" } },
  },
  {
    key = "c",
    mods = "LEADER",
    action = wezterm.action { SpawnTab = "DefaultDomain" },
  },
  {
    key = ",",
    mods = "LEADER",
    action = wezterm.action.PromptInputLine {
      description = 'Enter new name for tab',
      action = wezterm.action_callback(function(window, _, line)
        if line then
          window:active_tab():set_title(line)
        end
      end),
    },
  },
  {
    key = "w",
    mods = "LEADER",
    action = wezterm.action { ActivateTabRelative = 1 },
  },
  {
    key = "%",
    mods = "LEADER",
    action = wezterm.action { SplitVertical = { domain = "CurrentPaneDomain" } },
  },
  {
    key = '"',
    mods = "LEADER",
    action = wezterm.action { SplitHorizontal = { domain = "CurrentPaneDomain" } },
  },
  {
    key = "&",
    mods = "LEADER",
    action = wezterm.action { CloseCurrentPane = { confirm = true } },
  },
  {
    key = "d",
    mods = "LEADER",
    action = wezterm.action { CloseCurrentPane = { confirm = false } },
  },
  -- Pane Navigation and Control
  {
    key = "h",
    mods = "LEADER",
    action = wezterm.action { ActivatePaneDirection = "Left" },
  },
  {
    key = "l",
    mods = "LEADER",
    action = wezterm.action { ActivatePaneDirection = "Right" },
  },
  {
    key = "k",
    mods = "LEADER",
    action = wezterm.action { ActivatePaneDirection = "Up" },
  },
  {
    key = "j",
    mods = "LEADER",
    action = wezterm.action { ActivatePaneDirection = "Down" },
  },
  {
    key = "o",
    mods = "LEADER",
    action = wezterm.action { ActivatePaneDirection = "Prev" },
  },
  {
    key = ";",
    mods = "LEADER",
    action = wezterm.action { ActivatePaneDirection = "Prev" },
  },
  {
    key = "x",
    mods = "LEADER",
    action = wezterm.action { CloseCurrentPane = { confirm = true } },
  },
  {
    key = "!",
    mods = "LEADER",
    action = wezterm.action_callback(function(_, pane)
      pane:move_to_new_window()
    end),
  },
  -- { key = "q", mods = "LEADER", action = wezterm.action { ShowTabIndices = true }, },
  -- Session Management
  {
    key = "s",
    mods = "LEADER",
    action = wezterm.action.ShowTabNavigator
  },
  -- { key = "$", mods = "LEADER", action = wezterm.action { RenameTab = "CurrentTab" }, },
  -- Miscellaneous
  -- { key = "?", mods = "LEADER", action = wezterm.action { ShowTabIndices = true }, },
}


return config
