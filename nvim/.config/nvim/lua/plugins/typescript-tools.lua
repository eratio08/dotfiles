return {
  'pmizio/typescript-tools.nvim',
  dependencies = { 'nvim-lua/plenary.nvim', 'neovim/nvim-lspconfig' },
  opts = {},
  ft = { 'javascript', 'javascriptreact', 'typescript', 'typescriptreact', 'vue' },
  config = function ()
    require('typescript-tools').setup {
      on_attach = function (client, bufnr)
        client.server_capabilities.documentFormattingProvider = false
        client.server_capabilities.documentRangeFormattingProvider = false
      end,
      filetypes = {
        'javascript',
        'javascriptreact',
        'typescript',
        'typescriptreact',
        'vue',
      },
      settings = {
        tsserver_plugins = {
          -- requires: npm i -g @vue/typescript-plugin
          '@vue/typescript-plugin',
        },
        jsx_close_tag = {
          enable = true,
          filetypes = { 'javascriptreact', 'typescriptreact' },
        },
      },
    }
  end,
}
