-- williamboman/nvim-lsp-installer

local requireIfPresent = require('eratio.utils').requireIfPresent
local lsp_installer = requireIfPresent('nvim-lsp-installer')

if not lsp_installer then
  return
end

lsp_installer.on_server_ready(function(server)
  local lsp_configs = require('eratio/nvim-lsp')
  local opts = lsp_configs[server.name]

  if opts == nil then
    print('No lsp configuration found for "' .. server.name .. '".')
    opts = {}
  else
    print('Found lsp configuration for "' .. server.name .. '.')
  end

  server:setup(opts)
end)
