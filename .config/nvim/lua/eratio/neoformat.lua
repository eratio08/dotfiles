-- sbdchd/neoformat

if vim.g.plugs['neoformat'] then

local map = require('eratio/utils').map

-- set format command mapping
map('n', '<Space>cff', ':Neoformat<CR>')

-- auto format on save
-- local augroup = require('eratio/utils').augroup
-- augroup({{ 'BufWritePre', '*', 'undojoin | Neoformat' }}, 'fmt')

end
