" Maintainer: Eike Lurz <moin@elurz.de>

" kassio/neoterm

if exists('g:plugs["neoterm"]')

" config
let g:neoterm_default_mod = 'vertical'
let g:neoterm_size = 60
let g:neoterm_autoinsert = 1

" mappings
nnoremap <C-q> :Ttoggle<CR>
inoremap <C-q> <Esc>:Ttoggle<CR>
tnoremap <C-q> <C-\><C-n>:Ttoggle<CR>

endif
