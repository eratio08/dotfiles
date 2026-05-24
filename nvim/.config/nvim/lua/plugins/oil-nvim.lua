return {
  enabled = false,
  lazy = false,
  'stevearc/oil.nvim',
  dependencies = { 'nvim-tree/nvim-web-devicons' },
  opts = {},
  config = function (_, opts)
    require('oil').setup(opts)
  end,
}
