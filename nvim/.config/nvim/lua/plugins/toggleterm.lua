return {
  'akinsho/toggleterm.nvim',
  lazy = false,
  dependencies = {
    { 'rose-pine/neovim' },
    { 'folke/which-key.nvim' },
  },
  config = function ()
    require('toggleterm').setup({
      size = vim.o.columns * 0.4,
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
      on_create = function (t)
        require('which-key').register({
          ['<esc>'] = { '<C-\\><C-n>', 'Normal Mode' },
          ['<C-w>'] = { '<C-\\><C-n><C-w>', 'Window command' }
        }, { mode = 't', buffer = t.bufnr })
      end
    })
  end
}
