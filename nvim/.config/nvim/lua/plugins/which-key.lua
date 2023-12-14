return {
  'folke/which-key.nvim',
  lazy = false,
  config = function ()
    local wk = require('which-key')

    wk.register({
      ['<Up>'] = { '<Nop>', 'Unbind arrow up', mode = { 'v', 'n', 'i' } },
      ['<Down>'] = { '<Nop>', 'Unbind arrow down', mode = { 'v', 'n', 'i' } },
      ['<Right>'] = { '<Nop>', 'Unbind arrow right', mode = { 'v', 'n', 'i' } },
      ['<Left>'] = { '<Nop>', 'Unbind arrow left', mode = { 'v', 'n', 'i' } },
      ['<leader>'] = {
        name = 'Leader',
        p = {
          name = 'Project',
          v = { vim.cmd.Ex, 'View' }
        },
        s = { '1z=', 'Fix spelling' },
        q = { vim.diagnostic.setloclist, 'Populate Quick fix list with diagnostics' },
        T = { ':vsplit | term<CR>', 'Open vertical Terminal' },
      },
      -- Now done with treesitter
      -- ['<A-k>'] = { 'ddp', 'Move Line Up' },
      -- ['<A-j>'] = { 'ddkP', 'Move Line Down' },
      ['<Space>'] = { '<Nop>', 'Unbind Space', mode = { 'n', 'v' } },
      k = { "v:count == 0 ? 'gk' : 'k'", 'Better up movement with wrapped words', expr = true },
      j = { "v:count == 0 ? 'gj' : 'j'", 'Better down movement with wrapped words', expr = true },
      -- Done with vim-unimpaired
      -- ['['] = {
      --   name = 'Previous',
      --   b = { ':bprev<CR>', 'Buffer' },
      -- },
      -- [']'] = {
      --   name = 'Next',
      --   b = { ':bnex<CR>', 'Buffer' },
      -- },
    })

    wk.register({
      ['<A-k>'] = { ":move '<-2<CR>gv=gv", 'Move Selection Up', mode = 'v' },
      ['<A-j>'] = { ":move '>+1<CR>gv=gv", 'Move Selection Down', mode = 'v' },
    })
  end
}
