return {
  enabled = true,
  'eratio08/markdown-preview.nvim',
  dependencies = {
    'folke/which-key.nvim'
  },
  cmd = { 'MarkdownPreviewToggle', 'MarkdownPreview', 'MarkdownPreviewStop' },
  ft = { 'markdown' },
  build = function () vim.fn['mkdp#util#install']() end,
  config = function ()
    require('which-key').add({
      { '<leader>m', group = 'Markdown' },
      { '<leader>mp', ':MarkdownPreviewToggle<CR>', desc = 'Markdown Preview' },
      { '<leader>ms', ':MarkdownPreviewStop<CR>', desc = 'Stop Preview' },
    })
  end
}
