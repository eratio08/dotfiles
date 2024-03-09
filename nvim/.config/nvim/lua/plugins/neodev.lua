return {
  'folke/neodev.nvim',
  ft = 'lua',
  dependencies = {
    'rcarriga/nvim-dap-ui',
  },
  config = function ()
    require('neodev').setup({
      library = {
        plugins = { 'nvim-dap-ui' },
        types = true
      },
    })
    -- required LSP config is done zero-lsp
  end
}
