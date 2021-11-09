-- some helpers for telescope
local requireIfPresent = require('eratio.utils').requireIfPresent
local telescope = requireIfPresent('telescope')

if not telescope then
  return
end

local M = {}

local map = require('eratio/utils').map
local telescope_builtin = require('telescope.builtin')

-- dotfiles helper of theprimeagon
M.search_nvim_config = function()
  telescope_builtin.find_files({
    prompt_title = '< NVim RC >',
    cwd = '~/.config/nvim',
  })
end

map('n', '<Space>,', ':lua require("eratio/telescope-helpers").search_nvim_config()<CR>')

return M
