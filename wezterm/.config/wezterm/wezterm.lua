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

return config
