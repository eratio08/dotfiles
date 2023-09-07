return {
  'klen/nvim-test',
  keys = { 'tt' },
  dependencies = {
    { 'folke/which-key.nvim' },
  },
  config = function ()
    local nvim_test = require('nvim-test')

    local wk = require('which-key')
    wk.register({
      t = {
        name = 'Test',
        t = { ':TestNearest<CR>', 'Nearest' },
        f = { ':TestFile<CR>', 'File' },
        s = { ':TestSuite<CR>', 'Suite' },
        l = { ':TestLast<CR>', 'Last' }
      }
    })

    nvim_test.setup({
      term = 'toggleterm',
      termOpts = {
        direction = 'float',
      },
    })
  end
}
