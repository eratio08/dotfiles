return {
  enabled = false,
  'stevearc/dressing.nvim',
  event = 'VeryLazy',
  config = function ()
    require('dressing').setup()
  end
}
