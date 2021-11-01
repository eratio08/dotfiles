-- nvim-lua/lsp_extensions.nvim

if vim.g.plugs['lsp_extensions'] then
  
require('lsp_extensions').inlay_hints{
	highlight = "Comment",
	prefix = " > ",
	aligned = false,
	only_current_line = false,
	enabled = { "ChainingHint" }
}

vim.api.nvim_exec('autocmd BufEnter,BufWinEnter,TabEnter *.rs :lua require("lsp_extensions").inlay_hints{}')

end
