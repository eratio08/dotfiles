" Maintainer: Eike Lurz <moin@elurz.de>
"
" vimL settings
" set tab width to 2 spaces
setlocal tabstop=2
" spaces inserted for a tab
setlocal softtabstop=2
" set indentation width to 2 spaces
setlocal shiftwidth=2
" replace tabs with spaces on insert
setlocal expandtab
" improve message display
setlocal cmdheight=2
" for lightline
set laststatus=2
" decrease update time
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

" nvim settings
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
" enable term gui colors
"if (has("termguicolors"))
"  setlocal termguicolors
"endif

" Plugins

" enable native netrw plugin
filetype plugin indent on

" open netrw in tree mode
let g:netrw_liststyle = 3
" remove banner from netrw
let g:netrw_banner=0

" add minpac package manager
" https://github.com/k-takata/minpac.git
packadd minpac

if exists('g:loaded_minpac')
  call minpac#init()

  " helper command to update plugins
  command! PackUpdate call minpac#update()
  " helper command to cleanup plugins
  command! PackClean call minpac#clean()

  " add plugins
  call minpac#add('neoclide/coc.nvim', { 'branch': 'release' })
  "call minpac#add('dense-analysis/ale')
  call minpac#add('junegunn/fzf')
  call minpac#add('sheerun/vim-polyglot')
  call minpac#add('itchyny/lightline.vim')
  call minpac#add('itchyny/vim-gitbranch')
  "call minpac#add('vim-test/vim-test')
  call minpac#add('arcticicestudio/nord-vim')
  "call minpac#add('rust-lang/rust.vim')

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

  " coc configurations
  let g:coc_global_extensions = [
   "\ 'coc-tsserver',
    \ 'coc-json',
   "\ 'coc-eslint',
   "\ 'coc-prettier',
   "\ 'coc-jest',
   "\ 'coc-python',
   "\ 'coc-java',
   "\ 'coc-kotlin',
   "\ 'coc-pairs',
    \ 'coc-rust-analyzer'
    \ ]

  function! s:check_back_space() abort
    let col = col('.') - 1
    return !col || getline('.')[col - 1]  =~# '\s'
  endfunction

  " Use tab for trigger completion with characters ahead and navigate.
  " NOTE: Use command ':verbose imap <tab>' to make sure tab is not mapped by
  " other plugin before putting this into your config.
  inoremap <silent><expr> <TAB>
      \ pumvisible() ? "\<C-n>" :
      \ <SID>check_back_space() ? "\<TAB>" :
      \ coc#refresh()

  inoremap <expr><S-TAB> pumvisible() ? "\<C-p>" : "\<C-h>"

  " Use <c-space> to trigger completion.
  if has('nvim')
    inoremap <silent><expr> <c-space> coc#refresh()
  else
    inoremap <silent><expr> <c-@> coc#refresh()
  endif

  " Make <CR> auto-select the first completion item and notify coc.nvim to
  " format on enter, <cr> could be remapped by other vim plugin
  "inoremap <silent><expr> <cr> pumvisible() ? coc#_select_confirm()
  "                              \: "\C-g><u\<CR>\<c-r>=coc#on_enter()\<CR>"

  " Use K to show documentation in preview window.
  nnoremap <silent> K :call <SID>show_documentation()<CR>

  function! s:show_documentation()
    if (index(['vim','help'], &filetype) >= 0)
      execute 'h '.expand('<cword>')
    elseif (coc#rpc#ready())
      call CocActionAsync('doHover')
    else
      execute '!' . &keywordprg . " " . expand('<cword>')
    endif
  endfunction

  " Highlight the symbol and its references when holding the cursor.
  autocmd CursorHold * silent call CocActionAsync('highlight')

  " Symbol renaming.
  "nnoremap <leader>rn <Plug>(coc-rename)

  " Formatting selected code.
  "xnoremap <leader>f  <Plug>(coc-format-selected)
  nnoremap <leader>f <Plug>(coc-format-selected)

  " GoTo code navigation.
  nnoremap <silent> gd <Plug>(coc-definition)
  nnoremap <silent> gy <Plug>(coc-type-definition)
  nnoremap <silent> gi <Plug>(coc-implementation)
  nnoremap <silent> gr <Plug>(coc-references)

  nnoremap <silent> ga <Plug>(coc-codeaction)
  nnoremap <silent> gf <Plug>(coc-fix-current)
  nnoremap <silent> ge <Plug>(coc-diagnostic-next)
  nnoremap <silent> gE <Plug>(coc-diagnostic-prev)
  nnoremap <silent> GE <Plug>(coc-diagnostic-prev)
  "nnoremap <silent> gD <Plug>(coc-references)
  "nnoremap <silent> GD <Plug>(coc-references)
  nnoremap gr <Plug>(coc-refactor)
  nnoremap <silent> grf :CocCommand workspace.renameCurrentFile<CR>
  nnoremap <silent> gp <Plug>(coc-format)"

  nnoremap <S-p> :CocCommand<CR>

  " rust-vim
  let g:rustfmt_autosave = 1

  colorscheme nord

endif

" Mappings
" use 'sed -n l' if binding behave strangely to see actual
" codes send by terminal

" map leader to <space>
let mapleader = " "

" bind fuzzy search
nnoremap <silent> <C-p> :<C-u>FZF<CR>

" spelling
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
