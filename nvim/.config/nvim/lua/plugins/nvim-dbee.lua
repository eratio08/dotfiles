return {
  'kndndrj/nvim-dbee',
  cmd = 'Dbee',
  dependencies = {
    'MunifTanjim/nui.nvim',
  },
  build = function ()
    require('dbee').install('go')
  end,
  config = function ()
    require('dbee').setup()
  end,
}
