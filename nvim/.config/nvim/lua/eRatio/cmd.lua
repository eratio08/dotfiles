vim.api.nvim_create_autocmd({ 'TermOpen' }, {
  desc = 'Changes styling of terminal buffers.',
  group = vim.api.nvim_create_augroup('eratio-term-cmd', { clear = true }),
  callback = function ()
    vim.opt.relativenumber = false
    vim.opt.number = false
    vim.opt.listchars = ''
    vim.opt.spell = false
    vim.cmd(':startinsert')
  end
})

vim.api.nvim_create_autocmd('TextYankPost', {
  desc = 'Highlight when yanking',
  group = vim.api.nvim_create_augroup('eratio-highlight-yank', { clear = true }),
  callback = function ()
    vim.highlight.on_yank()
  end,
})
