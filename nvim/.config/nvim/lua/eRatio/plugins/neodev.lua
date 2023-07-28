return {
  'folke/neodev.nvim',
  dependencies = {
    { 'VonHeikemen/lsp-zero.nvim' },
  },
  config = function ()
    local neodev = require('neodev')
    neodev.setup()

    local lsp = require('lsp-zero')
    lsp.configure('lua_ls', {
      settings = {
        Lua = {
          completion = {
            callSnippet = 'Replace'
          }
        }
      }
    })
  end
}
