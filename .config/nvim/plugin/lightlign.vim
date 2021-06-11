" Maintainer: Eike Lurz <moin@elurz.de>

" itchyny/lightline.vim
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
