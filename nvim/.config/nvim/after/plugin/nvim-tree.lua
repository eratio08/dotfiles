local nvim_tree = require('nvim-tree')

nvim_tree.setup({
  disable_netrw = false,
  hijack_netrw = false,
  git = {
    ignore = false,
  },
  renderer = {
    highlight_git = true,
  }
})

vim.api.nvim_set_hl(0, 'NvimTreeFileIgnored', {
  fg = '#6e6a86',
})
