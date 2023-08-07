return {
  'nvim-neo-tree/neo-tree.nvim',
  branch = 'v3.x',
  dependencies = {
    { 'nvim-lua/plenary.nvim' },
    { 'nvim-tree/nvim-web-devicons', name = 'nvim-tree-nvim-web-devicons' },
    { 'MunifTanjim/nui.nvim' },
    { 'folke/which-key.nvim' },
  },
  config = function ()
    require('neo-tree').setup({
      window = {
        width = 30,
        mappings = {
          ['s'] = 'open_split',
          ['v'] = 'open_vsplit',
        }
      },
      filesystem = {
        filtered_items = {
          visible = false,
        }
      }
    })

    local wk = require('which-key')
    wk.register({
      ['<leader>'] = {
        e = { ':Neotree toggle<CR>', 'Toggle Neotree' },
      },
    })
  end
}
