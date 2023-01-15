local lsp = require('lsp-zero')
local null_ls = require('null-ls')
local null_opts = lsp.build_options('null-ls', {})

null_ls.setup({
  on_attach = function(client, bufnr)
    null_opts.on_attach(client, bufnr)
  end,
  sources = {
    null_ls.builtins.code_actions.shellcheck,
    null_ls.builtins.completion.luasnip,
    null_ls.builtins.completion.spell,
    null_ls.builtins.diagnostics.codespell,
    null_ls.builtins.formatting.codespell,
    null_ls.builtins.diagnostics.eslint_d,
    null_ls.builtins.formatting.eslint_d,
    null_ls.builtins.diagnostics.gitlint,
    -- null_ls.builtins.diagnostics.luacheck,
  }
})

require('mason-null-ls').setup({
  ensure_installed = { 'shellcheck', 'codespell', 'gitlint' },
  automatic_installation = true,
  automatic_setup = false,
})
