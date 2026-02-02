return {
  enabled = true,
  'akinsho/toggleterm.nvim',
  event = 'VeryLazy',
  dependencies = {
    'rose-pine/neovim',
  },
  config = function ()
    require('toggleterm').setup({
      size = vim.o.columns * 0.33333,
      open_mapping = [[<c-\>]],
      direction = 'vertical',
      persist_size = false,
      highlights = require('rose-pine.plugins.toggleterm'),
    })
  end
}
