return {
  'b0o/schemastore.nvim',
  lazy = false,
  dependencies = {
    { 'neovim/nvim-lspconfig' },
  },
  config = function ()
    local schemastore = require('schemastore')
    local lspconfig = require('lspconfig')
    lspconfig.jsonls.setup({
      settings = {
        json = {
          schemas = schemastore.json.schemas(),
          validate = { enable = true },
        },
      },
    })

    lspconfig.yamlls.setup({
      settings = {
        yaml = {
          schemaStore = {
            -- You must disable built-in schemaStore support if you want to use
            -- this plugin and its advanced options like `ignore`.
            enable = false,
            -- Avoid TypeError: Cannot read properties of undefined (reading 'length')
            url = '',
          },
          schemas = schemastore.yaml.schemas(),
        },
      },
    })
  end
}
