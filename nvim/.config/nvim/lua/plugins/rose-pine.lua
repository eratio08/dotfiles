return {
  enabled = true,
  'rose-pine/neovim',
  name     = 'rose-pine',
  lazy     = false,
  priority = 1000,
  config   = function ()
    local rose_pine = require('rose-pine')
    local light_gray = '#34304c'

    rose_pine.setup({
      dark_variant = 'moon',
      dim_inactive_windows = false,

      styles = {
        bold = false,
        italic = false,
        transparency = true,
      },

      highlight_groups = {
        Normal = { bg = 'none', fg = 'text' },
        NormalFloat = { bg = 'none', fg = 'text' },
        WinSeparator = { bg = 'none' },
        NonText = { fg = light_gray },
        Whitespace = { fg = light_gray },
      }
    })

    vim.cmd('colorscheme rose-pine')
    require('eRatio.dark-light').setup()

    -- Setup Light & Dark Theme
    -- local set_dark_theme = function ()
    --   vim.o.background = 'dark'
    -- end

    -- local set_light_theme = function ()
    --   vim.o.background = 'light'

    -- local p = require('rose-pine.palette')
    -- vim.api.nvim_set_hl(0, 'Normal', { fg = p.text, bg = p.base })
    -- vim.api.nvim_set_hl(0, 'NormalFloat', { fg = p.text, bg = p.base })
    --
    -- local lt_light_gray = '#e5e0da'
    -- vim.api.nvim_set_hl(0, 'NonText', { fg = lt_light_gray })
    -- vim.api.nvim_set_hl(0, 'Whitespace', { fg = lt_light_gray })
    -- end

    -- vim.api.nvim_create_user_command('DarkTheme', set_dark_theme, { desc = 'Set dark theme' })
    -- vim.api.nvim_create_user_command('LightTheme', set_light_theme, { desc = 'Set light theme' })
  end
}
