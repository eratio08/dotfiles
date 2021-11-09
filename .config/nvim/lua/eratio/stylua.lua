-- source: https://github.com/tjdevries/config_manager/blob/3e4a30866dfe3342dc1089afb010ef9a0cc30923/xdg_config/nvim/lua/tj/stylua.lua
local requireIfPresent = require('eratio.utils').requireIfPresent
local Path = requireIfPresent('plenary.path')
local Job = requireIfPresent('plenary.job')
local lspconfig_util = requireIfPresent('lspconfig.util')

if vim.fn.executable('stylua') == 0 and not Path and not Job and not lspconfig_util then
  return
end

local cached_configs = {}

local root_finder = lspconfig_util.root_pattern('.git')
local stylua_finder = function(path)
  if cached_configs[path] == nil then
    local file_path = Path:new(path)
    local root_path = Path:new(root_finder(path))

    local file_parents = file_path:parents()
    local root_parents = root_path:parents()

    local relative_diff = #file_parents - #root_parents
    for index, dir in ipairs(file_parents) do
      if index > relative_diff then
        break
      end

      local stylua_path = Path:new({ dir, 'stylua.toml' })
      if stylua_path:exists() then
        cached_configs[path] = stylua_path:absolute()
        break
      end

      stylua_path = Path:new({ dir, '.stylua.toml' })
      if stylua_path:exists() then
        cached_configs[path] = stylua_path:absolute()
        break
      end
    end
  end

  return cached_configs[path]
end

local stylua = {}

stylua.format = function(bufnr)
  bufnr = bufnr or vim.api.nvim_get_current_buf()

  local filepath = Path:new(vim.api.nvim_buf_get_name(bufnr)):absolute()
  local stylua_toml = stylua_finder(filepath)

  if not stylua_toml then
    return
  end

    -- stylua: ignore
    local j = Job:new{
        "stylua",
        "--config-path",
        stylua_toml,
        "-",
        writer = vim.api.nvim_buf_get_lines(0, 0, -1, false)
    }

  local output = j:sync()

  if j.code ~= 0 then
    -- Schedule this so that it doesn't do dumb stuff like printing two things.
    vim.schedule(function()
      print('[stylua] Failed to process due to errors')
    end)

    return
  end

  vim.api.nvim_buf_set_lines(bufnr, 0, -1, false, output)
  pcall(vim.api.nvim_buf_clear_namespace, bufnr, Lkasnip_ns_id, 0, -1)

  -- Handle some weird snippet problems. Not everyone will necessarily have this problem.
  Luasnip_current_nodes = Luasnip_current_nodes or {}
  Luasnip_current_nodes[bufnr] = nil
end

-- register format on save auto command
vim.cmd([[
  augroup StyluaAuto
    autocmd BufWritePre *.lua :lua require("eratio.stylua").format()
  augroup END
]])

return stylua
