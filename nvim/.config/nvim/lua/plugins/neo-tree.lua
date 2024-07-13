return {
  'nvim-neo-tree/neo-tree.nvim',
  branch = 'v3.x',
  lazy = false,
  dependencies = {
    'nvim-lua/plenary.nvim',
    { 'nvim-tree/nvim-web-devicons', name = 'nvim-tree-nvim-web-devicons' },
    'MunifTanjim/nui.nvim',
    'folke/which-key.nvim',
  },
  config = function ()
    require('neo-tree').setup({
      close_if_last_window = true,
      window = {
        auto_expand_width = true,
        width = math.floor(vim.o.columns * 0.1),
        mappings = {
          ['s'] = 'open_split',
          ['v'] = 'open_vsplit',
        },
      },
      filesystem = {
        hijack_netrw_behavior = 'open_current',
        filtered_items = {
          visible = false,
        },
        follow_current_file = {
          enabled = true,
          leave_dirs_open = true,
        },
      },
    })

    require('which-key').add({
      { '<leader>e', ':Neotree toggle<CR>', desc = 'Toggle Neotree' }
    })
  end
}
