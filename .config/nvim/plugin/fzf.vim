" Maintainer: Eike Lurz <moin@elurz.de>

" junegunn/fzf.vim

if exists('g:plugs["fzf.vim"]')
" bind fuzzy search
nnoremap <silent> <Space>fp :<C-u>FZF<CR>
" search for all files tracked by git
nnoremap <Space>fg :GFiles<CR>
" bind rip-grep
nnoremap <Space>ff :Rg<CR>
" use path relative to open buffer for filepath completion
inoremap <expr> <C-x><C-f> fzf#vim#complete#path(
  \ "find . -path '*/\.*' -prune -o -print \| sed '1d;s:^..::'",
  \ fzf#wrap({'dir': expand('%:p:h')})
  \ )
" make sure fzf can be exited with esc
if has('nvim')
  au! TermOpen * tnoremap <buffer> <Esc> <C-\><C-n>
  au! FileType fzf tunmap <buffer> <Esc>
endif

endif
