" Maintainer: Eike Lurz <moin@elurz.de>

" sbdchd/neoformat

if exists('g:plugs["neoformat"]')

" set format command mapping
nnoremap <Space>cff :Neoformat<CR>

" auto format on save
" augroup fmt
"   autocmd!
"   autocmd BufWritePre * undojoin | Neoformat
" augroup END

endi
