vim.api.nvim_create_autocmd({ 'BufRead', 'BufNewFile' }, {
  pattern = '*.vrl',
  command = 'set filetype=vrl',
})
