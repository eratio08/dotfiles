" Maintainer: Eike Lurz <moin@elurz.de>

" neovim/nvim-lspconfig

if has('nvim') && exists('g:plugs["nvim-lspconfig"]')

" enable lsp for languages
lua << EOF
-- enable lsp and completion
local nvim_lsp = require'lspconfig'

local completion = require'completion'.on_attach

-- nvim_lsp.tsserver.setup{}
nvim_lsp.kotlin_language_server.setup{
  on_attach= completion,
  root_dir = nvim_lsp.util.root_pattern("settings.gradle.kts")
}
-- nvim_lsp.elmls.setup{}
-- nvim_lsp.rust_analyzer.setup{}

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

" 'go-to' mappings
nnoremap <silent> gd <CMD>lua vim.lsp.buf.definition()<CR>
nnoremap <silent> gh <CMD>lua vim.lsp.buf.hover()<CR>
nnoremap <silent> gH <CMD>lua vim.lsp.buf.code_action()<CR>
nnoremap <silent> gD <CMD>lua vim.lsp.buf.implementation<CR>
nnoremap <silent> <C-k> <CMD>lua vim.lsp.buf.signature_help()<CR>
nnoremap <silent> gr <CMD>lua vim.lsp.buf.references()<CR>
nnoremap <silent> gR <CMD>lua vim.lsp.buf.rename()<CR>
nnoremap <silent> gF <CMD>lua vim.lsp.buf.formatting()<CR>

endif
