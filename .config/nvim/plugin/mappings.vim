" Maintainer: Eike Lurz <moin@elurz.de>

" use 'sed -n l' if binding behave strangely to see actual codes send by terminal

" open help in vertical split
" cnoreabbrev H vert bo h
cnoremap HR vert bo h 

" replace spelling mistake with first match
nnoremap <Space>s 1z=
" toggle spelling
"nnoremap  <Space>s :Set Spill!
" buffer navigation bindings
nnoremap [b :bprevious<CR>
nnoremap ]b :bnext<CR>
nnoremap [B :bfirst<CR>
nnoremap ]B :blast<CR>
" quickfix navigation
nnoremap [q :cprev<CR>
nnoremap ]q :cnext<CR>
nnoremap [Q :cfirst<CR>
nnoremap ]Q :clast<CR>
" open explorer in new vertical resized split
nnoremap <Space>pv :wincmd v<bar> :Ex <bar> :vertical resize 30<CR>
" open to edit helpers - expand %% to current working directory
cnoremap %% <C-R>=fnameescape(expand('%:h')).'/'<CR>
" edit in windows
noremap <Space>ew :e %%
" edit in split
noremap <Space>es :sp %%
" edit in vertical split
noremap <Space>ev :vsp %%
" edit in tab
noremap <Space>et :tabe %%
" improve window navigation
noremap <Space>wh <C-w>h
noremap <Space>wj <C-w>j
noremap <Space>wk <C-w>k
noremap <Space>wl <C-w>l
" edit vimrc in tab
nnoremap <Space>, :tabedit $MYVIMRC<CR>
" source vimrc
nnoremap <Space>src :source $MYVIMRC<CR>
" fix alt key mapping
" map <Esc>h <A-h>
" map <Esc>j <A-j>
" map <Esc>k <A-k>
" map <Esc>l <A-l>
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
