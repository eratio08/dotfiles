vim.api.nvim_create_autocmd({ 'TermOpen' }, {
  desc = 'Changes styling of terminal buffers.',
  group = vim.api.nvim_create_augroup('term_cmd', { clear = true }),
  callback = function ()
    vim.wo.relativenumber = false
    vim.wo.number = false
    vim.wo.listchars = ''
    vim.wo.spell = false
    vim.cmd(':startinsert')
  end
})

vim.api.nvim_create_autocmd('TextYankPost', {
  desc = 'Highlight when yanking (copying) text',
  group = vim.api.nvim_create_augroup('kickstart-highlight-yank', { clear = true }),
  callback = function ()
    vim.highlight.on_yank()
  end,
})
