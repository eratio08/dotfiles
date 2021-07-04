" neovim/nvim-lspconfig

if has('nvim') && exists('g:plugs["nvim-lspconfig"]')

" 'go-to' mappings
nnoremap gd <Cmd>lua vim.lsp.buf.definition()<CR>
nnoremap gD <Cmd>lua vim.lsp.buf.declaration()<CR>
nnoremap gh <Cmd>lua vim.lsp.buf.hover()<CR>
nnoremap ga <Cmd>lua vim.lsp.buf.code_action()<CR>
nnoremap gi <Cmd>lua vim.lsp.buf.implementation<CR>
nnoremap gt <Cmd>lua vim.lsp.buf.type_definition()<CR>'
nnoremap <Space>k <Cmd>lua vim.lsp.buf.signature_help()<CR>
nnoremap gr <Cmd>lua vim.lsp.buf.references()<CR>
nnoremap gR <Cmd>lua vim.lsp.buf.rename()<CR>
nnoremap ge <Cmd>lua vim.lsp.diagnostic.show_line_diagnostics()<CR>
nnoremap [e <Cmd>lua vim.lsp.diagnostic.goto_prev()<CR>
nnoremap ]e <Cmd>lua vim.lsp.diagnostic.goto_next()<CR>

" workspace files
nnoremap <Space>wfa <Cmd>lua vim.lsp.buf.add_workspace_folder()<CR>
nnoremap <Space>wfr <Cmd>lua vim.lsp.buf.remove_workspace_folder()<CR>
nnoremap <Space>wfl <Cmd>lua print(vim.inspect(vim.lsp.buf.list_workspace_folders()))<CR>

" trigger formating
nnoremap <Space>F <Cmd>lua vim.lsp.buf.formatting()<CR>
" use LSP format on save
augroup fmt
  autocmd!
  autocmd BufWritePre * undojoin | lua vim.lsp.buf.formatting()
augroup END


lua << EOF

local nvim_lsp = require'lspconfig'
local completion = require'completion'.on_attach

-- TypeScript LSP
nvim_lsp.tsserver.setup{
  on_attach = completion
}

-- Kotlin LSP
nvim_lsp.kotlin_language_server.setup{
  on_attach = completion,
  root_dir = nvim_lsp.util.root_pattern("settings.gradle.kts")
}

-- Elm LSP
nvim_lsp.elmls.setup{
  on_attach = completion,
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
}

EOF

endif
