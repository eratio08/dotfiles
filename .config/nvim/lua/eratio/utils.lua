local M = {}

-- taken from https://oroques.dev/notes/neovim-init/#mappings
M.map = function(mode, lhs, rhs, opts)
  local options = { noremap = true }
  if opts then options = vim.tbl_extend('force', options, opts) end
  vim.api.nvim_set_keymap(mode, lhs, rhs, options)
end

-- taken from https://icyphox.sh/blog/nvim-lua/
local cmd = vim.cmd

M.augroup = function (autocmds, name)
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
  vim.bo[0].buftype='nofile'
  vim.bo[0].bufhiddden='hide'
  vim.bo[0].swapfile=false
end


return M
