return {
  'echasnovski/mini.trailspace',
  version = '*',
  dependencies = {
    { 'echasnovski/mini.nvim', version = '*' }
  },
  event = 'BufEnter',
  config = function ()
    require('mini.trailspace').setup({
      only_in_normal_buffers = false
    })
  end
}
