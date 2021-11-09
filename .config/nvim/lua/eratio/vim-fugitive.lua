-- tpope/vim-fugitive

if not vim.g.plugs['vim-fugitive'] then
  return
end

local map = require('eratio/utils').map

map('n', '<Space>gg', ':G<CR>') -- show the git status
