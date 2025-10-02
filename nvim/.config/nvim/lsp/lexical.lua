return {
  root_dir = function (fname)
    return require('lspconfig.util').root_pattern('mix.exs', '.git')(fname) or vim.uv.cwd()
  end,
  filetypes = { 'elixir', 'eelixir', 'heex' },
  settings = {}
}
