-- some helpers for telescope
local M = {}

require('eratio.utils').ifPresent('telescope', function()
  local telescope_builtin = require('telescope.builtin')

  -- dotfiles helper of theprimeagen
  M.search_nvim_config = function()
    telescope_builtin.find_files({
      prompt_title = '< NVim RC >',
      cwd = '~/.config/nvim',
    })
  end

  -- current buffer fuzzy finding with dropdown theme
  M.current_buffer_fuzzy_find = function()
    local theme = require('telescope.themes').get_dropdown({ height = 10, previewer = false })
    require('telescope.builtin').current_buffer_fuzzy_find(theme)
  end
end)

return M
