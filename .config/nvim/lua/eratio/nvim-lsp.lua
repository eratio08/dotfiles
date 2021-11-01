-- neovim/nvim-lspconfig

local g = vim.g -- a table to access global variables

if g.plugs["nvim-lspconfig"] then

-- mappings
local map = require('eratio/utils').map
map('n', 'gd', ':lua vim.lsp.buf.definition()<CR>')
map('n', 'gi', ':lua vim.lsp.buf.implementation()<CR>')
map('n', 'gsh', ':lua vim.lsp.buf.signature_help()<CR>')
map('n', 'grr', ':lua vim.lsp.buf.references()<CR>')
map('n', 'grn', ':lua vim.lsp.buf.rename()<CR>')
map('n', 'gh', ':lua vim.lsp.buf.hover()<CR>')
map('n', 'gca', ':lua vim.lsp.buf.code_action()<CR>')
map('n', 'ge', ':lua vim.lsp.diagnostic.show_line_diagnostics()<CR>')
map('n', ']e', ':lua vim.lsp.diagnostic.goto_next()<CR>')
map('n', '[e', ':lua vim.lsp.diagnostic.goto_prev()<CR>')

map('n', 'gdc', ':lua vim.lsp.buf.declaration()<CR>')
map('n', 'gtd', ':lua vim.lsp.buf.type_definition()<CR>')

-- work space files
map('n', '<space>awf', ':lua vim.lsp.buf.add_workspace_folder()<CR>')
map('n', '<space>rwf', ':lua vim.lsp.buf.remove_workspace_folder()<CR>')
map('n', '<space>swf', ':lua print(vim.inspect(vim.lsp.buf.list_workspace_folders()))<CR>')


-- trigger formatting
map('n', '<space>cf', ':lua vim.lsp.buf.formatting()<CR>')


-- use LSP formatting on save
local augroup = require('eratio/utils').augroup
local exts = vim.tbl_foldr(
  function(s, acc) return acc .. '*.'.. s .. ',' end,
  '',
  { 'elm', 'js', 'ts', 'kt', 'lua', 'html' }
)

augroup({{ 'BufWritePre', exts, 'lua vim.lsp.buf.formatting_sync(nil, 100)'}}, 'fmt')

-- configure LSPs
local nvim_lsp = require('lspconfig')


-- wrapper for common configurations
local function config(_config)
  local capabilities=vim.lsp.protocol.make_client_capabilities()
  capabilities=require('cmp_nvim_lsp').update_capabilities(capabilities)

  return vim.tbl_deep_extend("force", {
      capabilities = capabilities
  }, _config or {})
end


-- diagnostics highlighting touchup
vim.lsp.handlers["textDocument/publishDiagnostics"] =
    vim.lsp.with(vim.lsp.diagnostic.on_publish_diagnostics, {
        -- Disable underline, it's very annoying
        underline = false,
    })


-- TypeScript LSP
-- npm install -g typescript typescript-language-server
local function organize_imports()
  local params = {
    command = "_typescript.organizeImports",
    arguments = {vim.api.nvim_buf_get_name(0)},
    title = ""
  }
  vim.lsp.buf.execute_command(params)
end

nvim_lsp.tsserver.setup(config({
  commands = {
    OrganizeImports = {
      organize_imports,
      description = "Organize Imports"
    }
  }
}))

-- Kotlin LSP
nvim_lsp.kotlin_language_server.setup(config({
  root_dir = nvim_lsp.util.root_pattern("settings.gradle.kts")
}))

-- Elm LSP
nvim_lsp.elmls.setup(config({
  init_options = {
    elmReviewDiagnostics = "warning"
  }
}))

-- Rust LSP
-- nvim_lsp.rust_analyzer.setup{}

-- Lua LSP
-- set the path to the sumneko installation; if you previously installed via the now deprecated :LspInstall, use
local sumneko_binary = '/usr/bin/lua-language-server'

nvim_lsp.sumneko_lua.setup(config({
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
}))

-- ESLint
-- npm i -g vscode-langservers-extracted
nvim_lsp.eslint.setup(config({
  settings = {
    codeActionOnSave = {
      enable = true,
      mode = "all"
    },
    format = true,
  }
}))

-- trigger EslintFixAll on save
vim.cmd('autocmd BufWritePre *.ts,*.js,*.vue, EslintFixAll')

-- Tailwindcss
-- npm install -g @tailwindcss/language-server
nvim_lsp.tailwindcss.setup(config())

-- Volar
-- npm install -g @volar/server
nvim_lsp.volar.setup(config())

end
