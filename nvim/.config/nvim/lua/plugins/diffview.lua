return {
  enabled = false,
  'sindrets/diffview.nvim',
  cmd = { 'DiffviewOpen', 'DiffviewFileHistory' },
  dependencies = {
    'nvim-tree/nvim-web-devicons',
  },
  config = function ()
    require('diffview').setup()
  end
}
