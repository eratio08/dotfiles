local wezterm = require 'wezterm'

local config = {}

if wezterm.config_builder then
  config = wezterm.config_builder()
end

config.font = wezterm.font_with_fallback({ 'JetBrainsMono Nerd Font', 'JetBrains Mono' })
config.font_size = 15.0

-- Rose Pine theme
config.colors = require('lua/rose-pine').colors()
config.window_background_opacity = 0.95

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
  -- Session Management
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
    action = wezterm.action { ActivatePaneDirection = "Next" },
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
  -- Session Management
  {
    key = "s",
    mods = "LEADER",
    action = wezterm.action.ShowTabNavigator
  },
  -- Resize Split Pane
  { key = "LeftArrow",  mods = "CTRL", action = wezterm.action { AdjustPaneSize = { "Left", 5 } } },
  { key = "RightArrow", mods = "CTRL", action = wezterm.action { AdjustPaneSize = { "Right", 5 } } },
  { key = "UpArrow",    mods = "CTRL", action = wezterm.action { AdjustPaneSize = { "Up", 5 } } },
  { key = "DownArrow",  mods = "CTRL", action = wezterm.action { AdjustPaneSize = { "Down", 5 } } },
}

config.audible_bell = 'Disabled'
config.window_padding = {
  left = 0,
  right = 0,
  top = 0,
  bottom = 0,
}
config.window_decorations = "RESIZE"

-- Equivalent to POSIX basename(3)
-- Given "/foo/bar" returns "bar"
-- Given "c:\\foo\\bar" returns "bar"
local function basename(s)
  return string.gsub(s, '(.*[/\\])(.*)', '%2')
end

wezterm.on(
  'format-tab-title',
  function(tab, tabs, panes, config, hover, max_width)
    local pane = tab.active_pane
    local title = tab.tab_index + 1 .. ":" .. basename(pane.current_working_dir)
    return {
      { Text = " " .. title .. " " },
    }
  end
)


return config
