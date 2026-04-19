vim.api.nvim_create_autocmd({ 'BufRead', 'BufNewFile' }, {
  pattern = '*.roc',
  command = 'set filetype=roc',
})
