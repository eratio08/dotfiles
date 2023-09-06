return {
  'sindrets/diffview.nvim',
  dependencies = {
    { 'nvim-tree/nvim-web-devicons', name ='nvim-tree-nvim-web-devicons' }
  },
  config = function ()
    require('diffview').setup()
  end
}
