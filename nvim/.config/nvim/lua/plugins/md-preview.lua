return {
  'iamcco/markdown-preview.nvim',
  dependencies = {
    { 'folke/which-key.nvim' }
  },
  build = function ()
    vim.fn['mkdp#util#install']()
  end,
  config = function ()
    local wk = require('which-key')
    wk.register({
      ['<leader>'] = {
        m = {
          v = { ':MarkdownPreviewToggle<CR>', 'Markdown Preview' },
          s = { ':MarkdownPreviewStop<CR>', 'Markdown Stop Preview' },
        },
      },
    })
  end
}
