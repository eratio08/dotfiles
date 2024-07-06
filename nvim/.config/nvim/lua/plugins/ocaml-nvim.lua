return {
  'tjdevries/ocaml.nvim',
  event = 'VeryLazy',
  config = function ()
    require('ocaml').setup()
  end,
}
