return {
  'iamcco/markdown-preview.nvim',
  lazy = true,
  ft = 'markdown',
  dependencies = {
    'folke/which-key.nvim'
  },
  build = function ()
    vim.fn['mkdp#util#install']()
  end,
  config = function ()
    require('which-key').add({
      { '<leader>m', group = 'Markdown' },
      { '<leader>mp', ':MarkdownPreviewToggle<CR>', desc = 'Markdown Preview' },
      { '<leader>ms', ':MarkdownPreviewStop<CR>', desc = 'Stop Preview' },
    })
  end
}
