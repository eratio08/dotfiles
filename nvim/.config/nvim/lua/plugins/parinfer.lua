return {
  'gpanders/nvim-parinfer',
  ft = { 'dune' },
  config = function ()
    vim.g.parinfer_filetypes = {
      'dune',
      'scheme',
      'query',
    }
  end,
}
