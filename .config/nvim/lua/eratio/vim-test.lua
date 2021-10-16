-- janko/vim-test

if vim.g.plugs['vim-test'] then

local map = require('eratio/utils').map

map('n', 'tt', ':TestNearest<CR>')
map('n', 'tf', ':TestFile<CR>')
map('n', 'ts', ':TestSuite<CR>')
map('n', 't_', ':TestLast<CR>')

-- work around to set config
vim.cmd('let g:test = {}')
local tmp = vim.g.test

-- settings
tmp.strategy = 'neovim'
tmp.neovim = 'vertical'

vim.g.test = tmp

end
