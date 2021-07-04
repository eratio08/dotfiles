" Maintainer: Eike Lurz <moin@elurz.de>

" sbdchd/neoformat

if exists('g:plugs["neoformat"]')

" set format command mapping
nnoremap <Space>FF :Neoformat<CR>

" augroup fmt
"   autocmd!
"   autocmd BufWritePre * undojoin | Neoformat
" augroup END

endif
