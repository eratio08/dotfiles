" Maintainer: Eike Lurz <moin@elurz.de>

" nvim-lua/completion-nvim

if has('nvim')

" Use completion-nvim in every buffer
autocmd BufEnter * lua require'completion'.on_attach()

" full LSP list https://github.com/neovim/nvim-lspconfig/blob/master/CONFIG.md

lua << EOF
-- enable typescript lsp and completion
require'lspconfig'.tsserver.setup{ on_attach=require'completion'.on_attach }
require'lspconfig'.kotlin_language_server.setup{ on_attach=require'completion'.on_attach }
require'lspconfig'.elmls.setup{ on_attach=require'completion'.on_attach }
EOF

" Use <Tab> and <S-Tab> to navigate through popup menu
inoremap <expr> <Tab>   pumvisible() ? "\<C-n>" : "\<Tab>"
inoremap <expr> <S-Tab> pumvisible() ? "\<C-p>" : "\<S-Tab>"

" map <c-p> to manually trigger completion
imap <silent> <C-Space> <Plug>(completion_trigger)

endif
