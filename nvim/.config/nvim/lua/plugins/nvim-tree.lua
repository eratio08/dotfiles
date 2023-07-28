return {
  'nvim-tree/nvim-tree.lua',
  dependencies = {
    { 'nvim-tree/nvim-web-devicons', name = 'nvim-tree-nvim-web-devicons' },
  },
  config = function ()
    local nvim_tree = require('nvim-tree')

    nvim_tree.setup({
      disable_netrw = false,
      hijack_netrw = false,
      filters = {
        custom = {
          '^.git$' }
      },
      git = {
        ignore = false,
      },
      renderer = {
        highlight_git = true,
        icons = {
          git_placement = 'after',
          show = {
            git = true,
          },
          glyphs = {
            git = {
              unstaged = 'M',
              staged = 'S',
              unmerged = '',
              renamed = 'R',
              untracked = 'U',
              deleted = 'D',
              ignored = '',
            }
          },
        },
      },
      hijack_directories = {
        enable = false,
        auto_open = false,
      },
    })

    vim.api.nvim_set_hl(0, 'NvimTreeFileIgnored', {
      fg = '#6e6a86',
    })
  end
}
