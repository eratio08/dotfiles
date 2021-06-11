" Maintainer: Eike Lurz <moin@elurz.de>

" neovim/nvim-lspconfig

" 'go-to' mappings
nnoremap <silent> gd <CMD>lua vim.lsp.buf.definition()<CR>
nnoremap <silent> gh <CMD>lua vim.lsp.buf.hover()<CR>
nnoremap <silent> gH <CMD>lua vim.lsp.buf.code_action()<CR>
nnoremap <silent> gD <CMD>lua vim.lsp.buf.implementation<CR>
nnoremap <silent> <C-k> <CMD>lua vim.lsp.buf.signature_help()<CR>
nnoremap <silent> gr <CMD>lua vim.lsp.buf.references()<CR>
nnoremap <silent> gR <CMD>lua vim.lsp.buf.rename()<CR>
