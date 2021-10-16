-- Vim mappings

local map = require('eratio/utils').map

map('c', 'HR', 'vert bo h') -- open help in vertical split
map('n', '<space>s', '1z=') -- replace spelling mistake with first match
map('n', '<space>pv', ':wincmd v<bar> :Ex <bar> :vertical resize 30<CR>') -- open explorer in vertical split
map('c', '%%', '<C-R>=fnameescape(expand(\'%:h\')).\'/\'<CR>') -- open to edit helpers - expand %% to current working directory
map('n', '<space>ew', ':e %%') -- edit in new window
map('n', '<space>es', ':sp %%') -- edit in new split
map('n', '<space>ev', ':vsp %%') -- edit in new vertical split
map('n', '<space>et', ':tabe %%') -- edit in new tab
map('n', '<space>wh', '<C-w>h') -- select left window
map('n', '<space>wj', '<C-w>j') -- select down window
map('n', '<space>wk', '<C-w>k') -- select up window
map('n', '<space>wl', '<C-w>l') -- select right window
map('n', '<space>,', ':tabedit $MYVIMRC<CR>') -- edit vimrc
map('n', '<space>src', ':source $MYVIMRC<CR>') -- source vimrc
-- move single line down
map('n', '<A-j>', 'ddp')
map('v', '<A-j>', 'xp`[V`]')
-- move single line up
map('n', '<A-k>', 'ddkP')
map('v', '<A-k>', 'xkP`[V`]')
-- disable arrow keys
map('n', '<Up>', '<Nop>')
map('n', '<Down>', '<Nop>')
map('n', '<Left>', '<Nop>')
map('n', '<Right>', '<Nop>')
