vim.cmd('colorscheme rose-pine')


local set_dark_theme = function ()
  vim.o.background = 'dark'
end

local set_light_theme = function ()
  vim.o.background = 'light'

  local p = require('rose-pine.palette')
  vim.api.nvim_set_hl(0, 'Normal', { fg = p.text, bg = p.base })
  vim.api.nvim_set_hl(0, 'NormalFloat', { fg = p.text, bg = p.base })

  local light_gray = '#e5e0da'
  vim.api.nvim_set_hl(0, 'NonText', { fg = light_gray })
  vim.api.nvim_set_hl(0, 'Whitespace', { fg = light_gray })
end

vim.api.nvim_create_user_command('DarkTheme', set_dark_theme, { desc = 'Set dark theme' })
vim.api.nvim_create_user_command('LightTheme', set_light_theme, { desc = 'Set light theme' })
