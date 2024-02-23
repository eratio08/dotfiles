vim.api.nvim_create_augroup('term_cmd', { clear = true })
vim.api.nvim_create_autocmd({ 'TermOpen' }, {
  group = 'term_cmd',
  callback = function ()
    vim.wo.relativenumber = false
    vim.wo.number = false
    vim.wo.listchars = ''
    vim.wo.spell = false
    vim.cmd(':startinsert')
  end
})
