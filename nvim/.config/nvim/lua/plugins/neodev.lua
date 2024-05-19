return {
  'folke/neodev.nvim',
  ft = 'lua',
  dependencies = {
    'rcarriga/nvim-dap-ui',
  },
  config = function ()
    require('neodev').setup()
    -- required LSP config is done zero-lsp
  end
}
