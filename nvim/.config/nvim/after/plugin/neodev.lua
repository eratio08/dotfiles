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
