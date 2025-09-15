return {
  enabled = true,
  'tjdevries/ocaml.nvim',
  ft = { 'ml', 'mlx', 'dune' },
  config = function ()
    require('ocaml').setup()
  end,
}
