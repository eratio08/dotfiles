-- Vim settings

local cmd = vim.cmd  -- to execute Vim commands e.g. cmd('pwd')
cmd('colorscheme nord') -- narcticicestudio/nord-vim
cmd('syntax on') -- enabled syntax highlighting

local opt = vim.opt  -- to set options
opt.tabstop = 2 -- set tab width to 2 spaces
opt.softtabstop = 2 -- spaces inserted for a tab
opt.shiftwidth = 2 -- indentation width to 2 spaces
opt.expandtab = true -- replace tabs with spaces on insert
opt.cmdheight = 1 -- height of the message line at the bottom
opt.laststatus = 2 -- for lightline
opt.updatetime = 50 -- time until vim updates the frame, time for combined commands
opt.shortmess:append('c') -- don't give |ins-completion-menu| messages
opt.signcolumn = 'yes' -- always show sign columns
opt.number = true -- show line numbers
opt.relativenumber = true -- enable relative line numbers
opt.swapfile = false -- disable swap files
opt.backup = false -- no backup files
opt.hlsearch = true -- highlight all search results
opt.writebackup = false -- turn of backup when overwriting files
-- opt.nohlsearch = true -- turn off highlight search
opt.errorbells = false -- disable the error bells
opt.wrap = false -- disable wrapping
opt.ignorecase = true -- search case insensitive by default
opt.smartcase = true -- if capital letter is used be case sensitive
opt.incsearch = true -- sow search results immediately
opt.spell = true -- set spell checking language to en_us
opt.spelllang = 'en_us'
opt.smartindent = true -- enable auto indentation on next line
opt.path:append('**') -- enable vim-native fuzzy find
opt.wildmenu = true -- enable wild match window
opt.wildmode = { 'longest', 'list', 'full' } -- Nice menu when typing `:find *.py`
opt.wildignore:append('*.pyc') -- Ignore files when wild card matching
opt.wildignore:append('*_build/*')
opt.wildignore:append('**/coverage/*')
opt.wildignore:append('**/node_modules/*')
opt.wildignore:append('**/android/*')
opt.wildignore:append('**/ios/*')
opt.wildignore:append('**/.git/*')
opt.hidden = true -- keep buffers on navigation
opt.background = 'dark' -- opt.background color brightness
opt.undofile = true -- enable undo file
opt.undodir = '~/.vim/undodir' -- opt.undo file location
opt.scrolloff = 10 --- opt.undo file location- add scroll offset
opt.colorcolumn = { 80, 120 } -- vertical marker at column
opt.list = true -- show invisible characters
opt.listchars = 'tab:▸\\ ,space:·'
opt.guicursor = '' -- disable cursor styles
opt.termguicolors = true -- enable termguicolors
opt.isfname:append('@-@') -- opt.how files names are displayed
opt.mouse = 'a' -- enable mouse support for all modes
opt.splitright = true -- horizontal split windows to the right
opt.splitbelow = true -- vertical split windows to below
opt.diffopt:append('vertical') -- diff windows split to vertical
opt.completeopt = 'menuone' -- show auto completion menu even for single item
opt.splitright = true
