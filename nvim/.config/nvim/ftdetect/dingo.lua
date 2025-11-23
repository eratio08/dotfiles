vim.api.nvim_create_autocmd({ 'BufRead', 'BufNewFile' }, {
  pattern = '*.dingo',
  command = 'set filetype=dingo',
})
