local nvim_test = require('nvim-test')

local wk = require("which-key")
wk.register({
  t = {
    name = "Test",
    t = { ':TestNearest<CR>', 'Nearest' },
    f = { ':TestFile<CR>', 'File' },
    s = { ':TestSuite<CR>', 'Suite' },
    l = { ':TestLast<CR>', 'Last' }
  }
})

nvim_test.setup({})
