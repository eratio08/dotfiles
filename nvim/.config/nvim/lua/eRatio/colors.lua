vim.cmd('colorscheme rose-pine')

local set_dark_theme = function ()
  vim.o.background = 'dark'

  local p = require('rose-pine.palette')
  vim.api.nvim_set_hl(0, 'Normal', { fg = p.text, bg = 'none' })
  vim.api.nvim_set_hl(0, 'NormalFloat', { fg = p.text, bg = 'none' })
end

local set_light_theme = function ()
  vim.o.background = 'light'

  local p = require('rose-pine.palette')
  vim.api.nvim_set_hl(0, 'Normal', { fg = p.text, bg = p.base })
  vim.api.nvim_set_hl(0, 'Normal', { fg = p.text, bg = p.base })
end

vim.api.nvim_create_user_command('DarkTheme', set_dark_theme, { desc = 'Set dark theme' })
vim.api.nvim_create_user_command('LightTheme', set_light_theme, { desc = 'Set light theme' })
