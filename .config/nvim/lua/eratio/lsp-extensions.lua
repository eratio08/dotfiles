-- nvim-lua/lsp_extensions.nvim

local utils = require('eratio.utils')
local lsp_extensions = utils.requireIfPresent('lsp_extensions')

if not lsp_extensions then
  return
end

-- lsp_extensions.inlay_hints({
--   highlight = 'Comment',
--   prefix = ' ≫ ',
--   aligned = false,
--   only_current_line = false,
--   enabled = { 'ChainingHint' },
-- })

-- enables inlay_hints for files
local extensions = '*.rs'
utils.augroup(
  { { 'InsertLeave,BufEnter,BufWinEnter,TabEnter,BufWritePost', extensions, ':lua require("lsp_extensions").inlay_hints({ prefix = " » ", highlight = "Comment" })' } },
  'inlay_hints_cmd'
)

