-- some helpers for telescope

local M = {}
if vim.g.plugs["telescope.nvim"] then

local map = require('eratio/utils').map

-- dotfiles helper of theprimeagon
M.search_nvim_config = function ()
    require('telescope.builtin').find_files({
        prompt_title = '< NVim RC >',
        cwd = '~/.config/nvim',
    })
end

map('n', '<Space>,', ':lua require("eratio/telescope-helpers").search_nvim_config()<CR>')

end
return M

