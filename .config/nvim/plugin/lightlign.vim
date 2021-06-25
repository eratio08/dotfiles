" Maintainer: Eike Lurz <moin@elurz.de>

" itchyny/lightline.vim

if exists('g:plugs["lightline.vim"]')

let g:lightline = {}
let g:lightline.colorscheme = 'wombat'
let g:lightline.component_function = {
      \   'gitbranch': 'gitbranch#name'
      \ }
let g:lightline.active = {
      \   'left': [
      \     ['mode'],
      \     ['gitbranch'],
      \     ['filename'],
      \     ['filetype']
      \   ],
      \   'right': [
      \     ['readonly', 'modified'],
      \     ['fileencoding'],
      \     ['lineinfo'],
      \     ['percent']
      \   ],
      \ }

endif
