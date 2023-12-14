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
      code_actions = {
        enable = false,
      },
      definition = {
        enable = true,
      },
      finder = {
        enable = false,
      },
      outline = {
        win_position = 'right',
        win_width = 30,
      },
      rename = {
        enable = false,
        is_select = false,
        keys = {
          quit = '<esc>',
          exec = '<CR>',
          select = '<space>',
        },
      }
    })
  end,
}
