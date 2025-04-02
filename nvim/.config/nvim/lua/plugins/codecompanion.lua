return {
  enabled = true,
  'olimorris/codecompanion.nvim',
  dependencies = {
    'nvim-lua/plenary.nvim',
    'nvim-treesitter/nvim-treesitter',
  },
  cmd = { 'CodeCompanionChat' },
  keys = {
    { '<leader>cc', ':CodeCompanionChat Toggle<CR>', desc = 'Toggle CodeCompanionChat' },
    { '<leader>cq', ':CodeCompanion', desc = 'Inline CodeCompanion' },
    { '<leader>cm', ':CodeCompanionCmd<CR>', desc = 'CodeCompanion Commands' },
    -- :CodeCompanion
  },
  config = true,
  opts = {},
}
