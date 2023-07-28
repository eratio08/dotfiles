return {
  'b0o/schemastore.nvim',
  dependencies = {
    { 'neovim/nvim-lspconfig' },
  },
  config = function ()
    local lspconfig = require('lspconfig')

    lspconfig.jsonls.setup {
      settings = {
        json = {
          schemas = require('schemastore').json.schemas(),
          validate = { enable = true },
        },
      },
    }

    lspconfig.yamlls.setup {
      settings = {
        yaml = {
          schemas = require('schemastore').yaml.schemas(),
        },
      },
    }
  end
}
