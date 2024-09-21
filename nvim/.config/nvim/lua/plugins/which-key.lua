return {
  'folke/which-key.nvim',
  dependencies = {
    'echasnovski/mini.icons',
  },
  event = 'VeryLazy',
  opts = {
    -- runs setup()
  },
  keys = {
    { '<leader>?', function () require('which-key').show({ global = false }) end, desc = 'List Buffer Local Keymaps' },
    { '<Up>', '<Nop>', desc = 'Unbind arrow up', mode = { 'v', 'n', 'i' } },
    { '<Down>', '<Nop>', desc = 'Unbind arrow down', mode = { 'v', 'n', 'i' } },
    { '<Right>', '<Nop>', desc = 'Unbind arrow right', mode = { 'v', 'n', 'i' } },
    { '<Left>', '<Nop>', desc = 'Unbind arrow left', mode = { 'v', 'n', 'i' } },
    { '<leader>p', vim.cmd.Ex, desc = 'Netrw Explorer' },
    { '<leader>s', '1z=', desc = 'Fix spelling' },
    { '<leader>T', ':vsplit | term<CR>', desc = 'Open vertical Terminal' },
    { '<Space>', '<Nop>', desc = 'Unbind Space', mode = { 'n', 'v' } },
    { 'k', "v:count == 0 ? 'gk' : 'k'", desc = 'Better up movement with wrapped words', expr = true },
    { 'j', "v:count == 0 ? 'gj' : 'j'", desc = 'Better down movement with wrapped words', expr = true },
    { '<esc>', '<C-\\><C-n>', desc = 'Normal Mode', mode = 't' },

    -- Window
    { '<C-w>', '<C-\\><C-n><C-w>', desc = 'Window command', mode = 't' },
    { '<C-h>', '<C-w><C-h>', desc = 'Move focus to the left window', mode = 'n' },
    { '<C-l>', '<C-w><C-l>', desc = 'Move focus to the right window', mode = 'n' },
    { '<C-j>', '<C-w><C-j>', desc = 'Move focus to the lower windod', mode = 'n' },
    { '<C-k>', '<C-w><C-k>', desc = 'Move focus to the upper window', mode = 'n' },
    { '<C-t>', ':resize +5<CR>', desc = 'Increase window height', mode = 'n' },
    { '<C-s>', ':resize -5<CR>', desc = 'Decrease window height', mode = 'n' },
    { '<C-,>', ':vertical resize -5<CR>', desc = 'Decrease window width', mode = 'n' },
    { '<C-.>', ':vertical resize +5<CR>', desc = 'Increase window width', mode = 'n' },

    -- {'<A-k>', 'ddp', 'Move Line Up', mode = 'n' },
    -- {'<A-j>', 'ddkP', 'Move Line Down', mode = 'n' },
    { '<A-k>', ":move '<-2<CR>gv=gv", desc = 'Move Selection Up', mode = 'v' },
    { '<A-j>', ":move '>+1<CR>gv=gv", desc = 'Move Selection Down', mode = 'v' },
  },
}
