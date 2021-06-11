" Maintainer: Eike Lurz <moin@elurz.de>

" enable native netrw plugin
filetype plugin indent on
" open netrw in tree mode
let g:netrw_liststyle = 3
" remove banner from netrw
let g:netrw_banner=0
" reuse curent window when opening netrw
let g:netrw_browser_split = 0
" set initial windows size
let g:netrw_winsize = 25
" set command used for directory rm
" let g:netrw_localrndir = 'rm -r'
