return {
  'echasnovski/mini.trailspace',
  version = '*',
  dependencies = {
    { 'echasnovski/mini.nvim', version = '*' }
  },
  event = 'VeryLazy',
  config = function ()
    require('mini.trailspace').setup({
      only_in_normal_buffers = true
    })
  end
}
