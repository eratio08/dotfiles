" Maintainer: Eike Lurz <moin@elurz.de>

" enable native netrw plugin
filetype plugin indent on

" open netrw in tree mode
let g:netrw_liststyle = 3

" remove banner from netrw
let g:netrw_banner = 0

" reuse curent window when opening netrw
let g:netrw_browser_split = 0

" keep netrw open
" let g:netrw_browse_split = 4

" set initial windows size
let g:netrw_winsize = 15

" view on the left
let g:netrw_altv = 1

" set command used for directory rm
" let g:netrw_localrndir = 'rm -r'

" auto open netrw in startup
" augroup ProjectDrawer
"   autocmd!
"   autocmd VimEnter * :Vexplore
" augroup END
