" Maintainer: Eike Lurz <moin@elurz.de>

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

" decrease update time
setlocal updatetime=300

" don't give |ins-completion-menu| messages.
setlocal shortmess+=c

" always show signcolumns
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


" Plugins
 
" enable native netrw plugin
filetype plugin on

" open netrw in tree mode
let g:netrw_liststyle = 3

" add minpac package manager
" https://github.com/k-takata/minpac.git
packadd minpac

if exists('g:loaded_minpac')
  call minpac#init()

  " add plugins
  call minpac#add('neoclide/coc.nvim')
  "call minpac#add('dense-analysis/ale')
  call minpac#add('junegunn/fzf')
  call minpac#add('preservim/tagbar')
  call minpac#add('sheerun/vim-polyglot')
  call minpac#add('itchyny/lightline.vim')
  call minpac#add('itchyny/vim-gitbranch')
  "call minpac#add('ap/vim-css-color', {'type': 'opt'})
  "call minpac#add('vim-test/vim-test')
  "call minpac#add('chrisbra/Colorizer')
  "call minpac#add('tpope/vim-projectionist')
  "call minpac#add('cocopon/iceberg.vim')
  "call minpac#add('cocopon/pgmnt.vim')
  "call minpac#add('rakr/vim-one')
  "call minpac#add('joshdick/onedark.vim')
  "call minpac#add('jacoborus/tender.vim')
  call minpac#add('arcticicestudio/nord-vim')
  call minpac#add('rust-lang/rust.vim')

  colorscheme nord 

  " helper command to update plugins
  command! PackUpdate call minpac#update()
  " helper command to cleanup plugins
  command! PackClean call minpac#clean()

  " lightline
  let g:lightline = {}
  let g:lightline.colorscheme = 'wombat'

      
  let g:lightline.active = {
        \   'left': [
        \     ['mode'],
        \   ],
        \   'right': [
        \     ['readonly', 'modified'],
        \     ['filename'],
        \     ['gitbranch'],
        \     ['fileformat', 'fileencoding', 'filetype'],
        \     ['lineinfo', 'percent']
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
    \ 'coc-java',
    \ 'coc-kotlin',
   "\ 'coc-pairs',
   "\ 'coc-rls',
    \ 'coc-explorer'
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
  "nmap <leader>rn <Plug>(coc-rename)

  " Formatting selected code.
  "xmap <leader>f  <Plug>(coc-format-selected)
  nmap <leader>f  <Plug>(coc-format-selected)  

  " GoTo code navigation.
  nmap <silent> gd <Plug>(coc-definition)
  nmap <silent> gy <Plug>(coc-type-definition)
  nmap <silent> gi <Plug>(coc-implementation)
  nmap <silent> gr <Plug>(coc-references)

  nmap <silent> ga <Plug>(coc-codeaction)
  nmap <silent> gf <Plug>(coc-fix-current)
  nmap <silent> ge <Plug>(coc-diagnostic-next)
  nmap <silent> gE <Plug>(coc-diagnostic-prev)
  nmap <silent> GE <Plug>(coc-diagnostic-prev)
  "nmap <silent> gD <Plug>(coc-references)
  "nmap <silent> GD <Plug>(coc-references)
  nmap <silent> gr <Plug>(coc-refactor)
  nmap <silent> grf :CocCommand workspace.renameCurrentFile<CR>
  nmap <silent> gp <Plug>(coc-format)"

  " rust-vim
  let g:rustfmt_autosave = 0 
endif

" Re-Mappings 
" map leader
let mapleader = " "

" bind fuzzy search
nnoremap <C-p> :<C-u>FZF<CR>
nnoremap <leader>f 1z=
nnoremap <leader>s :set spell! 

" set buffer navigation bindings
nnoremap <silent> [b :bprevious<CR>
nnoremap <silent> ]b :bnext<CR>
nnoremap <silent> [B :bfirst<CR>
nnoremap <silent> ]B :blast<CR>

" open explorer in new vertical resized split
nnoremap <leader>pv :wincmd v<bar> :Ex <bar> :vertical resize 30<CR>
