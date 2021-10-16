local g = vim.g

-- enable native netrw plugin
vim.cmd('filetype plugin indent on')

g.netrw_liststyle = 3 -- open netrw in tree mode
g.netrw_banner = 0 -- remove banner from netrw
g.netrw_browser_split = 0 -- reuse curent window when opening netrw
-- g.netrw_browse_split = 4 -- keep netrw open
g.netrw_winsize = 25 -- set initial windows size
g.netrw_altv = 1 -- view on the left
-- g.netrw_localrndir = 'rm -r' -- set command used for directory rm

-- open netrw on new buffer
-- local augroup = require('eratio.utils').augroup
-- augroup({{ 'VimEnter', '*', ':Vexplore' }}, 'ProjectDrawer')
