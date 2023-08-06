return {
  'rose-pine/neovim',
  name     = 'rose-pine',
  priority = 1000,
  config   = function ()
    local rose_pine = require('rose-pine')
    local light_gray = '#34304c'

    rose_pine.setup({
      bold_vert_split = false,
      dim_nc_background = false,
      disable_background = true,
      disable_float_background = true,
      disable_italics = false,
      highlight_groups = {
        Normal = { bg = 'none', fg = 'text' },
        NormalFloat = { bg = 'none', fg = 'text' },
        WinSeparator = { bg = 'none' },
        NonText = { fg = light_gray },
        Whitespace = { fg = light_gray },
      }
    })
  end
}
