return {
  'echasnovski/mini.surround',
  version = '*',
  keys = { 'sa', 'sd', 'sr', 'sf', 'sF', 'sh' },
  config = function ()
    require('mini.surround').setup()
  end
}
