" neovim/nvim-lspconfig

if has('nvim') && exists('g:plugs["nvim-lspconfig"]')

" 'go-to' mappings
nnoremap gd :lua vim.lsp.buf.definition()<CR>
nnoremap gi :lua vim.lsp.buf.implementation<CR>
nnoremap gsh :lua vim.lsp.buf.signature_help()<CR>
nnoremap grr :lua vim.lsp.buf.references()<CR>
nnoremap grn :lua vim.lsp.buf.rename()<CR>
nnoremap gh :lua vim.lsp.buf.hover()<CR>
nnoremap gca :lua vim.lsp.buf.code_action()<CR>
nnoremap ge :lua vim.lsp.diagnostic.show_line_diagnostics(); vim.lsp.util.show_line_diagnostics()<CR> 
nnoremap ]e :lua vim.lsp.diagnostic.goto_next()<CR>
nnoremap [e :lua vim.lsp.diagnostic.goto_prev()<CR>

nnoremap gdc :lua vim.lsp.buf.declaration()<CR>
nnoremap gtd :lua vim.lsp.buf.type_definition()<CR>'

" workspace files
nnoremap <Space>wfa :lua vim.lsp.buf.add_workspace_folder()<CR>
nnoremap <Space>wfr :lua vim.lsp.buf.remove_workspace_folder()<CR>
nnoremap <Space>wfl :lua print(vim.inspect(vim.lsp.buf.list_workspace_folders()))<CR>

" trigger formatting
noremap <Space>cf :lua vim.lsp.buf.formatting()<CR>
"
" use LSP format on save 
augroup fmt
  autocmd!
  autocmd BufWritePre *.elm lua vim.lsp.buf.formatting_sync(nil, 100)
  autocmd BufWritePre *.js lua vim.lsp.buf.formatting_sync(nil, 100)
  autocmd BufWritePre *.ts lua vim.lsp.buf.formatting_sync(nil, 100)
  autocmd BufWritePre *.kt lua vim.lsp.buf.formatting_sync(nil, 100)
  autocmd BufWritePre *.lua lua vim.lsp.buf.formatting_sync(nil, 100)
  autocmd BufWritePre *.html lua vim.lsp.buf.formatting_sync(nil, 100)
augroup END


lua << EOF

local nvim_lsp = require'lspconfig'
local nvim_cmp = require('cmp_nvim_lsp')

-- TypeScript LSP
nvim_lsp.tsserver.setup{
  capabilities = nvim_cmp.update_capabilities(vim.lsp.protocol.make_client_capabilities()),
}

-- Kotlin LSP
nvim_lsp.kotlin_language_server.setup{
  capabilities = nvim_cmp.update_capabilities(vim.lsp.protocol.make_client_capabilities()),
  root_dir = nvim_lsp.util.root_pattern("settings.gradle.kts")
}

-- Elm LSP
nvim_lsp.elmls.setup{
  capabilities = nvim_cmp.update_capabilities(vim.lsp.protocol.make_client_capabilities()),
  init_options = {
    elmReviewDiagnostics = "warning"
    }
}

-- Rust LSP
-- nvim_lsp.rust_analyzer.setup{}

-- Lua LSP
-- set the path to the sumneko installation; if you previously installed via the now deprecated :LspInstall, use
local sumneko_binary = '/usr/bin/lua-language-server'

nvim_lsp.sumneko_lua.setup {
  cmd = {sumneko_binary, "-E" };
  settings = {
    Lua = {
      runtime = {
        -- Tell the language server which version of Lua you're using (most likely LuaJIT in the case of Neovim)
        version = 'LuaJIT',
        -- Setup your lua path
        path = vim.split(package.path, ';'),
      },
      diagnostics = {
        -- Get the language server to recognize the `vim` global
        globals = {'vim'},
      },
      workspace = {
        -- Make the server aware of Neovim runtime files
        library = {
          [vim.fn.expand('$VIMRUNTIME/lua')] = true,
          [vim.fn.expand('$VIMRUNTIME/lua/vim/lsp')] = true,
        },
      },
      -- Do not send telemetry data containing a randomized but unique identifier
      telemetry = {
        enable = false,
      },
    },
  },
  capabilities = nvim_cmp.update_capabilities(vim.lsp.protocol.make_client_capabilities()),
}

EOF

endif
