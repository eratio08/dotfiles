-- nvim-telescope/telescope.nvim

local g = vim.g
if g.plugs["telescope.nvim"] then

local map = require('eratio/utils').map

map('n', '<Space>ff', '<cmd>Telescope find_files<cr>')
map('n', '<Space>fg', '<cmd>Telescope live_grep<cr>')
map('n', '<Space>fb', '<cmd>Telescope buffers<cr>')
map('n', '<Space>fh', '<cmd>Telescope help_tags<cr>')

require('telescope').setup {
  extensions = {
    fzf = {
      fuzzy = true, -- false will only do exact matching
      override_generic_sorter = true,
      override_file_sorter = true,
      case_mode = "smart_case",
    }
  },
  defaults = {
    -- defaults here
  }
}

-- load fzf
require('telescope').load_extension('fzf')

end
