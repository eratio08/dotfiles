return {
  'folke/which-key.nvim',
  event = 'VeryLazy',
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
      ['<Space>'] = { '<Nop>', 'Unbind Space', mode = { 'n', 'v' } },
      k = { "v:count == 0 ? 'gk' : 'k'", 'Better up movement with wrapped words', expr = true },
      j = { "v:count == 0 ? 'gj' : 'j'", 'Better down movement with wrapped words', expr = true },
      ['<esc>'] = { '<C-\\><C-n>', 'Normal Mode', mode = 't' },
      ['<C-w>'] = { '<C-\\><C-n><C-w>', 'Window command', mode = 't' },
      -- Now done with treesitter text-objects
      -- ['<A-k>'] = { 'ddp', 'Move Line Up', mode = 'n' },
      -- ['<A-j>'] = { 'ddkP', 'Move Line Down', mode = 'n' },
      ['<A-k>'] = { ":move '<-2<CR>gv=gv", 'Move Selection Up', mode = { 'v' } },
      ['<A-j>'] = { ":move '>+1<CR>gv=gv", 'Move Selection Down', mode = { 'v' } },
      g = {
        name = 'Go',
        d = { vim.lsp.buf.definition, 'Definition' },
        D = { vim.lsp.buf.declaration, 'Declaration' },
        i = { vim.lsp.buf.implementation, 'Implementation' },
        r = { vim.lsp.buf.references, 'Reference' },
        t = { vim.lsp.buf.type_definition, 'Type Definition' },
        l = { vim.diagnostic.open_float, 'List Diagnostics' },
        -- default from lsp-zero
        s = { vim.lsp.buf.signature_help, 'Signature Help' },
        o = { vim.lsp.buf.definition, 'Definition' },
      },
      ['<leader>l'] = {
        name = 'LSP',
        r = { vim.lsp.buf.rename, 'Rename' },
        a = { vim.lsp.buf.code_action, 'Code Action' },
        l = { ':Format<CR>', 'Format Buffer' },
        d = { vim.diagnostic.open_float, 'List Diagnostics' },
      },
      K = { function ()
        local winid = require('ufo').peekFoldedLinesUnderCursor()
        if not winid then
          vim.lsp.buf.hover()
        end
      end, 'Hover Documentation' },
      ['<C-k>'] = { vim.lsp.buf.signature_help, 'Signature Help' },
      [']'] = {
        name = 'Next',
        d = { vim.diagnostic.goto_next, 'Diagnostic' },
      },
      ['['] = {
        d = { vim.diagnostic.goto_prev, 'Diagnostic' },
        name = 'Previous',
      },
    })
  end
}
