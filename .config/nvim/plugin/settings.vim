" Maintainer: Eike Lurz <moin@elurz.de>

" inspired by https://github.com/awesome-streamers/awesome-streamerrc/tree/master/ThePrimeagen
" set tab width to 2 spaces
set tabstop=2
" spaces inserted for a tab
set softtabstop=2
" set indentation width to 2 spaces
set shiftwidth=2
" replace tabs with spaces on insert
set expandtab
" improve message display
set cmdheight=1
" for lightline
set laststatus=2
" time until vim upfates the frame
set updatetime=100
" don't give |ins-completion-menu| messages.
set shortmess+=c
" always show sign columns
set signcolumn=yes
" enabled syntax highlighting
syntax on
" show line numbers
set number
" enable relative line numbers
set relativenumber
" disable swap files
set noswapfile
" highlight all search results
set hlsearch
" search case insensitive by default
set ignorecase
" if capital letter is used be case sensitive
set smartcase
" sow search results immediately
set incsearch
" set spell checking language to en_us
set spell spelllang=en_us ",de_de
" enable auto indentation on next line
set smartindent
" enable vim-native fuzzy find
set path+=**
" enable wild match window
set wildmenu
" keep buffers on navigation
set hidden
" set background color brightness
set background=dark
" enable undo file
set undofile
" set undo file location
set undodir=~/.vim/undodir
" add scroll offset
set scrolloff=10
" vertical marker at column
set colorcolumn=80,100,120
" show invisible characters
set list listchars=tab:▸\ ,space:·

" inspired by https://github.com/David-Kunz/vim
" show auto completion menu even for single item
set completeopt=menuone,noinsert ",noselect
" enable mouse support for all modes
set mouse=a
" horizontal split windows to the right
set splitright
" vertical split windows to below
set splitbelow
" diff windows split to vertical
set diffopt+=vertical
" turn of backup file
set nobackup
" turn of backup when overwriting files
set nowritebackup
"enable syntax highlight for snippets
let g:markdown_fenced_languages = ['javascript', 'js=javascript', 'json=javascript']
