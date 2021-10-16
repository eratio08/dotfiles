local M = {}

-- taken from https://oroques.dev/notes/neovim-init/#mappings
function M.map(mode, lhs, rhs, opts)
  local options = { noremap = true }
  if opts then options = vim.tbl_extend('force', options, opts) end
  vim.api.nvim_set_keymap(mode, lhs, rhs, options)
end

-- taken from https://icyphox.sh/blog/nvim-lua/
local cmd = vim.cmd

function M.augroup(autocmds, name)
    cmd('augroup ' .. name)
    cmd('autocmd!')
    for _, autocmd in ipairs(autocmds) do
        cmd('autocmd ' .. table.concat(autocmd, ' '))
    end
    cmd('augroup END')
end

-- make scratch file helper
function M.makeScratch()
  cmd('enew')
  vim.bo[0].buftype='nofile'
  vim.bo[0].bufhiddden='hide'
  vim.bo[0].swapfile=false
end

return M
