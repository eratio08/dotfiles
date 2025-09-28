return {
  enabled = true,
  'iamcco/markdown-preview.nvim',
  dependencies = {
    'folke/which-key.nvim'
  },
  -- build = function () vim.fn['mkdp#util#install']() end,
  ft = 'markdown',
  build = 'cd app && npm install',
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
