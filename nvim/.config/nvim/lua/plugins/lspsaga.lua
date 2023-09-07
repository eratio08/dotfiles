return {
  'nvimdev/lspsaga.nvim',
  cmd = 'Lspsaga',
  dependencies = {
    { 'nvim-treesitter/nvim-treesitter' },
    { 'nvim-tree/nvim-web-devicons', name = 'nvim-tree-nvim-web-devicons' },
    { 'folke/which-key.nvim' },
  },
  config = function ()
    require('lspsaga').setup({
      lightbulb = {
        enable = false,
      },
      outline = {
        win_position = 'left',
        win_width = 50,
      },
      rename = {
        keys = {
          quit = '<esc>',
          exec = '<CR>',
          select = '<space>',
        },
      }
    })
  end,
}
