-- tpope/vim-fugitive

if vim.g.plugs['vim-fugitive'] then

local map = require('eratio/utils').map

map('n', '<Space>gg', ':G<CR>') -- show the git status

end
