vim.api.nvim_create_autocmd({ 'BufRead', 'BufNewFile' }, {
  pattern = { '*.sky', '*.skyi' },
  command = 'set filetype=sky',
})
