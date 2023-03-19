local lsp = require('lsp-zero')
local null_ls = require('null-ls')
local null_opts = lsp.build_options('null-ls', {})

null_ls.setup({
  on_attach = function (client, bufnr)
    null_opts.on_attach(client, bufnr)
  end,
  sources = {
    -- code actions
    null_ls.builtins.code_actions.shellcheck,
    null_ls.builtins.code_actions.gitsigns,

    -- completion
    null_ls.builtins.completion.spell,

    -- diagnostics
    null_ls.builtins.diagnostics.codespell,
    null_ls.builtins.diagnostics.gitlint,
    null_ls.builtins.diagnostics.shellcheck,

    -- formatting
    null_ls.builtins.formatting.codespell,
  }
})

require('mason-null-ls').setup({
  automatic_installation = true,
  automatic_setup = false,
})
