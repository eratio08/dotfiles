vim.opt.tabstop        = 2                                 -- set tab width to 2 spaces
vim.opt.softtabstop    = 2                                 -- spaces inserted for a tab
vim.opt.shiftwidth     = 2                                 -- indentation width to 2 spaces
vim.opt.expandtab      = true                              -- replace tabs with spaces on insert
vim.opt.cmdheight      = 1                                 -- height of the message line at the bottom
vim.opt.updatetime     = 250                               -- time until vim updates the frame, time for combined commands
vim.wo.signcolumn      = 'yes'                             -- always show sign columns
vim.wo.number          = true                              -- show line numbers
vim.opt.relativenumber = true                              -- enable relative line numbers
vim.opt.swapfile       = false                             -- disable swap files
vim.opt.backup         = false                             -- no backup files
vim.opt.writebackup    = false                             -- turn of backup when overwriting files
vim.opt.errorbells     = false                             -- disable the error bells
vim.opt.wrap           = true                              -- wrapping
vim.o.breakindent      = true                              -- indent wrapped lines
vim.opt.ignorecase     = true                              -- search case insensitive by default
vim.opt.smartcase      = true                              -- if capital letter is used be case sensitive
vim.opt.hlsearch       = false                             -- highlight all search results
vim.opt.incsearch      = true                              -- sow search results immediately
vim.opt.spell          = true                              -- set spell checking language to en_us
vim.opt.spelllang      = 'en_us'
vim.opt.smartindent    = true                              -- enable auto indentation on next line
vim.opt.wildmenu       = true                              -- enable wild match window
vim.opt.wildmode       = { 'longest', 'list', 'full' }     -- Nice menu when typing `:find ...`
vim.opt.hidden         = true                              -- keep buffers on navigation
vim.opt.background     = 'dark'                            -- opt.background color brightness
vim.opt.undofile       = true                              -- enable undo file
vim.opt.scrolloff      = 15                                --- opt.undo file location- add scroll offset
vim.opt.colorcolumn    = { 80, 120 }                       -- vertical marker at column
vim.opt.list           = true                              -- show invisible characters
vim.opt.listchars      = 'tab:▹  ,space:·,eol:⏎,trail:_'
vim.opt.guicursor      = ''                                -- disable cursor styles
vim.opt.termguicolors  = true                              -- disable to prevent tmux overlay
vim.opt.splitright     = true                              -- horizontal split windows to the right
vim.opt.splitbelow     = true                              -- vertical split windows to below
vim.opt.fixendofline   = true
vim.opt.mouse          = 'a'                               -- enable mouse support for all modes
vim.opt.completeopt    = { 'menu', 'menuone', 'noselect' } -- show auto completion menu even for single item
vim.opt.shada          = { '!', "'1000", '<50', 's10' }    -- set shared data saving, global upper case variables, 1000 marks, 50 lines per register, max 10KiB
vim.g.do_filetype_lua  = 1
vim.opt.shortmess:append('c')                              -- don't give |ins-completion-menu| messages
vim.opt.path:append('**')                                  -- enable vim-native fuzzy find
vim.opt.isfname:append('@-@')                              -- how files names are displayed
vim.opt.diffopt:append('vertical')                         -- diff windows split to vertical
vim.opt.wildignore:append({
  '*.pyc',
  '*_build/*',
  '**/coverage/*',
  '**/node_modules/*',
  '**/.git/*',
}) -- Ignore files when wild card matching

-- fold settings
vim.opt.foldmethod        = 'manual' -- how to fold
vim.opt.foldenable        = true     -- unfold all by default
vim.opt.foldcolumn        = '1'      -- '0' is not bad
vim.opt.foldlevel         = 99       -- Using ufo provider need a large value, feel free to decrease the value
vim.opt.foldlevelstart    = 99

-- Netrw Settings
vim.g.netrw_liststyle     = 3  -- open netrw in tree mode
vim.g.netrw_banner        = 1  -- remove banner from netrw
vim.g.netrw_browser_split = 0  -- reuse current window when opening netrw
-- vim.g.netrw_browse_split = 4 -- keep netrw open
vim.g.netrw_winsize       = 25 -- set initial windows size
vim.g.netrw_altv          = 1  -- view on the left
-- vim.g.netrw_localrndir = 'rm -r' -- set command used for directory rm
-- vim.g.loaded_netrw        = 1
-- vim.g.loaded_netrwPlugin  = 1

vim.opt.laststatus        = 3 -- 3 mean global status lines
