-- neovim/nvim-lspconfig
local requireIfPresent = require('eratio.utils').requireIfPresent
local lspconfig = requireIfPresent('lspconfig')

if not lspconfig then
  return
end

local M = {}

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
map('n', 'gle', '<cmd>Telescope diagnostics<CR>')

map('n', 'gdc', ':lua vim.lsp.buf.declaration()<CR>')
map('n', 'gtd', ':lua vim.lsp.buf.type_definition()<CR>')

-- work space files
map('n', '<space>awf', ':lua vim.lsp.buf.add_workspace_folder()<CR>')
map('n', '<space>rwf', ':lua vim.lsp.buf.remove_workspace_folder()<CR>')
map('n', '<space>swf', ':lua print(vim.inspect(vim.lsp.buf.list_workspace_folders()))<CR>')

-- trigger formatting
map('n', '<space>ll', ':lua vim.lsp.buf.formatting()<CR>')

-- use LSP formatting on save
local augroup = require('eratio/utils').augroup
local exts = vim.tbl_foldr(
  function(s, acc)
    return acc .. '*.' .. s .. ','
  end,
  '',
  {
    'rs',
    'elm',
    'js',
    'ts',
    'kt',
    'java',
    'lua',
    'html',
    'vue',
  }
)

augroup({ { 'BufWritePre', exts, 'lua vim.lsp.buf.formatting_sync(nil, 300)' } }, 'fmt')

-- wrapper for common configurations
local function config(_config)
  local capabilities = vim.lsp.protocol.make_client_capabilities()
  -- augment capabilities with cmp_nvim_lsp
  capabilities = require('cmp_nvim_lsp').update_capabilities(capabilities)

  return vim.tbl_deep_extend('force', {
    capabilities = capabilities,
  }, _config or {})
end

-- diagnostics highlighting touchup
vim.lsp.handlers['textDocument/publishDiagnostics'] = vim.lsp.with(vim.lsp.diagnostic.on_publish_diagnostics, {
  -- Disable underline, it's very annoying
  underline = false,
})

M.tsserver = config({
  commands = {
    OrganizeImports = {
      function()
        vim.lsp.buf.execute_command({
          command = '_typescript.organizeImports',
          arguments = { vim.api.nvim_buf_get_name(0) },
          title = '',
        })
      end,
      description = 'Organize Imports',
    },
  },
})

M.kotlin_language_server = config({})

M.elm = config({
  init_options = {
    elmReviewDiagnostics = 'warning',
  },
})

M.rust_analyzer = config({})

-- lua
local sumneko_binary = '/usr/bin/lua-language-server'
M.sumneko_lua = config({
  cmd = { sumneko_binary, '-E' },
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
        globals = { 'vim' },
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
})

M.efm = config({
  init_options = { documentFormatting = true },
  filetypes = { 'lua' },
  settings = {
    rootMarkers = { '.git/' },
    languages = {
      lua = { {
        formatCommand = 'lua-format -i',
        formatStdin = true,
      } },
    },
  },
})

M.eslint = config({
  on_attach = function(_, _)
    -- trigger EslintFixAll on save
    vim.cmd('autocmd BufWritePre *.ts,*.js,*.vue, EslintFixAll')
  end,
  settings = {
    codeActionOnSave = {
      enable = true,
      mode = 'all',
    },
    format = true,
  },
})

M.tailwindcss = config()

M.volar = config()

M.rome = config()

M.pyright = config()

return M
