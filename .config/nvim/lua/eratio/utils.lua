local M = {}

-- taken from https://icyphox.sh/blog/nvim-lua/
local cmd = vim.cmd

M.augroup = function(autocmds, name)
  cmd('augroup ' .. name)
  cmd('autocmd!')
  for _, autocmd in ipairs(autocmds) do
    cmd('autocmd ' .. table.concat(autocmd, ' '))
  end
  cmd('augroup END')
end

-- make scratch file helper
M.makeScratch = function()
  cmd('enew')
  vim.bo[0].buftype = 'nofile'
  vim.bo[0].bufhiddden = 'hide'
  vim.bo[0].swapfile = false
end

-- return module of present
M.requireIfPresent = function(moduleName)
  local isPresent, mod = pcall(require, moduleName)

  if isPresent then
    return mod
  else
    return nil
  end
end

-- runs block callback if module is present
M.ifPresent = function(moduleName, block)
  local isPresent, mod = pcall(require, moduleName)

  if isPresent then
    block(mod)
  else
    print('[' .. moduleName .. '] Was not found.')
  end
end

-- get keys of an object
M.keys = function(tab)
  local keyset = {}
  local n = 0

  for k, _ in pairs(tab) do
    n = n + 1
    keyset[n] = k
  end

  return keyset
end

-- foldr
M.tbl_foldr = function(fn, initial, tbl)
  local acc = vim.deepcopy(initial)

  for _, entry in ipairs(tbl) do
    acc = fn(entry, acc)
  end
  return acc
end

--
M.join_to_str = function(tab, pre, post, init)
  local str = M.tbl_foldr(function(s, acc)
    return acc .. pre .. s .. post
  end, init, tab)

  return str
end

return M
