return {
  'akinsho/toggleterm.nvim',
  dependencies = {
    { 'rose-pine/neovim' },
  },
  config = function ()
    local toggleterm = require('toggleterm')

    local highlights = require('rose-pine.plugins.toggleterm')
    toggleterm.setup({
      size = vim.o.columns * 0.4,
      open_mapping = [[<c-\>]],
      direction = 'vertical',
      highlights = highlights,
      float_opts = {
        border = 'curved',
        winblend = 0,
        highlights = {
          border = 'Normal',
          background = 'Normal',
        },
      },
    })
  end
}
