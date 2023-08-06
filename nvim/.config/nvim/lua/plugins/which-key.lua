return {
  'folke/which-key.nvim',
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
        m = {
          v = { ':MarkdownPreviewToggle<CR>', 'Markdown Preview' },
          s = { ':MarkdownPreviewStop<CR>', 'Markdown Stop Preview' },
        }
      },
      ['<A-k>'] = { 'ddp', 'Move Line Up' },
      ['<A-j>'] = { 'ddkP', 'Move Line Down' },
      ['<Space>'] = { '<Nop>', 'Unbind Space', mode = { 'n', 'v' } },
      k = { "v:count == 0 ? 'gk' : 'k'", 'Better up movement with wrapped words', expr = true },
      j = { "v:count == 0 ? 'gj' : 'j'", 'Better down movement with wrapped words', expr = true },
    })

    wk.register({
      ['<A-k>'] = { ":move '<-2<CR>gv=gv", 'Move Selection Up', mode = 'v' },
      ['<A-j>'] = { ":move '>+1<CR>gv=gv", 'Move Selection Down', mode = 'v' },
    })
  end
}
