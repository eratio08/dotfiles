return {
  'iamcco/markdown-preview.nvim',
  lazy = true,
  ft = 'markdown',
  dependencies = {
    { 'folke/which-key.nvim' }
  },
  build = function ()
    vim.fn['mkdp#util#install']()
  end,
  config = function ()
    require('which-key').register({
      ['<leader>'] = {
        m = {
          name = 'Markdown',
          p = { ':MarkdownPreviewToggle<CR>', 'Preview' },
          s = { ':MarkdownPreviewStop<CR>', 'Stop Preview' },
        },
      },
    })
  end
}
