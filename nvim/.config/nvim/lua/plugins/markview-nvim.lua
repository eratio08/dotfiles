return {
  enabled = true,
  'OXY2DEV/markview.nvim',
  keys = {
    { '<leader>mv', ':Markview toggle<CR>', desc = 'View Markdown' },
  },
  ft = { 'markdown' },
  ---@type mkv.config
  ops = {
    -- Requires `:TSInstall markdown markdown_inline html latex typst yaml`
    preview = {
      icon_provider = 'devicons',
    },
  },
}
