-- sbdchd/neoformat
if not vim.g.plugs['neoformat'] then
  return
end

local map = require('eratio/utils').map

-- set format command mapping
map('n', '<Space>cff', ':Neoformat<CR>')

-- auto format on save
-- local augroup = require('eratio/utils').augroup
-- augroup({{ 'BufWritePre', '*', 'undojoin | Neoformat' }}, 'fmt')
