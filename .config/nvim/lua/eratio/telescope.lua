-- nvim-telescope/telescope.nvim

local g = vim.g
if g.plugs["telescope.nvim"] then

local map = require('eratio/utils').map

-- find in files or buffer
map('n', '<Space>ff', ':Telescope find_files<CR>')
map('n', '<Space>fg', ':Telescope live_grep<CR>')
map('n', '<Space>fb', ':Telescope buffers<CR>')

-- find in vim
map('n', '<Space>fh', ':Telescope help_tags<CR>')
map('n', '<Space>fvo', ': Telescope vim_options<CR>')
map('n', '<Space>fcm', ': Telescope commands<CR>')

local telescope = require('telescope')

telescope.setup {
  extensions = {
    fzy_native = {
      override_generic_sorter = false,
      override_file_sorter = true,
    }
  },
  defaults = {
    -- setting here
    prompt_prefix = ' >',
    color_devicons = true,
  }
}

-- load native fyz plugin
telescope.load_extension('fzy_native')

end
