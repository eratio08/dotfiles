vim.api.nvim_create_autocmd({ 'BufRead', 'BufNewFile' }, {
  group = 'filetypedetect',
  pattern = { '*.tf', '*.tofu' },
  callback = function ()
    vim.bo.filetype = 'opentofu'
  end,
})
