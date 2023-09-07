return {
  'lewis6991/gitsigns.nvim',
  lazy = false,
  config = function ()
    local gitsigns = require('gitsigns')

    gitsigns.setup({
      signs = {
        add = { text = '+' },
        change = { text = '~' },
        delete = { text = '_' },
        topdelete = { text = '‾' },
        changedelete = { text = '~' },
      },
    })
  end
}
