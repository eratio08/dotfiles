" Maintainer: Eike Lurz <moin@elurz.de>

" use 'sed -n l' if binding behave strangely to see actual codes send by terminal

" map leader to <space>
let mapleader = " "

" replace spelling mistake with first match
nnoremap <silent> <leader>s 1z=
" toggle spelling
"nnoremap <silent> <Leader>s :Set Spill!
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
