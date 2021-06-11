" Maintainer: Eike Lurz <moin@elurz.de>

" inspired by https://github.com/awesome-streamers/awesome-streamerrc/tree/master/ThePrimeagen
" set tab width to 2 spaces
setlocal tabstop=2
" spaces inserted for a tab
setlocal softtabstop=2
" set indentation width to 2 spaces
setlocal shiftwidth=2
" replace tabs with spaces on insert
setlocal expandtab
" improve message display
setlocal cmdheight=1
" for lightline
set laststatus=2
" time to input command
setlocal updatetime=300
" don't give |ins-completion-menu| messages.
setlocal shortmess+=c
" always show sign columns
setlocal signcolumn=yes
" enabled syntax highlighting
syntax on
" show line numbers
setlocal number
" enable relative line numbers
setlocal relativenumber
" disable swap files
setlocal noswapfile
" highlight all search results
setlocal hlsearch
" search case insensitive by default
setlocal ignorecase
" if capital letter is used be case sensitive
setlocal smartcase
" sow search results immediately
setlocal incsearch
" set spell checking language to en_us
setlocal spell spelllang=en_us ",de_de
" enable auto indentation on next line
setlocal smartindent
" enable vim-native fuzzy find
setlocal path+=**
" enable wild match window
setlocal wildmenu
" keep buffers on navigation
setlocal hidden
" set background color brightness
setlocal background=dark
" enable undo file
setlocal undofile
" set undo file location
setlocal undodir=~/.vim/undodir
" add scroll offset
setlocal scrolloff=10
" vertical marker at column
setlocal colorcolumn=80,100,120
" show invisible characters
setlocal list listchars=tab:▸\ ,space:·

" inspired by https://github.com/David-Kunz/vim
" show auto completion menu even for single item
setlocal completeopt=menuone
" enable mouse support for all modes
setlocal mouse=a
" horizontal split windows to the right
setlocal splitright
" vertical split windows to below
setlocal splitbelow
" diff windows split to vertical
setlocal diffopt+=vertical
" turn of backup file
setlocal nobackup
" turn of backup when overwriting files
setlocal nowritebackup
"enable syntax highlight for snippets
let g:markdown_fenced_languages = ['javascript', 'js=javascript', 'json=javascript']


" Plugins
" enable native netrw plugin
filetype plugin indent on
" open netrw in tree mode
let g:netrw_liststyle = 3
" remove banner from netrw
let g:netrw_banner=0

" Install vim-plug if not found
let data_dir = has('nvim') ? stdpath('data') . '/site' : '~/.vim'
if empty(glob(data_dir . '/autoload/plug.vim'))
  silent execute '!curl -fLo '.data_dir.'/autoload/plug.vim --create-dirs  https://raw.githubusercontent.com/junegunn/vim-plug/master/plug.vim'
  autocmd VimEnter * PlugInstall --sync | source $MYVIMRC
endif

" Run PlugInstall if there are missing plugins
autocmd VimEnter * if len(filter(values(g:plugs), '!isdirectory(v:val.dir)'))
  \| PlugInstall --sync | source $MYVIMRC
\| endif

call plug#begin('~/.vim/plugged')
  Plug 'junegunn/fzf'
  Plug 'junegunn/fzf.vim'
  Plug 'sheerun/vim-polyglot'
  Plug 'itchyny/lightline.vim'
  Plug 'itchyny/vim-gitbranch'
  Plug 'arcticicestudio/nord-vim'
  Plug 'rust-lang/rust.vim'
  Plug 'szw/vim-maximizer'
  Plug 'kassio/neoterm'
  Plug 'tpope/vim-commentary'
  Plug 'tpope/vim-fugitive'
  Plug 'airblade/vim-gitgutter'
  Plug 'sbdchd/neoformat'
  Plug 'neovim/nvim-lspconfig'
  Plug 'nvim-lua/completion-nvim'
  Plug 'vim-test/vim-test'
call plug#end()

" lightline
let g:lightline = {}
let g:lightline.colorscheme = 'wombat'
let g:lightline.component_function = {
      \   'gitbranch': 'gitbranch#name'
      \ }
let g:lightline.active = {
      \   'left': [
      \     ['mode'],
      \     ['gitbranch'],
      \     ['filename']
      \   ],
      \   'right': [
      \     ['readonly', 'modified'],
      \     ['fileencoding'],
      \     ['lineinfo'],
      \     ['percent']
      \   ],
      \ }

" rust-lang/rust.vim
let g:rustfmt_autosave = 1

" narcticicestudio/nord-vim
colorscheme nord

" szw/vim-maximizer
noremap <leader>m :MaximizerToggle!<CR>

" kassio/neoterm
let g:neoterm_default_mod = 'vertical'
let g:neoterm_size = 60
let g:neoterm_autoinsert = 1
nnoremap <C-q> :Ttoggle<CR>
inoremap <C-q> <Esc>:Ttoggle<CR>
tnoremap <C-q> <C-\><C-n>:Ttoggle<CR>

" sbdchd/neoformat
nnoremap <leader>F :Neoformat<CR>

" junegunn/fzf.vim
nnoremap <leader><space> :GFiles<CR>
nnoremap <leader>ff :Rg<CR>
inoremap <expr> <C-x><C-f> fzf#vim#complete#path(
  \ "find . -path '*/\.*' -prune -o -print \| sed '1d;s:^..::'",
  \ fzf#wrap({'dir': expand('%:p:h')})
  \ )
if has('nvim')
  au! TermOpen * tnoremap <buffer> <Esc> <C-\><C-n>
  au! FileType fzf tunmap <buffer> <Esc>
endif

" neovim/nvim-lspconfig
nnoremap <silent> gd <CMD>lua vim.lsp.buf.definition()<CR>
nnoremap <silent> gh <CMD>lua vim.lsp.buf.hover()<CR>
nnoremap <silent> gH <CMD>lua vim.lsp.buf.code_action()<CR>
nnoremap <silent> gD <CMD>lua vim.lsp.buf.implementation<CR>
nnoremap <silent> <C-k> <CMD>lua vim.lsp.buf.signature_help()<CR>
nnoremap <silent> gr <CMD>lua vim.lsp.buf.references()<CR>
nnoremap <silent> gR <CMD>lua vim.lsp.buf.rename()<CR>

" nvim-lua/completion-nvim
" Use completion-nvim in every buffer
autocmd BufEnter * lua require'completion'.on_attach()
" Use <Tab> and <S-Tab> to navigate through popup menu
inoremap <expr> <Tab>   pumvisible() ? "\<C-n>" : "\<Tab>"
inoremap <expr> <S-Tab> pumvisible() ? "\<C-p>" : "\<S-Tab>"
"map <c-p> to manually trigger completion
imap <silent> <C-Space> <Plug>(completion_trigger)

" Other Mappings
" use 'sed -n l' if binding behave strangely to see actual codes send by terminal

" map leader to <space>
let mapleader = " "
" bind fuzzy search
nnoremap <silent> <C-p> :<C-u>FZF<CR>
" replace spelling mistake with first match
nnoremap <silent> <leader>f 1z=
" toggle spelling
nnoremap <silent> <leader>s :set spell!
" buffer navigation bindings
nnoremap <silent> [b :bprevious<CR>
nnoremap <silent> ]b :bnext<CR>
nnoremap <silent> [B :bfirst<CR>
nnoremap <silent> ]B :blast<CR>
" quickfix navigation
nnoremap <silent> [q :cprev<CR>
nnoremap <silent> ]q :cnext<CR>
nnoremap <silent> [Q :cfirst<CR>
nnoremap <silent> ]Q :clast<CR>
" open explorer in new vertical resized split
nnoremap <silent> <leader>pv :wincmd v<bar> :Ex <bar> :vertical resize 30<CR>
" open to edit helpers - expand %% to current working directory
cnoremap <silent> %% <C-R>=fnameescape(expand('%:h')).'/'<CR>
" edit in windows
noremap <silent> <leader>ew :e %%
" edit in split
noremap <silent> <leader>es :sp %%
" edit in vertical split
noremap <silent> <leader>ev :vsp %%
" edit in tab
noremap <silent> <leader>et :tabe %%
" improve window navigation
noremap <silent> <C-h> <C-w>h
noremap <silent> <C-j> <C-w>j
noremap <silent> <C-k> <C-w>k
noremap <silent> <C-l> <C-w>l
" edit vimrc in tab
nnoremap <silent> <leader>, :tabedit $MYVIMRC<CR>
" source vimrc
nnoremap <silent> <leader>src :source $MYVIMRC<CR>
" fix alt key mapping
map <Esc>h <A-h>
map <Esc>j <A-j>
map <Esc>k <A-k>
map <Esc>l <A-l>
" move single line down
nnoremap <A-j> ddp
vnoremap <A-j> xp`[V`]
" move single line up
nnoremap <A-k> ddkP
vnoremap <A-k> xkP`[V`]
" disable arrow keys in normal mode
noremap <Up> <Nop>
noremap <Down> <Nop>
noremap <Left> <Nop>
noremap <Right> <Nop>
