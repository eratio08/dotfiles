return {
  'folke/neodev.nvim',
  ft = 'lua',
  dependencies = {
    'neovim/nvim-lspconfig',
  },
  config = function ()
    require('neodev').setup()

    require('lspconfig').lua_ls.setup({
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
