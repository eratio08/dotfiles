return {
  'akinsho/toggleterm.nvim',
  event = 'VeryLazy',
  dependencies = {
    'rose-pine/neovim',
  },
  config = function ()
    require('toggleterm').setup({
      size = vim.o.columns * 0.5,
      open_mapping = [[<c-\>]],
      direction = 'vertical',
      persist_size = false,
      highlights = require('rose-pine.plugins.toggleterm'),
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
