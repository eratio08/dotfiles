return {
  enabled = false,
  'ray-x/lsp_signature.nvim',
  event = 'VeryLazy',
  opts = {},
  config = function (_, opts)
    require('lsp_signature').setup(opts)
  end
}
