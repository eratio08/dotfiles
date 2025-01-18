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

-- TODO: Potentially replace toggle term with this
local terminal = { state = { buf = -1, win = -1 } }
vim.api.nvim_create_user_command('TT', function ()
  if not vim.api.nvim_win_is_valid(terminal.state.win) then
    local buf = terminal.state.buf
    if not vim.api.nvim_buf_is_valid(buf) then
      buf = vim.api.nvim_create_buf(false, true) -- No file, scratch buffer
    end

    local win = vim.api.nvim_open_win(buf, true, {
      split = 'right',
      win = 0,
      width = math.floor(vim.o.columns * 0.3333)
    })

    if vim.bo[buf].buftype ~= 'terminal' then
      vim.cmd.terminal()
    end
    terminal.state = { buf = buf, win = win }
  else
    vim.api.nvim_win_hide(terminal.state.win)
  end
end, {})
