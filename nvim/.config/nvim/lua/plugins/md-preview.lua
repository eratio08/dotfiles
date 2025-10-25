return {
  enabled = true,
  'eratio08/markdown-preview.nvim',
  dependencies = {
    'folke/which-key.nvim'
  },
  ft = 'markdown',
  build = 'cd app && yarn install',
  init = function ()
    vim.g.mkdp_filetypes = { 'markdown' }
  end,
  config = function ()
    require('which-key').add({
      { '<leader>m', group = 'Markdown' },
      { '<leader>mp', ':MarkdownPreviewToggle<CR>', desc = 'Markdown Preview' },
      { '<leader>ms', ':MarkdownPreviewStop<CR>', desc = 'Stop Preview' },
    })
  end
}
