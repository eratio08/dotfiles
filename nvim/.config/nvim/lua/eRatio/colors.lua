vim.cmd('colorscheme rose-pine')

local set_dark_theme = function ()
  vim.o.background = 'dark'
  vim.api.nvim_set_hl(0, 'Normal', { bg = 'none' })
end

local set_light_theme = function ()
  vim.o.background = 'light'
  vim.api.nvim_set_hl(0, 'Normal', { bg = '#faf4ed' })
end

vim.api.nvim_create_user_command('DarkTheme', set_dark_theme, { desc = 'Set dark theme' })
vim.api.nvim_create_user_command('LightTheme', set_light_theme, { desc = 'Set light theme' })
